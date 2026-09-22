"""WhatsApp messaging tools."""

from __future__ import annotations

from typing import Any

from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool
from loomrun_api.services import whatsapp as wa_svc
from loomrun_api.services.leads import DATE_BOUND_PARAMETERS


def _send_summary(args: dict[str, Any]) -> str:
    who = args.get("phone") or args.get("lead_id") or "?"
    body = (args.get("message") or "").strip()
    preview = body[:60] + ("…" if len(body) > 60 else "")
    return f"WhatsApp to {who}: “{preview}”"


@register_tool(
    name="send_whatsapp_message",
    description=(
        "WHEN: send a WhatsApp text now. NEEDS: message, plus lead_id (id or "
        "name) and/or phone. Never ask the user for an internal id. NOT: listing "
        "what was already sent (list_whatsapp_messages)."
    ),
    parameters={
        "message": {"type": "string", "description": "Message text to send"},
        "lead_id": {
            "type": "string",
            "description": "Lead id, or the lead/company name; uses their stored number",
        },
        "phone": {
            "type": "string",
            "description": "Explicit phone number, e.g. from the lead's details. Overrides the stored number.",
        },
    },
    kind="write",
    modes=("advanced",),
    required=["message"],
    summary_fn=_send_summary,
)
async def send_whatsapp_message(
    ctx: ToolContext,
    message: str,
    lead_id: str | None = None,
    phone: str | None = None,
    **_: Any,
) -> dict:
    return await wa_svc.send_whatsapp_message(
        organization_id=ctx.organization_id,
        message=message,
        lead_id=lead_id,
        phone=phone,
    )


@register_tool(
    name="list_whatsapp_messages",
    description=(
        "WHEN: what this org sent on WhatsApp, optionally for one lead or a date "
        "window. NOT: searching leads. NEEDS: nothing required; optional lead_id "
        "(id or name). RETURNS: short cards (id, lead, status, created_at) "
        "without message bodies. Never ask the user for an internal id."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Optional lead id or name to filter by"},
        "limit": {"type": "integer", "description": "Max rows (1-100)", "default": 30},
        **DATE_BOUND_PARAMETERS,
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_whatsapp_messages(
    ctx: ToolContext,
    lead_id: str | None = None,
    limit: int = 30,
    created_after: str | None = None,
    created_before: str | None = None,
    updated_after: str | None = None,
    updated_before: str | None = None,
    timezone: str | None = None,
    **_: Any,
) -> dict:
    return await wa_svc.list_whatsapp_messages(
        organization_id=ctx.organization_id,
        lead_id=lead_id,
        limit=limit,
        created_after=created_after,
        created_before=created_before,
        updated_after=updated_after,
        updated_before=updated_before,
        timezone=timezone or ctx.timezone,
    )


@register_tool(
    name="get_whatsapp_status",
    description=(
        "WHEN: check whether WhatsApp is connected, or why sends are failing. "
        "NOT: listing messages. RETURNS: connection/transport status."
    ),
    parameters={},
    kind="read",
    modes=("minimal", "advanced"),
)
async def get_whatsapp_status(ctx: ToolContext, **_: Any) -> dict:
    return await wa_svc.get_whatsapp_status(organization_id=ctx.organization_id)
