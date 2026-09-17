import logging
from datetime import datetime, timedelta, timezone

import httpx

from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.whatsapp_template_service import schedule_greeting
from prisma.enums import LeadActivityType, LeadSource

logger = logging.getLogger(__name__)

_PULL_URL = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/"


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------

def _fmt_time(dt: datetime) -> str:
    """Format datetime to IndiaMart's expected DD-MON-YYYY HH:MM:SS format."""
    return dt.strftime("%d-%b-%Y %H:%M:%S").upper()


async def fetch_leads(crm_key: str, start: datetime, end: datetime) -> list[dict]:
    """Call the IndiaMart Pull API v2. Returns a list of raw lead records."""
    params = {
        "glusr_crm_key": crm_key,
        "start_time": _fmt_time(start),
        "end_time": _fmt_time(end),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(_PULL_URL, params=params)
        resp.raise_for_status()
    data = resp.json()
    # CODE may be int 200 or string "200"
    if str(data.get("CODE")) != "200":
        logger.debug("IndiaMart API non-200 response: %s", data.get("MESSAGE"))
        return []
    return data.get("RESPONSE") or []


# ---------------------------------------------------------------------------
# Field mapping & scoring
# ---------------------------------------------------------------------------

def map_record(r: dict) -> dict:
    """Normalise a raw IndiaMart record to our internal shape."""
    return {
        "query_id": str(r.get("QUERY_ID", "")).strip(),
        "name": (r.get("SENDERNAME") or "").strip(),
        "phone": r.get("MOB") or None,
        "email": r.get("SENDEREMAIL") or None,
        "city": r.get("ENQ_CITY") or None,
        "state": r.get("ENQ_STATE") or None,
        "company": r.get("GLUSR_USR_COMPANYNAME") or None,
        "product": r.get("PRODUCT_NAME") or None,
        "message": r.get("ENQ_MESSAGE") or None,
    }


def _score(r: dict) -> int:
    score = 25  # INDIAMART base
    if r["phone"] and r["email"]:
        score += 15
    elif r["phone"] or r["email"]:
        score += 8
    if r["product"]:
        score += 10
    if r["city"]:
        score += 5
    return min(score, 100)


# ---------------------------------------------------------------------------
# Upsert helper (used by both polling sync and push webhook)
# ---------------------------------------------------------------------------

async def upsert_lead(org_id: str, r: dict) -> bool:
    """
    Create a lead from a mapped IndiaMart record if it doesn't already exist.
    Returns True if a new lead was created.
    Uses the shared prisma client (main-process only).
    """
    if not r["query_id"]:
        return False

    existing = await prisma.lead.find_first(
        where={"organizationId": org_id, "indiamartQueryId": r["query_id"]}
    )
    if existing:
        return False

    from loomrun_api.pipeline_routing import merge_pipeline_into_create_data

    create_data = {
        "organizationId": org_id,
        "title": r["name"] or "IndiaMart Inquiry",
        "source": LeadSource.INDIAMART,
        "phone": r["phone"],
        "email": r["email"],
        "city": r["city"],
        "company": r["company"],
        "productInterest": r["product"],
        "notes": r["message"],
        "leadScore": _score(r),
        "indiamartQueryId": r["query_id"],
        "tags": [],
        "lastActivityAt": datetime.now(timezone.utc),
    }
    create_data = await merge_pipeline_into_create_data(create_data, organization_id=org_id)
    lead = await prisma.lead.create(data=create_data)
    product_suffix = f" · {r['product']}" if r["product"] else ""
    await prisma.leadactivity.create(
        data={
            "leadId": lead.id,
            "type": LeadActivityType.SYSTEM,
            "body": f"Lead received from IndiaMart{product_suffix}",
            "metadata": json_meta({"query_id": r["query_id"]}),
        }
    )
    schedule_greeting(org_id, lead.id)
    return True


# ---------------------------------------------------------------------------
# Sync functions (used by poll loop and manual-sync endpoint)
# ---------------------------------------------------------------------------

async def sync_org(org_id: str) -> dict:
    """
    Pull the latest leads for one org via the Pull API.
    Uses lastSync as the cursor; defaults to last 24 h on first run.
    """
    connection = await prisma.leadconnection.find_first(
        where={"organizationId": org_id, "sourceName": "INDIAMART", "status": "connected"}
    )
    if not connection:
        return {"status": "no_connection"}

    crm_key = (connection.credentials or {}).get("api_key")
    if not crm_key:
        return {"status": "no_api_key"}

    now = datetime.now(timezone.utc)
    start = connection.lastSync or (now - timedelta(hours=24))

    try:
        records = await fetch_leads(crm_key, start, now)
    except Exception as exc:
        logger.warning("IndiaMart API error org=%s: %s", org_id, exc)
        return {"status": "api_error", "error": str(exc)}

    created = 0
    skipped = 0
    for raw in records:
        mapped = map_record(raw)
        if await upsert_lead(org_id, mapped):
            created += 1
        else:
            skipped += 1

    await prisma.leadconnection.update_many(
        where={"organizationId": org_id, "sourceName": "INDIAMART"},
        data={"leadsCount": {"increment": created}, "lastSync": now},
    )
    logger.info("IndiaMart sync org=%s created=%d skipped=%d", org_id, created, skipped)
    return {"status": "done", "created": created, "skipped": skipped}


async def sync_all_orgs() -> None:
    """Sync IndiaMart leads for every connected org. Called by the poll loop."""
    connections = await prisma.leadconnection.find_many(
        where={"sourceName": "INDIAMART", "status": "connected"}
    )
    for conn in connections:
        try:
            await sync_org(conn.organizationId)
        except Exception:
            logger.exception("IndiaMart sync failed org=%s", conn.organizationId)
