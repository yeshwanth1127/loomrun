import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from loomrun_api.date_filter import apply_created_at
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from prisma.enums import OutboundChannel, OutboundMessageStatus

logger = logging.getLogger(__name__)
router = APIRouter()


class OutboundBody(BaseModel):
    lead_id: str
    message: str = Field(min_length=1, max_length=4096)


@router.get("/orgs/{org_id}/integrations/whatsapp/messages")
async def list_outbound_messages(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    where: dict = {
        "organizationId": ctx.organization_id,
        "channel": OutboundChannel.WHATSAPP,
    }
    apply_created_at(where, day)
    rows = await prisma.outboundmessage.find_many(
        where=where,
        order={"createdAt": "desc"},
        include={"lead": True},
    )
    return {
        "items": [
            {
                "id": r.id,
                "lead_id": r.leadId,
                "lead_title": r.lead.title if r.lead else None,
                "status": r.status.name if hasattr(r.status, "name") else str(r.status),
                "message": (r.payload or {}).get("text") if isinstance(r.payload, dict) else None,
                "created_at": r.createdAt.isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/orgs/{org_id}/integrations/whatsapp/outbound", status_code=status.HTTP_201_CREATED)
async def queue_outbound(org_id: str, body: OutboundBody, ctx: OrgContext = Depends(get_org_context)) -> dict:
    lead = await prisma.lead.find_first(where={"id": body.lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    msg = await prisma.outboundmessage.create(
        data={
            "organizationId": ctx.organization_id,
            "leadId": body.lead_id,
            "channel": OutboundChannel.WHATSAPP,
            "payload": json_meta({"text": body.message}),
            "status": OutboundMessageStatus.QUEUED,
        }
    )
    return {"id": msg.id, "status": msg.status.name}
