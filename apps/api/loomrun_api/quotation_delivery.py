from datetime import datetime, timezone

from fastapi import HTTPException, status

from prisma import Prisma

from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta

def _payload(data: dict):
    return json_meta(data)
from prisma.enums import LeadActivityType, LeadStage, OutboundChannel, OutboundMessageStatus

STAGE_ORDER = [
    LeadStage.NEW,
    LeadStage.CONTACTED,
    LeadStage.QUALIFICATION,
    LeadStage.QUOTATION,
    LeadStage.NEGOTIATION,
    LeadStage.SAMPLE,
    LeadStage.WON,
    LeadStage.LOST,
]


def _stage_rank(stage: LeadStage) -> int:
    try:
        return STAGE_ORDER.index(stage)
    except ValueError:
        return -1


def build_quotation_message(*, lead_title: str, number: str, total: float, org_name: str | None) -> str:
    org = org_name or "our team"
    return (
        f"Hi {lead_title},\n\n"
        f"Your quotation {number} is ready.\n"
        f"Total: ₹{total:,.2f}\n\n"
        f"Please log in to view and download the PDF.\n\n"
        f"Thanks,\n{org}"
    )


async def advance_lead_to_quotation(
    *,
    lead_id: str,
    user_id: str | None,
    quotation_number: str,
    channel: str,
) -> LeadStage:
    lead = await prisma.lead.find_unique(where={"id": lead_id})
    if not lead:
        return LeadStage.QUOTATION
    now = datetime.now(timezone.utc)
    channel_label = "WhatsApp" if channel == "whatsapp" else "Email"

    if lead.stage in (LeadStage.WON, LeadStage.LOST):
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.SYSTEM,
                "body": f"Quotation {quotation_number} sent via {channel_label} (stage unchanged)",
            }
        )
        await prisma.lead.update(where={"id": lead_id}, data={"lastActivityAt": now})
        return lead.stage

    target = LeadStage.QUOTATION
    if _stage_rank(lead.stage) < _stage_rank(target):
        await prisma.lead.update(
            where={"id": lead_id},
            data={"stage": target, "lastActivityAt": now},
        )
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.STAGE_CHANGE,
                "body": f"Moved to Quoted — quotation {quotation_number} sent via {channel_label}",
                "metadata": json_meta({"stage": "QUOTATION", "quotation_number": quotation_number, "channel": channel}),
            },
        )
    else:
        await prisma.lead.update(where={"id": lead_id}, data={"lastActivityAt": now})
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.SYSTEM,
                "body": f"Quotation {quotation_number} sent via {channel_label}",
            }
        )
    return target


async def deliver_quotation(
    *,
    organization_id: str,
    quotation,
    lead,
    org_name: str | None,
    channel: str,
    user_id: str | None,
    db: Prisma | None = None,
) -> dict:
    """Record a send immediately (stub — real delivery wired later)."""
    client = db or prisma
    message = build_quotation_message(
        lead_title=lead.title,
        number=quotation.number,
        total=float(quotation.total),
        org_name=org_name,
    )

    if channel == "whatsapp":
        outbound_channel = OutboundChannel.WHATSAPP
        payload = {
            "text": message,
            "quotation_id": quotation.id,
            "quotation_number": quotation.number,
            "to": lead.phone,
            "stub": True,
        }
        delivery = {"channel": "whatsapp", "to": lead.phone}
    elif channel == "email":
        outbound_channel = OutboundChannel.EMAIL
        subject = f"Quotation {quotation.number}"
        payload = {
            "subject": subject,
            "text": message,
            "to": lead.email,
            "quotation_id": quotation.id,
            "quotation_number": quotation.number,
            "stub": True,
        }
        delivery = {"channel": "email", "to": lead.email}
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="channel must be whatsapp or email")

    outbound = await client.outboundmessage.create(
        data={
            "organizationId": organization_id,
            "leadId": lead.id,
            "channel": outbound_channel,
            "payload": _payload(payload),
            "status": OutboundMessageStatus.SENT,
        }
    )
    delivery["outbound_id"] = outbound.id
    delivery["stub"] = True
    return delivery
