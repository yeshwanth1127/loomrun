from __future__ import annotations

from pathlib import Path
from typing import Any

from loomrun_api.config import settings
from loomrun_api.pdf.canvas_state import create_canvas
from loomrun_api.pdf.sections.bill_to import render_bill_to
from loomrun_api.pdf.sections.doc_title import render_doc_title
from loomrun_api.pdf.sections.footer import render_footer
from loomrun_api.pdf.sections.header import render_header
from loomrun_api.pdf.sections.line_items import render_line_items
from loomrun_api.pdf.sections.meta import render_meta
from loomrun_api.pdf.sections.payment import render_payment
from loomrun_api.pdf.sections.signature import render_signature
from loomrun_api.pdf.sections.terms import render_terms
from loomrun_api.pdf.sections.totals import render_totals
from loomrun_api.schemas.document_template import TemplateLayout

SECTION_RENDERERS = {
    "header": render_header,
    "doc_title": render_doc_title,
    "meta": render_meta,
    "bill_to": render_bill_to,
    "line_items": render_line_items,
    "totals": render_totals,
    "payment": render_payment,
    "terms": render_terms,
    "signature": render_signature,
    "footer": render_footer,
}


def render_document_pdf(
    *,
    output_path: Path,
    layout: TemplateLayout,
    context: dict[str, Any],
) -> None:
    # Allow sections to coordinate (e.g., combined header layouts).
    ctx = dict(context)
    ctx["_enabled_sections"] = {s.type for s in layout.sections if getattr(s, "enabled", False)}
    state = create_canvas(output_path, layout)
    for section in layout.sections:
        if not section.enabled:
            continue
        renderer = SECTION_RENDERERS.get(section.type)
        if renderer:
            renderer(section, state, ctx)
    state.c.save()


def render_quotation_pdf_to_storage(
    quotation_id: str,
    org_id: str,
    layout: TemplateLayout,
    context: dict[str, Any],
) -> str:
    dest_dir = settings.storage_dir / org_id / "quotations"
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / f"{quotation_id}.pdf"
    render_document_pdf(output_path=path, layout=layout, context=context)
    return f"{org_id}/quotations/{quotation_id}.pdf"


def render_preview_pdf(layout: TemplateLayout, context: dict[str, Any]) -> bytes:
    preview_dir = settings.storage_dir / "_previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    path = preview_dir / "preview.pdf"
    render_document_pdf(output_path=path, layout=layout, context=context)
    return path.read_bytes()
