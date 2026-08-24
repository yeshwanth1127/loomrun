from __future__ import annotations

from typing import Any

from loomrun_api.pdf.canvas_state import CanvasState
from loomrun_api.schemas.document_template import BillToSection


def render_bill_to(section: BillToSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled:
        return
    lead = ctx["lead"]
    state.draw_text(state.margin, section.label, bold=True, size=10)
    state.move(14)
    state.c.setFont(state.font, 9)
    state.draw_text(state.margin, lead.get("title", "")[:80])
    state.move(12)
    if section.show_company and lead.get("company"):
        state.draw_text(state.margin, lead["company"][:80])
        state.move(12)
    if section.show_phone and lead.get("phone"):
        state.draw_text(state.margin, f"Phone: {lead['phone']}")
        state.move(12)
    if section.show_email and lead.get("email"):
        state.draw_text(state.margin, f"Email: {lead['email']}")
        state.move(12)
    state.move(8)
