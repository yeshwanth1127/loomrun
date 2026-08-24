from __future__ import annotations

from datetime import datetime
from typing import Any


def resolve_merge_fields(text: str, context: dict[str, Any]) -> str:
    if not text:
        return text
    org = context.get("org") or {}
    quotation = context.get("quotation") or {}
    lead = context.get("lead") or {}

    replacements = {
        "{{org.legal_name}}": str(org.get("legal_name") or org.get("name") or ""),
        "{{org.tax_id}}": str(org.get("tax_id") or ""),
        "{{org.phone}}": str(org.get("phone") or ""),
        "{{org.email}}": str(org.get("email") or ""),
        "{{quotation.number}}": str(quotation.get("number") or ""),
        "{{quotation.date}}": str(quotation.get("date") or datetime.now().strftime("%d %b %Y")),
        "{{quotation.total}}": str(quotation.get("total_formatted") or quotation.get("total") or ""),
        "{{quotation.invoice_number}}": str(quotation.get("invoice_number") or ""),
        "{{lead.title}}": str(lead.get("title") or ""),
        "{{lead.company}}": str(lead.get("company") or ""),
        "{{lead.phone}}": str(lead.get("phone") or ""),
        "{{lead.email}}": str(lead.get("email") or ""),
    }
    result = text
    for token, value in replacements.items():
        result = result.replace(token, value)
    return result
