from __future__ import annotations

from typing import Any

from loomrun_api.pdf.canvas_state import CanvasState
from loomrun_api.pdf.merge_fields import resolve_merge_fields
from loomrun_api.schemas.document_template import TermsSection


def render_terms(section: TermsSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled or not section.text.strip():
        return
    text = resolve_merge_fields(section.text, ctx)
    state.ensure_space(40)
    state.draw_text(state.margin, "Terms & Conditions", bold=True, size=10)
    state.move(14)
    state.c.setFont(state.font, 8)
    for line in text.split("\n")[:6]:
        state.draw_text(state.margin, line.strip())
        state.move(10)
    state.move(8)
