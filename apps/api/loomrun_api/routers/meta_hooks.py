import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from loomrun_api.config import settings
from loomrun_api.meta_client import fetch_leadgen, map_lead_fields, parse_field_data, verify_webhook_signature
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.whatsapp_template_service import schedule_greeting
from prisma.enums import LeadActivityType, LeadSource

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/hooks/meta")
async def meta_webhook_verify(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
):
    if hub_mode == "subscribe" and hub_verify_token == settings.meta_webhook_verify_token:
        return int(hub_challenge) if hub_challenge and hub_challenge.isdigit() else hub_challenge
    raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Verification failed")


@router.post("/hooks/meta")
async def meta_webhook_inbound(request: Request) -> dict[str, str]:
    body_bytes = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")

    if settings.meta_app_secret and not verify_webhook_signature(body_bytes, signature):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Invalid signature")

    payload: dict[str, Any] = await request.json()
    if payload.get("object") != "page":
        return {"status": "ignored"}

    for entry in payload.get("entry", []):
        page_id = entry.get("id")
        for change in entry.get("changes", []):
            if change.get("field") != "leadgen":
                continue
            value = change.get("value", {})
            leadgen_id = value.get("leadgen_id")
            if not leadgen_id:
                continue
            await _process_leadgen(leadgen_id, page_id, value)

    return {"status": "ok"}


async def _process_leadgen(leadgen_id: str, page_id: str, raw_value: dict) -> None:
    connection = await _find_connection_by_page(page_id)
    if not connection:
        logger.warning("No org connected for page_id=%s", page_id)
        return

    org_id = connection.organizationId
    creds = connection.credentials or {}
    page_token = _get_page_token(creds, page_id)
    if not page_token:
        logger.warning("No page token for page_id=%s org=%s", page_id, org_id)
        return

    # Deduplicate: skip if we already have this leadgen_id
    existing = await prisma.lead.find_first(
        where={"organizationId": org_id, "metaLeadgenId": leadgen_id}
    )
    if existing:
        logger.info("Duplicate leadgen_id=%s org=%s — skipped", leadgen_id, org_id)
        return

    try:
        lead_data = await fetch_leadgen(leadgen_id, page_token)
    except Exception as exc:
        logger.exception("Failed to fetch leadgen_id=%s: %s", leadgen_id, exc)
        return

    field_data = lead_data.get("field_data", [])
    flat = parse_field_data(field_data)
    mapped = map_lead_fields(flat)

    campaign_id = lead_data.get("campaign_id") or raw_value.get("campaign_id")
    campaign_name = lead_data.get("campaign_name")
    adset_id = lead_data.get("adset_id") or raw_value.get("adset_id")
    adset_name = lead_data.get("adset_name")
    ad_id = lead_data.get("ad_id") or raw_value.get("ad_id")
    ad_name = lead_data.get("ad_name")
    form_id = lead_data.get("form_id") or raw_value.get("form_id")

    score = _compute_score(mapped)

    source_parts = []
    if campaign_name:
        source_parts.append(f"campaign:{campaign_name}")
    if ad_name:
        source_parts.append(f"ad:{ad_name}")

    lead = await prisma.lead.create(
        data={
            "organizationId": org_id,
            "title": mapped["title"],
            "source": LeadSource.META_ADS,
            "phone": mapped.get("phone"),
            "email": mapped.get("email"),
            "city": mapped.get("city"),
            "company": mapped.get("company"),
            "productInterest": mapped.get("product_interest"),
            "quantityEstimate": mapped.get("quantity_estimate"),
            "leadScore": score,
            "sourceDetail": ", ".join(source_parts) if source_parts else None,
            "tags": [],
            "lastActivityAt": datetime.now(timezone.utc),
            "metaLeadgenId": leadgen_id,
            "metaPageId": page_id,
            "metaFormId": str(form_id) if form_id else None,
            "metaAdId": str(ad_id) if ad_id else None,
            "metaAdsetId": str(adset_id) if adset_id else None,
            "metaCampaignId": str(campaign_id) if campaign_id else None,
            "metaCampaignName": campaign_name,
            "metaAdsetName": adset_name,
            "metaAdName": ad_name,
            "metaFormName": lead_data.get("form_name"),
        }
    )

    await prisma.leadactivity.create(
        data={
            "leadId": lead.id,
            "type": LeadActivityType.SYSTEM,
            "body": f"Lead captured from Meta Ads{f' · {campaign_name}' if campaign_name else ''}",
            "metadata": json_meta({
                "leadgen_id": leadgen_id,
                "campaign_id": campaign_id,
                "campaign_name": campaign_name,
                "ad_id": ad_id,
                "form_id": form_id,
            }),
        }
    )

    # Do not advance lastSync here — that timestamp drives the connections UI and
    # used to feed incremental Graph filters, which permanently skipped any lead
    # missed before the watermark. Poll / Sync now own lastSync + leadsCount.
    await prisma.leadconnection.update_many(
        where={"organizationId": org_id, "sourceName": "META_ADS"},
        data={"leadsCount": {"increment": 1}},
    )

    schedule_greeting(org_id, lead.id)
    logger.info("Created lead %s from Meta leadgen_id=%s org=%s campaign=%s", lead.id, leadgen_id, org_id, campaign_name)


async def _find_connection_by_page(page_id: str):
    connections = await prisma.leadconnection.find_many(
        where={"sourceName": "META_ADS", "status": "connected"}
    )
    for conn in connections:
        creds = conn.credentials or {}
        pages = creds.get("pages", [])
        for page in pages:
            if page.get("page_id") == page_id:
                return conn
    return None


def _get_page_token(creds: dict, page_id: str) -> str | None:
    for page in creds.get("pages", []):
        if page.get("page_id") == page_id:
            return page.get("page_access_token")
    return None


def _compute_score(mapped: dict) -> int:
    score = 30  # META_ADS base
    if mapped.get("phone") and mapped.get("email"):
        score += 15
    elif mapped.get("phone") or mapped.get("email"):
        score += 8
    if mapped.get("product_interest"):
        score += 10
    if mapped.get("city"):
        score += 5
    return min(score, 100)
