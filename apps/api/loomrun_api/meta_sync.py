"""Meta Ads lead sync — used by poll loop, OAuth connect, and manual Sync now."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from loomrun_api.meta_client import (
    fetch_lead_forms,
    fetch_leads_from_form,
    map_lead_fields,
    parse_field_data,
)
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from prisma.enums import LeadActivityType, LeadSource

logger = logging.getLogger(__name__)


async def sync_org(org_id: str) -> dict:
    """
    Pull Meta Instant Form leads for one org and insert any missing ones.

    Always does a full form history pull (whatever Meta still exposes, typically
    ~90 days). Incremental ``lastSync`` filtering was dropped because a partial
    earlier run permanently skipped older leads on every subsequent sync.
    Dedupes on ``metaLeadgenId``.
    """
    connection = await prisma.leadconnection.find_first(
        where={"organizationId": org_id, "sourceName": "META_ADS", "status": "connected"}
    )
    if not connection:
        return {"status": "no_connection"}

    creds = connection.credentials or {}
    pages = creds.get("pages", []) if isinstance(creds, dict) else []

    created = 0
    skipped = 0
    form_errors = 0
    meta_available = 0

    for page in pages:
        page_id = page.get("page_id")
        page_token = page.get("page_access_token")
        if not page_id or not page_token:
            continue

        try:
            forms = await fetch_lead_forms(page_id, page_token)
        except Exception as exc:
            form_errors += 1
            logger.warning("Could not fetch forms for page %s: %s", page_id, exc)
            continue

        for form in forms:
            form_id = form["id"]
            form_name = form.get("name")
            reported = int(form.get("leads_count") or 0)
            try:
                # Full reconcile — do not pass since=lastSync.
                leads = await fetch_leads_from_form(form_id, page_token, since=None)
            except Exception as exc:
                form_errors += 1
                logger.warning("Could not fetch leads for form %s: %s", form_id, exc)
                continue

            meta_available += len(leads)
            if reported and len(leads) < reported:
                logger.warning(
                    "Meta form %s reported leads_count=%d but API returned %d "
                    "(older leads may have expired from Meta's retrieval window)",
                    form_id,
                    reported,
                    len(leads),
                )

            for lead_data in leads:
                leadgen_id = lead_data.get("id")
                if not leadgen_id:
                    continue

                existing = await prisma.lead.find_first(
                    where={"organizationId": org_id, "metaLeadgenId": leadgen_id}
                )
                if existing:
                    skipped += 1
                    continue

                flat = parse_field_data(lead_data.get("field_data", []))
                mapped = map_lead_fields(flat)

                campaign_id = lead_data.get("campaign_id")
                campaign_name = lead_data.get("campaign_name")
                adset_id = lead_data.get("adset_id")
                adset_name = lead_data.get("adset_name")
                ad_id = lead_data.get("ad_id")
                ad_name = lead_data.get("ad_name")

                score = 30
                if mapped.get("phone") and mapped.get("email"):
                    score += 15
                elif mapped.get("phone") or mapped.get("email"):
                    score += 8
                if mapped.get("product_interest"):
                    score += 10
                if mapped.get("city"):
                    score += 5
                score = min(score, 100)

                source_parts = []
                if campaign_name:
                    source_parts.append(f"campaign:{campaign_name}")
                if ad_name:
                    source_parts.append(f"ad:{ad_name}")

                from loomrun_api.pipeline_routing import merge_pipeline_into_create_data

                create_data = {
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
                    "metaFormId": str(form_id),
                    "metaAdId": str(ad_id) if ad_id else None,
                    "metaAdsetId": str(adset_id) if adset_id else None,
                    "metaCampaignId": str(campaign_id) if campaign_id else None,
                    "metaCampaignName": campaign_name,
                    "metaAdsetName": adset_name,
                    "metaAdName": ad_name,
                    "metaFormName": form_name,
                    "campaignId": str(campaign_id) if campaign_id else None,
                    "campaignName": campaign_name,
                }
                create_data = await merge_pipeline_into_create_data(create_data, organization_id=org_id)
                lead = await prisma.lead.create(data=create_data)
                await prisma.leadactivity.create(
                    data={
                        "leadId": lead.id,
                        "type": LeadActivityType.SYSTEM,
                        "body": (
                            f"Lead imported from Meta Ads history"
                            f"{f' · {campaign_name}' if campaign_name else ''}"
                        ),
                        "metadata": json_meta(
                            {
                                "leadgen_id": leadgen_id,
                                "form_id": form_id,
                                "campaign_id": campaign_id,
                            }
                        ),
                    }
                )
                # No auto-greeting: bulk/historical import, not a live new lead.
                created += 1

    total_meta = await prisma.lead.count(
        where={"organizationId": org_id, "source": LeadSource.META_ADS}
    )
    now = datetime.now(timezone.utc)
    sync_stats = {
        "created": created,
        "skipped": skipped,
        "meta_available": meta_available,
        "form_errors": form_errors,
        "total_meta": total_meta,
        # Meta Ads Manager "Results" / lifetime lead counts include Instant Form
        # submissions older than ~90 days that Meta no longer returns via Graph.
        "retention_note": (
            "Meta only lets apps download Instant Form lead details for about 90 days. "
            "Ads Manager lifetime lead totals can be higher than what is still downloadable."
        ),
        "synced_at": now.isoformat(),
    }

    # Preserve OAuth tokens; attach last reconcile stats for the connections UI.
    creds_out: dict = dict(creds) if isinstance(creds, dict) else {}
    creds_out["sync_stats"] = sync_stats
    await prisma.leadconnection.update_many(
        where={"organizationId": org_id, "sourceName": "META_ADS"},
        data={
            "leadsCount": total_meta,
            "lastSync": now,
            "credentials": json_meta(creds_out),
        },
    )
    logger.info(
        "Meta sync org=%s created=%d skipped=%d meta_available=%d form_errors=%d total_meta=%d",
        org_id,
        created,
        skipped,
        meta_available,
        form_errors,
        total_meta,
    )
    return {"status": "done", **sync_stats}


async def sync_all_meta_orgs() -> None:
    """Sync Meta leads for every connected org. Called by the poll loop."""
    connections = await prisma.leadconnection.find_many(
        where={"sourceName": "META_ADS", "status": "connected"}
    )
    for conn in connections:
        try:
            await sync_org(conn.organizationId)
        except Exception:
            logger.exception("Meta sync failed org=%s", conn.organizationId)
