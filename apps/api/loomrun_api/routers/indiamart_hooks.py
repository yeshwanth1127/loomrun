import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.indiamart_client import map_record, sync_org, upsert_lead
from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/hooks/leads/{org_id}/indiamart", status_code=status.HTTP_200_OK)
async def indiamart_push_webhook(org_id: str, request: Request) -> dict:
    """
    Receives real-time lead pushes from IndiaMart's Push API.
    Configure this URL in the IndiaMart seller portal under
    Lead Manager → Push API Integration → Custom URL.
    """
    connection = await prisma.leadconnection.find_first(
        where={"organizationId": org_id, "sourceName": "INDIAMART", "status": "connected"}
    )
    if not connection:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No connected IndiaMart account")

    payload: Any = await request.json()
    # IndiaMart may push a single object or a list
    leads_raw = payload if isinstance(payload, list) else [payload]

    created = 0
    for raw in leads_raw:
        mapped = map_record(raw)
        if await upsert_lead(org_id, mapped):
            created += 1

    if created > 0:
        await prisma.leadconnection.update_many(
            where={"organizationId": org_id, "sourceName": "INDIAMART"},
            data={"leadsCount": {"increment": created}, "lastSync": datetime.now(timezone.utc)},
        )

    logger.info("IndiaMart push org=%s created=%d", org_id, created)
    return {"status": "ok", "created": created}


@router.post("/orgs/{org_id}/lead-connections/indiamart/sync")
async def sync_indiamart_now(org_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    """Trigger an immediate Pull API sync for this org."""
    result = await sync_org(org_id)
    if result.get("status") == "no_connection":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No connected IndiaMart account")
    if result.get("status") == "no_api_key":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="CRM key not configured")
    if result.get("status") == "api_error":
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"IndiaMart API error: {result.get('error')}")
    return result
