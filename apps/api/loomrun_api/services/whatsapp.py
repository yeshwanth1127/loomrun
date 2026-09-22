"""WhatsApp messaging shared by HTTP routers and the AI agent.

Mirrors what the WhatsApp screen lets a person do, so the agent and the UI
cannot drift apart: same delivery path (self-hosted Baileys session when the
org has one connected, Meta Cloud API otherwise), same plan metering, and the
same outbound record afterwards.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status

from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.services.leads import apply_created_updated_filters, resolve_lead
from prisma.enums import OutboundChannel, OutboundMessageStatus


async def get_whatsapp_status(*, organization_id: str) -> dict[str, Any]:
    """Whether this org can send right now, and over which transport."""
    from loomrun_api import baileys_client

    connected = await baileys_client.is_connected(organization_id)
    return {
        "connected": connected,
        "transport": "baileys" if connected else "meta_cloud_api",
        "note": (
            "Sending works over the org's own WhatsApp session when connected, "
            "otherwise the Meta Cloud API."
        ),
    }


async def send_whatsapp_message(
    *,
    organization_id: str,
    message: str,
    lead_id: str | None = None,
    phone: str | None = None,
) -> dict[str, Any]:
    """Send a WhatsApp text.

    Addressed either by `lead_id` (an id or the lead/company name, whose stored
    number is used) or by an explicit `phone`. Passing both sends to `phone`
    while still filing the message against that lead, which is what you want
    when a lead has a second number on their record.
    """
    from loomrun_api import baileys_client
    from loomrun_api.entitlements import METRIC_WHATSAPP, get_org_entitlements
    from loomrun_api.usage import increment_usage, require_capacity
    from loomrun_api.whatsapp_client import send_whatsapp_text

    text = (message or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="message is required")

    lead = None
    if lead_id:
        lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)

    to_phone = (phone or "").strip() or (lead.phone if lead else None)
    if not to_phone:
        if lead is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Lead '{lead.title}' has no phone number on file. Pass `phone` "
                    "explicitly, or add a number to the lead first."
                ),
            )
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Provide `lead_id` (to use the lead's number) or `phone`.",
        )

    org = await prisma.organization.find_unique(where={"id": organization_id})
    if org:
        ents = get_org_entitlements(org)
        await require_capacity(
            organization_id,
            ents=ents,
            metric=METRIC_WHATSAPP,
            limit=ents.messages_per_day,
            label="WhatsApp messaging",
        )

    if await baileys_client.is_connected(organization_id):
        sent = await baileys_client.send_text(organization_id, to_phone, text)
    else:
        sent = await send_whatsapp_text(to_phone, text)

    await increment_usage(organization_id, METRIC_WHATSAPP)

    row = await prisma.outboundmessage.create(
        data={
            "organizationId": organization_id,
            "leadId": lead.id if lead else None,
            "channel": OutboundChannel.WHATSAPP,
            "payload": json_meta({"text": text}),
            # A failed live send stays QUEUED so the background poll retries it,
            # exactly as the HTTP route does.
            "status": OutboundMessageStatus.SENT if sent else OutboundMessageStatus.QUEUED,
        }
    )
    return {
        "id": row.id,
        "lead_id": lead.id if lead else None,
        "lead_title": lead.title if lead else None,
        "to": to_phone,
        "message": text,
        "status": row.status.name if hasattr(row.status, "name") else str(row.status),
        "delivered": bool(sent),
    }


async def list_whatsapp_messages(
    *,
    organization_id: str,
    lead_id: str | None = None,
    limit: int = 30,
    created_after: str | None = None,
    created_before: str | None = None,
    updated_after: str | None = None,
    updated_before: str | None = None,
    timezone: str | None = None,
) -> dict[str, Any]:
    """Recent outbound WhatsApp messages, newest first."""
    where: dict[str, Any] = {
        "organizationId": organization_id,
        "channel": OutboundChannel.WHATSAPP,
    }
    if lead_id:
        lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
        where["leadId"] = lead.id
    apply_created_updated_filters(
        where,
        created_after=created_after,
        created_before=created_before,
        updated_after=updated_after,
        updated_before=updated_before,
        timezone=timezone,
    )

    take = max(1, min(int(limit or 30), 100))
    total = await prisma.outboundmessage.count(where=where)
    rows = await prisma.outboundmessage.find_many(
        where=where, order={"createdAt": "desc"}, take=take, include={"lead": True}
    )
    return {
        "items": [
            {
                "id": r.id,
                "lead_id": r.leadId,
                "lead_title": r.lead.title if r.lead else None,
                "status": r.status.name if hasattr(r.status, "name") else str(r.status),
                "created_at": r.createdAt.isoformat(),
            }
            for r in rows
        ],
        "count": len(rows),
        "total": total,
    }
