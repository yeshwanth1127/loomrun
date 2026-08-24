"""Catalog, team, and quotation read/write tools."""

from __future__ import annotations

from typing import Any

from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool
from loomrun_api.prisma_client import prisma
from loomrun_api.services import quotations as quote_svc


@register_tool(
    name="list_catalog",
    description="List catalog products/prices for building quotation lines.",
    parameters={
        "search": {"type": "string", "description": "Optional name/SKU filter"},
        "limit": {"type": "integer", "default": 40},
    },
    kind="read",
    modes=("minimal", "advanced"),
    owner_only=True,
)
async def list_catalog(
    ctx: ToolContext,
    search: str | None = None,
    limit: int = 40,
    **_: Any,
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    if search:
        where["OR"] = [
            {"name": {"contains": search, "mode": "insensitive"}},
            {"sku": {"contains": search, "mode": "insensitive"}},
        ]
    take = max(1, min(int(limit or 40), 80))
    items = await prisma.catalogitem.find_many(
        where=where,
        order={"updatedAt": "desc"},
        take=take,
    )
    return {
        "items": [
            {
                "id": i.id,
                "name": i.name,
                "description": i.description,
                "unit_price": float(i.unitPrice),
                "sku": i.sku,
            }
            for i in items
        ],
        "count": len(items),
    }


@register_tool(
    name="list_team_members",
    description="List org members (for assigning leads by name/email).",
    parameters={},
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_team_members(ctx: ToolContext, **_: Any) -> dict:
    members = await prisma.membership.find_many(
        where={"organizationId": ctx.organization_id},
        include={"user": True},
        take=50,
    )
    return {
        "items": [
            {
                "user_id": m.userId,
                "name": (m.user.name if m.user else None) or "",
                "email": m.user.email if m.user else "",
                "role": m.role.name if hasattr(m.role, "name") else str(m.role),
            }
            for m in members
        ]
    }


@register_tool(
    name="get_quotation",
    description="Get a quotation/invoice by id.",
    parameters={"quotation_id": {"type": "string"}},
    kind="read",
    modes=("minimal", "advanced"),
    required=["quotation_id"],
    owner_only=True,
)
async def get_quotation(ctx: ToolContext, quotation_id: str, **_: Any) -> dict:
    return await quote_svc.get_quotation(
        organization_id=ctx.organization_id,
        quotation_id=quotation_id,
    )


@register_tool(
    name="list_quotations_for_lead",
    description="List quotations for a lead.",
    parameters={
        "lead_id": {"type": "string"},
        "limit": {"type": "integer", "default": 20},
    },
    kind="read",
    modes=("minimal", "advanced"),
    required=["lead_id"],
    owner_only=True,
)
async def list_quotations_for_lead(
    ctx: ToolContext,
    lead_id: str,
    limit: int = 20,
    **_: Any,
) -> dict:
    return await quote_svc.list_quotations_for_lead(
        organization_id=ctx.organization_id,
        lead_id=lead_id,
        limit=limit,
    )


def _quote_line_schema() -> dict:
    return {
        "type": "array",
        "description": "Line items",
        "items": {
            "type": "object",
            "properties": {
                "description": {"type": "string"},
                "quantity": {"type": "number"},
                "unit_price": {"type": "number"},
            },
            "required": ["description", "quantity", "unit_price"],
        },
    }


@register_tool(
    name="create_quotation",
    description="Create a draft quotation for a lead.",
    parameters={
        "lead_id": {"type": "string"},
        "lines": _quote_line_schema(),
    },
    kind="write",
    modes=("advanced",),
    required=["lead_id", "lines"],
    summary_fn=lambda a: f"Create quotation for lead {a.get('lead_id')} ({len(a.get('lines') or [])} lines)",
    owner_only=True,
)
async def create_quotation(
    ctx: ToolContext,
    lead_id: str,
    lines: list[dict],
    **_: Any,
) -> dict:
    return await quote_svc.create_quotation(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        lead_id=lead_id,
        lines=lines,
    )


@register_tool(
    name="send_quotation",
    description="Send an existing quotation PDF via WhatsApp or email.",
    parameters={
        "quotation_id": {"type": "string"},
        "channel": {
            "type": "string",
            "enum": ["whatsapp", "email"],
            "description": "Delivery channel (default whatsapp)",
        },
    },
    kind="write",
    modes=("advanced",),
    required=["quotation_id"],
    summary_fn=lambda a: f"Send quotation {a.get('quotation_id')} via {a.get('channel') or 'whatsapp'}",
    owner_only=True,
)
async def send_quotation(
    ctx: ToolContext,
    quotation_id: str,
    channel: str = "whatsapp",
    **_: Any,
) -> dict:
    ch = channel if channel in ("whatsapp", "email") else "whatsapp"
    return await quote_svc.send_document(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        quotation_id=quotation_id,
        channel=ch,  # type: ignore[arg-type]
        doc_type="quotation",
        ensure_pdf_first=True,
    )


@register_tool(
    name="generate_invoice",
    description="Convert a quotation into an invoice (allocates INV number).",
    parameters={"quotation_id": {"type": "string"}},
    kind="write",
    modes=("advanced",),
    required=["quotation_id"],
    summary_fn=lambda a: f"Generate invoice from quotation {a.get('quotation_id')}",
    owner_only=True,
)
async def generate_invoice(ctx: ToolContext, quotation_id: str, **_: Any) -> dict:
    return await quote_svc.generate_invoice(
        organization_id=ctx.organization_id,
        quotation_id=quotation_id,
        queue_pdf=False,
        wait_pdf=True,
    )


@register_tool(
    name="send_invoice",
    description="Send an invoiced quotation as an invoice via WhatsApp or email.",
    parameters={
        "quotation_id": {"type": "string"},
        "channel": {"type": "string", "enum": ["whatsapp", "email"]},
    },
    kind="write",
    modes=("advanced",),
    required=["quotation_id"],
    summary_fn=lambda a: f"Send invoice {a.get('quotation_id')} via {a.get('channel') or 'whatsapp'}",
    owner_only=True,
)
async def send_invoice(
    ctx: ToolContext,
    quotation_id: str,
    channel: str = "whatsapp",
    **_: Any,
) -> dict:
    ch = channel if channel in ("whatsapp", "email") else "whatsapp"
    return await quote_svc.send_document(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        quotation_id=quotation_id,
        channel=ch,  # type: ignore[arg-type]
        doc_type="invoice",
        ensure_pdf_first=True,
    )


@register_tool(
    name="create_and_send_quotation",
    description=(
        "Create a quotation for a lead, generate PDF, and send it in one step. "
        "Prefer this when the user wants to create and send together."
    ),
    parameters={
        "lead_id": {"type": "string"},
        "lines": _quote_line_schema(),
        "channel": {"type": "string", "enum": ["whatsapp", "email"]},
    },
    kind="write",
    modes=("advanced",),
    required=["lead_id", "lines"],
    summary_fn=lambda a: (
        f"Create & send quotation to lead {a.get('lead_id')} "
        f"via {a.get('channel') or 'whatsapp'} ({len(a.get('lines') or [])} lines)"
    ),
    owner_only=True,
)
async def create_and_send_quotation(
    ctx: ToolContext,
    lead_id: str,
    lines: list[dict],
    channel: str = "whatsapp",
    **_: Any,
) -> dict:
    ch = channel if channel in ("whatsapp", "email") else "whatsapp"
    return await quote_svc.create_and_send_quotation(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        lead_id=lead_id,
        lines=lines,
        channel=ch,  # type: ignore[arg-type]
    )


@register_tool(
    name="create_and_send_invoice",
    description=(
        "Invoice an existing quotation (or create one from lead+lines), then send the invoice. "
        ""
    ),
    parameters={
        "quotation_id": {"type": "string", "description": "Existing quotation to invoice"},
        "lead_id": {"type": "string", "description": "If creating new: lead id"},
        "lines": _quote_line_schema(),
        "channel": {"type": "string", "enum": ["whatsapp", "email"]},
    },
    kind="write",
    modes=("advanced",),
    summary_fn=lambda a: (
        f"Create & send invoice "
        f"({a.get('quotation_id') or ('new for ' + str(a.get('lead_id')))})"
        f" via {a.get('channel') or 'whatsapp'}"
    ),
    owner_only=True,
)
async def create_and_send_invoice(
    ctx: ToolContext,
    quotation_id: str | None = None,
    lead_id: str | None = None,
    lines: list[dict] | None = None,
    channel: str = "whatsapp",
    **_: Any,
) -> dict:
    ch = channel if channel in ("whatsapp", "email") else "whatsapp"
    return await quote_svc.create_and_send_invoice(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        quotation_id=quotation_id,
        lead_id=lead_id,
        lines=lines,
        channel=ch,  # type: ignore[arg-type]
    )
