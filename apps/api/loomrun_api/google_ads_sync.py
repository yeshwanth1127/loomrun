"""Google Ads lead form submission sync — poll loop, OAuth connect, and manual Sync now."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from loomrun_api.google_ads_client import (
    customer_id_from_resource,
    fetch_lead_form_submissions,
    get_valid_google_ads_token,
    map_submission_fields,
)
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.services.leads import compute_lead_score
from prisma.enums import LeadActivityType, LeadSource

logger = logging.getLogger(__name__)


def _submission_row(row: dict) -> tuple[dict, dict | None]:
    submission = row.get("leadFormSubmissionData") or row.get("lead_form_submission_data") or {}
    campaign = row.get("campaign") or {}
    return submission, campaign


async def _upsert_submission(
    org_id: str,
    customer_id: str,
    submission: dict,
    campaign: dict | None,
) -> tuple[str, str | None]:
    """
    Import one submission. Returns (action, detail) where action is created|skipped|duplicate.
    """
    submission_id = str(submission.get("id") or "")
    if not submission_id:
        resource = submission.get("resourceName") or submission.get("resource_name") or ""
        submission_id = (resource.rsplit("/", 1)[-1] if resource else "") or ""
    if not submission_id:
        return "skipped", "missing_id"

    existing = await prisma.lead.find_first(
        where={"organizationId": org_id, "googleAdsSubmissionId": submission_id}
    )
    if existing:
        return "skipped", submission_id

    fields = submission.get("leadFormSubmissionFields") or submission.get("lead_form_submission_fields")
    mapped = map_submission_fields(fields if isinstance(fields, list) else None)
    title = mapped.get("title") or "Google Ads Lead"
    phone = mapped.get("phone")
    email = mapped.get("email")

    duplicate = None
    if phone:
        duplicate = await prisma.lead.find_first(
            where={"organizationId": org_id, "phone": phone}
        )
    if not duplicate and email:
        duplicate = await prisma.lead.find_first(
            where={"organizationId": org_id, "email": email}
        )
    if duplicate:
        campaign_name = (campaign or {}).get("name")
        note = "New Google Ads lead form submission"
        if campaign_name:
            note += f" · {campaign_name}"
        await prisma.leadactivity.create(
            data={
                "leadId": duplicate.id,
                "type": LeadActivityType.SYSTEM,
                "body": note,
                "metadata": json_meta({
                    "google_ads_submission_id": submission_id,
                    "customer_id": customer_id,
                    "campaign_id": (campaign or {}).get("id"),
                }),
            }
        )
        await prisma.lead.update(
            where={"id": duplicate.id},
            data={"lastActivityAt": datetime.now(timezone.utc)},
        )
        return "duplicate", submission_id

    campaign_id = (campaign or {}).get("id")
    campaign_name = (campaign or {}).get("name")
    asset = submission.get("asset") or submission.get("assetResourceName")
    form_id = None
    if isinstance(asset, str) and "/assets/" in asset:
        form_id = asset.rsplit("/", 1)[-1]

    score = compute_lead_score(
        LeadSource.GOOGLE_ADS,
        phone,
        email,
        None,
        mapped.get("city"),
    )
    source_parts = []
    if campaign_name:
        source_parts.append(f"campaign:{campaign_name}")

    lead = await prisma.lead.create(
        data={
            "organizationId": org_id,
            "title": title,
            "source": LeadSource.GOOGLE_ADS,
            "phone": phone,
            "email": email,
            "city": mapped.get("city"),
            "company": mapped.get("company"),
            "leadScore": score,
            "sourceDetail": ", ".join(source_parts) if source_parts else None,
            "tags": [],
            "lastActivityAt": datetime.now(timezone.utc),
            "googleAdsSubmissionId": submission_id,
            "googleAdsCustomerId": customer_id,
            "googleAdsCampaignId": str(campaign_id) if campaign_id else None,
            "googleAdsCampaignName": campaign_name,
            "googleAdsFormId": form_id,
        }
    )
    await prisma.leadactivity.create(
        data={
            "leadId": lead.id,
            "type": LeadActivityType.SYSTEM,
            "body": (
                "Lead imported from Google Ads"
                f"{f' · {campaign_name}' if campaign_name else ''}"
            ),
            "metadata": json_meta({
                "google_ads_submission_id": submission_id,
                "customer_id": customer_id,
                "campaign_id": campaign_id,
                "form_id": form_id,
            }),
        }
    )
    return "created", submission_id


async def sync_org(org_id: str) -> dict:
    connection = await prisma.leadconnection.find_first(
        where={"organizationId": org_id, "sourceName": "GOOGLE_ADS", "status": "connected"}
    )
    if not connection:
        return {"status": "no_connection"}

    creds = connection.credentials or {}
    if not isinstance(creds, dict):
        creds = {}

    customer_ids = creds.get("customer_ids") or []
    if not customer_ids:
        return {
            "status": "no_customers",
            "created": 0,
            "skipped": 0,
            "duplicates": 0,
            "customer_errors": 0,
            "ads_available": 0,
            "total_google_ads": await prisma.lead.count(
                where={"organizationId": org_id, "source": LeadSource.GOOGLE_ADS}
            ),
            "retention_note": (
                "No Google Ads client accounts were found under your MCC. "
                "Test developer tokens only work with test accounts — add a test client under the MCC or apply for Basic access."
            ),
        }

    try:
        access_token, creds = await get_valid_google_ads_token(org_id)
    except Exception as exc:
        logger.warning("Google Ads token refresh failed org=%s: %s", org_id, exc)
        return {"status": "token_error", "detail": str(exc)}

    created = 0
    skipped = 0
    duplicates = 0
    customer_errors = 0
    ads_available = 0

    for customer_id in customer_ids:
        cid = customer_id_from_resource(str(customer_id)) or str(customer_id)
        try:
            rows = await fetch_lead_form_submissions(cid, access_token)
        except httpx.HTTPStatusError as exc:
            customer_errors += 1
            logger.warning(
                "Google Ads lead fetch failed org=%s customer=%s: %s",
                org_id,
                cid,
                exc.response.text[:300],
            )
            continue
        except Exception as exc:
            customer_errors += 1
            logger.warning("Google Ads lead fetch failed org=%s customer=%s: %s", org_id, cid, exc)
            continue

        ads_available += len(rows)
        for row in rows:
            submission, campaign = _submission_row(row)
            action, _ = await _upsert_submission(org_id, cid, submission, campaign)
            if action == "created":
                created += 1
            elif action == "duplicate":
                duplicates += 1
            else:
                skipped += 1

    total_google_ads = await prisma.lead.count(
        where={"organizationId": org_id, "source": LeadSource.GOOGLE_ADS}
    )
    now = datetime.now(timezone.utc)
    sync_stats = {
        "created": created,
        "skipped": skipped,
        "duplicates": duplicates,
        "ads_available": ads_available,
        "customer_errors": customer_errors,
        "total_google_ads": total_google_ads,
        "customer_count": len(customer_ids),
        "retention_note": (
            "Google Ads API Test access only returns data for test accounts. "
            "Apply for Basic developer token access to sync production lead forms."
        ),
        "synced_at": now.isoformat(),
    }

    creds_out = dict(creds)
    creds_out["sync_stats"] = sync_stats
    await prisma.leadconnection.update_many(
        where={"organizationId": org_id, "sourceName": "GOOGLE_ADS"},
        data={
            "leadsCount": total_google_ads,
            "lastSync": now,
            "credentials": json_meta(creds_out),
        },
    )
    logger.info(
        "Google Ads sync org=%s created=%d skipped=%d duplicates=%d ads_available=%d errors=%d total=%d",
        org_id,
        created,
        skipped,
        duplicates,
        ads_available,
        customer_errors,
        total_google_ads,
    )
    return {"status": "done", **sync_stats}


async def sync_all_google_ads_orgs() -> None:
    connections = await prisma.leadconnection.find_many(
        where={"sourceName": "GOOGLE_ADS", "status": "connected"}
    )
    for conn in connections:
        try:
            await sync_org(conn.organizationId)
        except Exception:
            logger.exception("Google Ads sync failed org=%s", conn.organizationId)
