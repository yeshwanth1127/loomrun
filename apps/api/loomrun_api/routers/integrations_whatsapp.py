import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from loomrun_api.date_filter import apply_created_at
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.whatsapp_template_defaults import (
    TEMPLATE_CATEGORIES,
    backfill_org_whatsapp_templates,
)
from prisma.enums import OutboundChannel, OutboundMessageStatus, WhatsAppTemplateCategory

logger = logging.getLogger(__name__)
router = APIRouter()

_VALID_CATEGORIES = {c.name for c in WhatsAppTemplateCategory}


class OutboundBody(BaseModel):
    lead_id: str
    message: str = Field(min_length=1, max_length=4096)


class WhatsAppSettingsBody(BaseModel):
    auto_greet_new_leads: bool


class TemplateCreateBody(BaseModel):
    category: str = Field(description="One of QUOTATION, INVOICE, FOLLOW_UP, THANK_YOU, GREETING")
    name: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=4096)


class TemplateUpdateBody(BaseModel):
    category: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=1, max_length=4096)


def _serialize_template(t) -> dict:
    return {
        "id": t.id,
        "category": t.category.name if hasattr(t.category, "name") else str(t.category),
        "name": t.name,
        "body": t.body,
        "is_default": t.isDefault,
        "created_at": t.createdAt.isoformat(),
        "updated_at": t.updatedAt.isoformat(),
    }


@router.get("/orgs/{org_id}/integrations/whatsapp/messages")
async def list_outbound_messages(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    ctx: OrgContext = Depends(require_roles("OWNER")),
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
async def queue_outbound(org_id: str, body: OutboundBody, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    from loomrun_api import baileys_client
    from loomrun_api.entitlements import METRIC_WHATSAPP, get_org_entitlements
    from loomrun_api.usage import increment_usage, require_capacity
    from loomrun_api.whatsapp_client import send_whatsapp_text

    lead = await prisma.lead.find_first(where={"id": body.lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if not lead.phone:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="This lead has no phone number on file")

    org = ctx.organization or await prisma.organization.find_unique(where={"id": ctx.organization_id})
    if org:
        ents = get_org_entitlements(org)
        await require_capacity(
            ctx.organization_id,
            ents=ents,
            metric=METRIC_WHATSAPP,
            limit=ents.messages_per_day,
            label="WhatsApp messaging",
        )

    # Deliver immediately: the org's self-hosted Baileys session if connected,
    # otherwise the Meta Cloud API. If the live send fails, leave it QUEUED so
    # the background poll loop retries it.
    if await baileys_client.is_connected(ctx.organization_id):
        sent = await baileys_client.send_text(ctx.organization_id, lead.phone, body.message)
    else:
        sent = await send_whatsapp_text(lead.phone, body.message)

    await increment_usage(ctx.organization_id, METRIC_WHATSAPP)

    msg = await prisma.outboundmessage.create(
        data={
            "organizationId": ctx.organization_id,
            "leadId": body.lead_id,
            "channel": OutboundChannel.WHATSAPP,
            "payload": json_meta({"text": body.message}),
            "status": OutboundMessageStatus.SENT if sent else OutboundMessageStatus.QUEUED,
            "attempts": 1 if sent else 0,
            "lastError": None if sent else "Immediate send failed — queued for retry",
        }
    )
    status_name = msg.status.name if hasattr(msg.status, "name") else str(msg.status)
    return {"id": msg.id, "status": status_name, "sent": sent}


# --- Settings -------------------------------------------------------------


@router.get("/orgs/{org_id}/integrations/whatsapp/settings")
async def get_whatsapp_settings(org_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    return {"auto_greet_new_leads": bool(org.autoGreetNewLeads) if org else True}


@router.patch("/orgs/{org_id}/integrations/whatsapp/settings")
async def update_whatsapp_settings(
    org_id: str,
    body: WhatsAppSettingsBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    org = await prisma.organization.update(
        where={"id": ctx.organization_id},
        data={"autoGreetNewLeads": body.auto_greet_new_leads},
    )
    return {"auto_greet_new_leads": bool(org.autoGreetNewLeads)}


# --- Message templates ----------------------------------------------------


@router.get("/orgs/{org_id}/integrations/whatsapp/templates")
async def list_templates(
    org_id: str,
    category: str | None = Query(None),
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    await backfill_org_whatsapp_templates(prisma, ctx.organization_id)
    where: dict = {"organizationId": ctx.organization_id}
    if category:
        if category not in _VALID_CATEGORIES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid category")
        where["category"] = WhatsAppTemplateCategory[category]
    rows = await prisma.whatsapptemplate.find_many(
        where=where,
        order=[{"category": "asc"}, {"name": "asc"}],
    )
    return {
        "items": [_serialize_template(t) for t in rows],
        "categories": [{"value": value, "label": label} for value, label in TEMPLATE_CATEGORIES],
    }


@router.post(
    "/orgs/{org_id}/integrations/whatsapp/templates",
    status_code=status.HTTP_201_CREATED,
)
async def create_template(
    org_id: str,
    body: TemplateCreateBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    if body.category not in _VALID_CATEGORIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid category")
    tmpl = await prisma.whatsapptemplate.create(
        data={
            "organizationId": ctx.organization_id,
            "category": WhatsAppTemplateCategory[body.category],
            "name": body.name.strip(),
            "body": body.body,
        }
    )
    return _serialize_template(tmpl)


@router.patch("/orgs/{org_id}/integrations/whatsapp/templates/{template_id}")
async def update_template(
    org_id: str,
    template_id: str,
    body: TemplateUpdateBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    existing = await prisma.whatsapptemplate.find_first(
        where={"id": template_id, "organizationId": ctx.organization_id}
    )
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Template not found")
    data: dict = {}
    if body.category is not None:
        if body.category not in _VALID_CATEGORIES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid category")
        data["category"] = WhatsAppTemplateCategory[body.category]
    if body.name is not None:
        data["name"] = body.name.strip()
    if body.body is not None:
        data["body"] = body.body
    if not data:
        return _serialize_template(existing)
    updated = await prisma.whatsapptemplate.update(where={"id": template_id}, data=data)
    return _serialize_template(updated)


@router.delete(
    "/orgs/{org_id}/integrations/whatsapp/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_template(
    org_id: str,
    template_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> None:
    existing = await prisma.whatsapptemplate.find_first(
        where={"id": template_id, "organizationId": ctx.organization_id}
    )
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Template not found")
    await prisma.whatsapptemplate.delete(where={"id": template_id})
