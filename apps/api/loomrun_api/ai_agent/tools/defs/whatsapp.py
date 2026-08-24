"""WhatsApp messaging tools."""

from __future__ import annotations

from typing import Any

from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool
from loomrun_api.services import whatsapp as wa_svc


def _send_summary(args: dict[str, Any]) -> str:
    who = args.get("phone") or args.get("lead_id") or "?"
    body = (args.get("message") or "").strip()
    preview = body[:60] + ("…" if len(body) > 60 else "")
    return f"WhatsApp to {who}: “{preview}”"


@register_tool(
    name="send_whatsapp_message",
    description=(
        "Send a WhatsApp text message. Address it either with `lead_id` — a lead "
        "id OR the lead/company name, which uses the number on their record — or "
        "with `phone` for an explicit number. Pass both to send to a specific "
        "number while still filing the message against that lead. This sends "
        "immediately over the org's WhatsApp connection. Use list_whatsapp_messages "
        "to see what has already gone out, and get_whatsapp_status to check the "
        "connection first if a send has been failing."
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
        "List WhatsApp messages this organization has sent, newest first. "
        "Optionally narrow to one lead with `lead_id` (id or name). Use for "
        "'what did we send X', 'did the reminder go out', or delivery checks — "
        "each row carries its delivery status."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Optional lead id or name to filter by"},
        "limit": {"type": "integer", "description": "Max rows (1-100)", "default": 30},
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_whatsapp_messages(
    ctx: ToolContext, lead_id: str | None = None, limit: int = 30, **_: Any
) -> dict:
    return await wa_svc.list_whatsapp_messages(
        organization_id=ctx.organization_id, lead_id=lead_id, limit=limit
    )


@register_tool(
    name="get_whatsapp_status",
    description=(
        "Check whether this organization's WhatsApp is connected and which "
        "transport sends will use. Call this when a send failed or the user asks "
        "why messages are not going out."
    ),
    parameters={},
    kind="read",
    modes=("minimal", "advanced"),
)
async def get_whatsapp_status(ctx: ToolContext, **_: Any) -> dict:
    return await wa_svc.get_whatsapp_status(organization_id=ctx.organization_id)
