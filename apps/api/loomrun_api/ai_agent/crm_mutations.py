"""Map successful AI write-tool results to UI refresh hints."""

from __future__ import annotations

from typing import Any

from loomrun_api.ai_agent.tools.registry import get_tool


def mutation_from_tool(name: str, outcome: dict[str, Any]) -> dict[str, Any] | None:
    """Build a crm_mutation record from a dispatch outcome, or None."""
    if outcome.get("status") != "ok":
        return None
    spec = get_tool(name)
    if not spec or spec.kind != "write":
        return None
    result = outcome.get("result")
    if not isinstance(result, dict):
        return None
    return _mutation_from_result(name, result)


def mutation_from_result(name: str, result: dict[str, Any]) -> dict[str, Any] | None:
    """Build a crm_mutation from a bare tool result dict."""
    if not isinstance(result, dict):
        return None
    return _mutation_from_result(name, result)


def _mutation_from_result(name: str, result: dict[str, Any]) -> dict[str, Any] | None:
    entity, action, entity_id, label, summary = _describe(name, result)
    if not entity_id:
        return None
    return {
        "entity": entity,
        "action": action,
        "id": entity_id,
        "label": label or entity_id,
        "summary": summary,
        "tool": name,
    }


def _describe(name: str, r: dict[str, Any]) -> tuple[str, str, str, str, str]:
    """Return (entity, action, id, label, summary)."""
    if name in ("create_lead", "update_lead"):
        title = str(r.get("title") or r.get("lead_title") or "Lead")
        action = "created" if name == "create_lead" else "updated"
        return (
            "lead",
            action,
            str(r.get("id") or ""),
            title,
            f"Lead {title} {action}",
        )

    if name == "schedule_follow_up":
        title = str(r.get("lead_title") or "Lead")
        return (
            "call",
            "scheduled",
            str(r.get("lead_id") or r.get("id") or ""),
            title,
            f"Follow-up scheduled for {title}",
        )

    if name == "log_call":
        title = str(r.get("lead_title") or "Lead")
        outcome = str(r.get("outcome") or "logged")
        return (
            "call",
            "logged",
            str(r.get("lead_id") or ""),
            title,
            f"Call logged for {title} · {outcome.replace('_', ' ').lower()}",
        )

    if name in ("create_quotation", "create_and_send_quotation"):
        number = str(r.get("number") or "")
        created = r.get("created") if isinstance(r.get("created"), dict) else r
        if not number and isinstance(created, dict):
            number = str(created.get("number") or "")
        entity_id = str(r.get("id") or (created or {}).get("id") or "")
        sent = r.get("sent") if isinstance(r.get("sent"), dict) else None
        summary = f"Quotation {number} created" if number else "Quotation created"
        if sent:
            summary = f"{summary} and sent"
        return ("quotation", "created", entity_id, number or entity_id, summary)

    if name == "delete_quotation":
        number = str(r.get("number") or r.get("invoice_number") or "")
        entity = "invoice" if r.get("invoice_number") else "quotation"
        label = number or str(r.get("id") or "")
        return (
            entity,
            "deleted",
            str(r.get("id") or ""),
            label,
            f"{label} deleted" if label else "Document deleted",
        )

    if name == "update_quotation":
        number = str(r.get("number") or r.get("invoice_number") or "")
        entity = "invoice" if r.get("invoice_number") else "quotation"
        version = r.get("version")
        msg = str(r.get("message") or "")
        if msg:
            summary = msg
        elif version:
            summary = f"{number or 'Document'} updated · v{version}"
        else:
            summary = f"{number or 'Document'} updated"
        return (
            entity,
            "updated",
            str(r.get("id") or ""),
            number or str(r.get("id") or ""),
            summary,
        )

    if name in ("send_quotation", "send_invoice"):
        number = str(r.get("number") or r.get("invoice_number") or "")
        entity = "invoice" if name == "send_invoice" else "quotation"
        sent = r.get("sent") if isinstance(r.get("sent"), dict) else r
        msg = ""
        if isinstance(sent, dict):
            msg = str(sent.get("message") or "")
        summary = msg or f"{number or entity.title()} sent"
        return (
            entity,
            "sent",
            str(r.get("id") or ""),
            number or str(r.get("id") or ""),
            summary,
        )

    if name in ("generate_invoice", "create_and_send_invoice"):
        inv = str(r.get("invoice_number") or "")
        entity_id = str(r.get("quotation_id") or r.get("id") or "")
        summary = str(r.get("message") or f"Invoice {inv} created" if inv else "Invoice created")
        return ("invoice", "created", entity_id, inv or entity_id, summary)

    if name in (
        "create_production_order",
        "update_production_order",
        "record_production_payment",
        "record_production_expense",
    ):
        order_id = str(r.get("order_id") or r.get("id") or "")
        label = str(r.get("order_number") or r.get("title") or order_id)
        action = "created" if name == "create_production_order" else "updated"
        return ("production", action, order_id, label, f"Production order {label} {action}")

    if name in ("create_expense", "delete_expense"):
        entity_id = str(r.get("id") or r.get("expense_id") or "")
        action = "created" if name == "create_expense" else "deleted"
        return ("expense", action, entity_id, entity_id, f"Expense {action}")

    if name == "send_whatsapp_message":
        return (
            "whatsapp",
            "sent",
            str(r.get("id") or r.get("message_id") or ""),
            "WhatsApp",
            "WhatsApp message sent",
        )

    # Generic fallback for other write tools
    entity_id = str(r.get("id") or "")
    if entity_id:
        return (
            "other",
            "updated",
            entity_id,
            entity_id,
            f"{name.replace('_', ' ')} completed",
        )
    return ("other", "updated", "", "", "")
