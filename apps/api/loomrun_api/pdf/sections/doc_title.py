from __future__ import annotations

from typing import Any

from loomrun_api.pdf.canvas_state import CanvasState
from loomrun_api.schemas.document_template import DocTitleSection


def render_doc_title(section: DocTitleSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled:
        return
    doc_type = ctx.get("doc_type", "Quotation")
    if section.custom_title:
        title = section.custom_title
    else:
        title = "INVOICE" if doc_type == "Invoice" else "QUOTATION"
    state.draw_text(state.margin, title, bold=True, size=20)
    state.move(30)
