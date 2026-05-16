import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from prisma.enums import OutboundChannel, OutboundMessageStatus

logger = logging.getLogger(__name__)
router = APIRouter()


class OutboundBody(BaseModel):
    lead_id: str
    message: str = Field(min_length=1, max_length=4096)


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
            "payload": {"text": body.message},
            "status": OutboundMessageStatus.QUEUED,
        }
    )
    return {"id": msg.id, "status": msg.status.name}
