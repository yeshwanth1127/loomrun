from __future__ import annotations

from typing import Any

from loomrun_api.pdf.canvas_state import CanvasState
from loomrun_api.schemas.document_template import TotalsSection


def render_totals(section: TotalsSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled:
        return
    q = ctx["quotation"]
    currency = ctx.get("currency", state.currency)
    label_x = state.margin + 350
    value_x = state.margin + 430

    state.move(10)
    state.hline(label_x, state.w - state.margin)
    state.move(16)
    state.c.setFont(state.font, 9)

    if section.show_subtotal:
        state.c.drawString(label_x, state.y, "Subtotal:")
        state.c.drawString(value_x, state.y, f"{currency}{float(q['subtotal']):,.2f}")
        state.move(14)

    if section.show_tax:
        state.c.drawString(label_x, state.y, f"{section.tax_label}:")
        state.c.drawString(value_x, state.y, f"{currency}{float(q['tax']):,.2f}")
        state.move(14)

    if section.show_discount:
        state.c.drawString(label_x, state.y, "Discount:")
        state.c.drawString(value_x, state.y, f"{currency}0.00")
        state.move(14)

    state.c.setFont(state.font_bold, 10)
    state.c.drawString(label_x, state.y, "Total:")
    state.c.drawString(value_x, state.y, f"{currency}{float(q['total']):,.2f}")
    state.move(20)
