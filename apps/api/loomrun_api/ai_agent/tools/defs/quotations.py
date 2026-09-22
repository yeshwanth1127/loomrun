"""Catalog, team, and quotation read/write tools."""

from __future__ import annotations

import re
from typing import Any

from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool
from loomrun_api.prisma_client import prisma
from loomrun_api.services import quotations as quote_svc
from loomrun_api.services.leads import DATE_BOUND_PARAMETERS


@register_tool(
    name="list_catalog",
    description=(
        "WHEN: look up products/prices to build quotation lines. NOT: listing "
        "leads or quotations. RETURNS: short catalog cards (id, name, sku, unit_price)."
    ),
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
    description=(
        "WHEN: resolve a teammate by name/email to an assignee user id. "
        "NOT: listing leads, quoting details of leads, or answering how many "
        "leads are in a stage (search_leads / count_leads). RETURNS: user_id, "
        "name, email, role."
    ),
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
    description=(
        "WHEN: full details of one quotation/invoice you already identified, "
        "including line items. NOT: finding quotes for a customer "
        "(list_quotations_for_lead) or listing leads. NEEDS: quotation_id. "
        "If you only have a customer name, search_leads then "
        "list_quotations_for_lead. Never ask the user for an internal id."
    ),
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
    description=(
        "WHEN: quotations/proposals for a lead you already identified. NOT: a "
        "general lead list, WON-lead details, or a count — those are "
        "search_leads / get_lead / count_leads. NEEDS: lead_id (id or "
        "customer/company name). If you do not have one, call search_leads "
        "first. Never ask the user for an internal id. RETURNS: short cards "
        "(id, number, status, total, dates). Use get_quotation for line items."
    ),
    parameters={
        "lead_id": {
            "type": "string",
            "description": "Lead id, or the lead/company name",
        },
        "limit": {"type": "integer", "default": 20},
        **DATE_BOUND_PARAMETERS,
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
    created_after: str | None = None,
    created_before: str | None = None,
    updated_after: str | None = None,
    updated_before: str | None = None,
    timezone: str | None = None,
    **_: Any,
) -> dict:
    return await quote_svc.list_quotations_for_lead(
        organization_id=ctx.organization_id,
        lead_id=lead_id,
        limit=limit,
        created_after=created_after,
        created_before=created_before,
        updated_after=updated_after,
        updated_before=updated_before,
        timezone=timezone or ctx.timezone,
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
    description=(
        "WHEN: create a draft quotation for a lead. NEEDS: lead_id (id or "
        "customer/company name) and lines. Never ask the user for an internal id."
    ),
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


def _norm_line_desc(value: str) -> str:
    """Loose match key: lowercase alphanumerics only (t-shirts == tshirts)."""
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def _line_matches(desc: str, match: str) -> bool:
    a = _norm_line_desc(desc)
    b = _norm_line_desc(match)
    if not a or not b:
        return False
    return a == b or a in b or b in a


def _inherit_qty_price(
    ln: dict[str, Any],
    *,
    current_lines: list[dict[str, Any]],
    index: int,
) -> dict[str, Any]:
    """When the model sends qty/price as 0, keep the existing commercial values."""
    qty = float(ln.get("quantity") if ln.get("quantity") is not None else 0)
    price = float(ln.get("unit_price") if ln.get("unit_price") is not None else 0)
    if qty != 0 or price != 0 or not current_lines:
        return {
            "description": str(ln.get("description") or ""),
            "quantity": qty,
            "unit_price": price,
        }
    src = current_lines[index] if index < len(current_lines) else current_lines[0]
    return {
        "description": str(ln.get("description") or src.get("description") or ""),
        "quantity": float(src.get("quantity") or 0),
        "unit_price": float(src.get("unit_price") or 0),
    }


def _merge_line_updates(
    current_lines: list[dict[str, Any]],
    *,
    lines: list[dict] | None,
    line_updates: list[dict] | None,
) -> list[dict[str, Any]]:
    current = [
        {
            "description": str(ln.get("description") or ""),
            "quantity": float(ln.get("quantity") or 0),
            "unit_price": float(ln.get("unit_price") or 0),
        }
        for ln in current_lines
    ]
    if lines:
        return [_inherit_qty_price(ln, current_lines=current, index=i) for i, ln in enumerate(lines)]
    if not line_updates:
        raise ValueError("Provide lines or line_updates")

    merged = [dict(ln) for ln in current]
    for patch in line_updates:
        match = str(patch.get("match_description") or "").strip()
        if not match:
            continue
        found = False
        for ln in merged:
            if _line_matches(str(ln.get("description") or ""), match):
                if patch.get("description") is not None:
                    ln["description"] = str(patch["description"])
                if patch.get("quantity") is not None:
                    ln["quantity"] = float(patch["quantity"])
                if patch.get("unit_price") is not None:
                    ln["unit_price"] = float(patch["unit_price"])
                found = True
                break
        if not found and len(merged) == 1:
            ln = merged[0]
            if patch.get("description") is not None:
                ln["description"] = str(patch["description"])
            if patch.get("quantity") is not None:
                ln["quantity"] = float(patch["quantity"])
            if patch.get("unit_price") is not None:
                ln["unit_price"] = float(patch["unit_price"])
            found = True
        if not found:
            inherit = current[0] if current else {}
            merged.append(
                {
                    "description": str(
                        patch.get("description") or patch.get("match_description") or ""
                    ),
                    "quantity": float(
                        patch.get("quantity")
                        if patch.get("quantity") is not None
                        else inherit.get("quantity") or 1
                    ),
                    "unit_price": float(
                        patch.get("unit_price")
                        if patch.get("unit_price") is not None
                        else inherit.get("unit_price") or 0
                    ),
                }
            )
    return merged


@register_tool(
    name="update_quotation",
    description=(
        "WHEN: change quotation or invoice LINE ITEMS, totals, or document title. "
        "Use for 'change the description on the quote', quantity, or price edits. "
        "NOT: lead notes or product_interest (update_lead). NEEDS: quotation_id "
        "(id or Q-/INV- number). Prefer line_updates for description edits; omit "
        "quantity/unit_price so existing values are kept. Never ask the user for "
        "an internal id. RETURNS: updated document including version and message."
    ),
    parameters={
        "quotation_id": {
            "type": "string",
            "description": "Quotation/invoice id or document number (e.g. Q-2026-00005)",
        },
        "lines": _quote_line_schema(),
        "line_updates": {
            "type": "array",
            "description": "Patch existing lines by matching description (case-insensitive)",
            "items": {
                "type": "object",
                "properties": {
                    "match_description": {"type": "string"},
                    "description": {"type": "string"},
                    "quantity": {"type": "number"},
                    "unit_price": {"type": "number"},
                },
                "required": ["match_description"],
            },
        },
        "title": {"type": "string"},
        "tax_enabled": {"type": "boolean"},
        "tax_rate": {"type": "number"},
        "version_note": {"type": "string"},
    },
    kind="write",
    modes=("advanced",),
    required=["quotation_id"],
    summary_fn=lambda a: f"Update quotation {a.get('quotation_id')}",
    owner_only=True,
)
async def update_quotation(
    ctx: ToolContext,
    quotation_id: str,
    lines: list[dict] | None = None,
    line_updates: list[dict] | None = None,
    title: str | None = None,
    tax_enabled: bool | None = None,
    tax_rate: float | None = None,
    version_note: str | None = None,
    **_: Any,
) -> dict:
    from fastapi import HTTPException, status

    q = await quote_svc.resolve_quotation(
        organization_id=ctx.organization_id,
        quotation_id=quotation_id,
    )
    current = await quote_svc.get_quotation(
        organization_id=ctx.organization_id,
        quotation_id=q.id,
    )
    try:
        merged_lines = _merge_line_updates(
            current.get("lines") or [],
            lines=lines,
            line_updates=line_updates,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    old_total = sum(
        float(ln.get("quantity") or 0) * float(ln.get("unit_price") or 0)
        for ln in (current.get("lines") or [])
    )
    new_total = sum(
        float(ln.get("quantity") or 0) * float(ln.get("unit_price") or 0)
        for ln in merged_lines
    )
    if old_total > 0 and new_total <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                "Update would zero out the quotation total. Use line_updates with "
                "only description, or include the existing quantity and unit_price."
            ),
        )

    result = await quote_svc.update_quotation_document(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        quotation_id=q.id,
        lead_id=str(current.get("lead_id") or q.leadId),
        lines=merged_lines,
        title=title,
        tax_enabled=tax_enabled,
        tax_rate=tax_rate,
        version_note=version_note,
    )
    result["lines_changed"] = True
    return result


@register_tool(
    name="send_quotation",
    description=(
        "WHEN: send an existing quotation PDF via WhatsApp or email. NEEDS: "
        "quotation_id from list_quotations_for_lead or get_quotation. Never ask "
        "the user for an internal id."
    ),
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
    description=(
        "WHEN: convert a quotation into an invoice (allocates INV number). "
        "NEEDS: quotation_id. Never ask the user for an internal id."
    ),
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
    description=(
        "WHEN: send an invoiced quotation as an invoice via WhatsApp or email. "
        "NEEDS: quotation_id. Never ask the user for an internal id."
    ),
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
        "WHEN: create a quotation, generate the PDF, and send it in one step. "
        "NEEDS: lead_id (id or customer/company name) and lines. Never ask the "
        "user for an internal id."
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
        "WHEN: invoice an existing quotation (or create one from lead+lines) and "
        "send it. NEEDS: quotation_id, or lead_id (id or name) plus lines. Never "
        "ask the user for an internal id."
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
