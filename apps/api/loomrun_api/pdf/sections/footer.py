from __future__ import annotations

from typing import Any

from loomrun_api.pdf.canvas_state import CanvasState
from loomrun_api.pdf.merge_fields import resolve_merge_fields
from loomrun_api.schemas.document_template import FooterSection


def render_footer(section: FooterSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled:
        return
    state.ensure_space(30)
    text = resolve_merge_fields(section.text, ctx)
    if text:
        state.c.setFont(state.font, 8)
        state.draw_text(state.margin, text)
    if section.show_page_number:
        state.c.drawString(state.w - state.margin - 60, state.margin / 2, "Page 1")
