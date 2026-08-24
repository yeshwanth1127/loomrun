from __future__ import annotations

from typing import Any

from loomrun_api.pdf.canvas_state import CanvasState, draw_image
from loomrun_api.schemas.document_template import SignatureSection


def render_signature(section: SignatureSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled:
        return
    state.ensure_space(90)
    state.move(20)
    if ctx.get("signature_path"):
        lh = draw_image(state, ctx["signature_path"], state.margin, 80, 40)
        state.move(lh + 8)
    state.c.setFont(state.font, 8)
    state.draw_text(state.margin, section.label)
    state.move(20)
