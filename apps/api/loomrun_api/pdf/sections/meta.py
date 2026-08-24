from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from loomrun_api.pdf.canvas_state import CanvasState
from loomrun_api.schemas.document_template import MetaSection


def render_meta(section: MetaSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled:
        return
    q = ctx["quotation"]
    doc_type = ctx.get("doc_type", "Quotation")
    state.c.setFont(state.font, 9)
    for field in section.fields:
        if field == "number":
            state.draw_text(state.margin, f"{doc_type} #: {q['number']}")
            state.move(12)
        elif field == "invoice_number" and q.get("invoice_number"):
            state.draw_text(state.margin, f"Invoice #: {q['invoice_number']}")
            state.move(12)
        elif field == "date":
            state.draw_text(state.margin, f"Date: {q['date']}")
            state.move(12)
        elif field == "valid_until":
            valid = (datetime.now() + timedelta(days=15)).strftime("%d %b %Y")
            state.draw_text(state.margin, f"Valid Until: {valid}")
            state.move(12)
