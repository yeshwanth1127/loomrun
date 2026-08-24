from __future__ import annotations

from typing import Any

from reportlab.lib.colors import HexColor

from loomrun_api.pdf.canvas_state import CanvasState, draw_image, scale_image_dims
from loomrun_api.schemas.document_template import HeaderSection


def render_header(section: HeaderSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled:
        return
    org = ctx["org"]
    start_y = state.y

    if section.layout == "invoice_like":
        enabled_sections = ctx.get("_enabled_sections") or set()
        q = ctx["quotation"]
        lead = ctx["lead"]
        doc_type = ctx.get("doc_type", "Quotation")

        # Top row: doc title (left) + brand name/logo (right)
        if "doc_title" not in enabled_sections:
            title = "INVOICE" if doc_type == "Invoice" else "QUOTATION"
            state.draw_text(state.margin, title, bold=True, size=20)

        left_x = state.margin
        right_margin = state.w - state.margin
        right_col_w = 220.0
        right_x = right_margin - right_col_w

        top_y = state.y

        # Brand name on the right (above logo + meta)
        brand_name = str(org.get("legal_name") or org.get("name") or "")[:60]
        state.c.setFont(state.font_bold, 12)
        state.c.drawRightString(right_margin, top_y + 2.0, brand_name)

        def draw_logo_at(y: float) -> float:
            if not ctx.get("logo_path"):
                return 0.0
            prev_y = state.y
            try:
                state.y = y
                iw, _ = scale_image_dims(ctx["logo_path"], 150, 46)
                x = right_margin - iw
                return float(draw_image(state, ctx["logo_path"], x, 150, 46))
            except Exception:
                return 0.0
            finally:
                state.y = prev_y

        logo_top_y = top_y - 18.0
        logo_h = draw_logo_at(logo_top_y)

        # Move below the tallest element (title height vs brand+logo block).
        right_block_h = 18.0 + float(logo_h)
        state.y = top_y - max(26.0, right_block_h) - 10.0

        # Left: brand address/contact (brand name is on the right per invoice reference)
        state.c.setFont(state.font, 8.5)
        for line in (str(org.get("address") or "").split("\n") if org.get("address") else [])[:3]:
            if line.strip():
                state.c.drawString(left_x, state.y, line.strip()[:90])
                state.move(10)
        if org.get("phone"):
            state.c.drawString(left_x, state.y, f"Mobile: {org['phone']}"[:90])
            state.move(10)
        if org.get("email"):
            state.c.drawString(left_x, state.y, f"Email: {org['email']}"[:90])
            state.move(10)
        if org.get("website"):
            state.c.drawString(left_x, state.y, str(org["website"])[:90])
            state.move(10)
        if section.show_tax_id and org.get("tax_id"):
            state.c.drawString(left_x, state.y, f"GST: {org['tax_id']}"[:90])
            state.move(10)

        # Right: document meta (number/date), below brand name + logo
        if "meta" not in enabled_sections:
            meta_y = logo_top_y - float(logo_h) - 14.0
            state.c.setFont(state.font, 9)
            label_color = ctx.get("theme", {}).get("primary_color", "#111827")
            state.c.setFillColor(HexColor(label_color))

            def draw_meta_row(y: float, label: str, value: str) -> None:
                state.c.drawString(right_x, y, label)
                state.c.drawRightString(right_margin, y, value)

            if doc_type == "Invoice":
                draw_meta_row(meta_y, "Invoice No :", str(q.get("invoice_number") or q.get("number") or ""))
                draw_meta_row(meta_y - 14, "Invoice Date :", str(q.get("date") or ""))
            else:
                draw_meta_row(meta_y, "Quotation :", str(q.get("number") or ""))
                draw_meta_row(meta_y - 14, "Quotation Date :", str(q.get("date") or ""))

        # Bill To block (left), placed below brand block
        if "bill_to" not in enabled_sections:
            # Ensure bill-to starts below the deeper of left-block vs right meta.
            after_right = (logo_top_y - float(logo_h) - 14.0) - 30.0
            state.y = min(state.y - 2.0, after_right)
            state.move(8)
            state.draw_text(left_x, "Bill To", bold=True, size=10)
            state.move(14)
            state.c.setFont(state.font, 9)
            if lead.get("title"):
                state.c.drawString(left_x, state.y, str(lead["title"])[:80])
                state.move(12)
            if lead.get("company"):
                state.c.drawString(left_x, state.y, str(lead["company"])[:80])
                state.move(12)
            if lead.get("city"):
                state.c.drawString(left_x, state.y, str(lead["city"])[:80])
                state.move(12)
            state.move(8)

        # Small spacing before next section (line items).
        state.move(4)
        return

    if section.layout == "logo_center":
        if ctx.get("logo_path"):
            lh = draw_image(state, ctx["logo_path"], state.w / 2 - 60, 120, 40)
            state.move(lh + 8)
        state.draw_text(state.w / 2 - 80, org["legal_name"][:50], bold=True, size=11)
        state.move(14)
    elif section.layout == "company_only":
        state.draw_text(state.margin, org["legal_name"][:50], bold=True, size=11)
        state.move(12)
        state.c.setFont(state.font, 8)
        for detail in _company_details(org, section.show_tax_id)[:3]:
            state.draw_text(state.margin, detail)
            state.move(10)
    else:
        if ctx.get("logo_path"):
            draw_image(state, ctx["logo_path"], state.margin, 120, 40)
        right_x = state.w - state.margin - 150
        state.draw_text(right_x, org["legal_name"][:50], bold=True, size=11)
        state.move(14)
        state.c.setFont(state.font, 8)
        details_y = state.y
        for i, detail in enumerate(_company_details(org, section.show_tax_id)[:4]):
            state.c.drawString(state.w - state.margin - 200, details_y - i * 10, detail[:45])
        state.y = min(state.y, details_y - 40)

    state.move(max(0, start_y - state.y) + 10 if section.layout != "logo_left_company_right" else 20)


def _company_details(org: dict, show_tax_id: bool) -> list[str]:
    details: list[str] = []
    if org.get("address"):
        for line in str(org["address"]).split("\n")[:2]:
            details.append(line.strip())
    if org.get("phone"):
        details.append(f"Phone: {org['phone']}")
    if org.get("email"):
        details.append(f"Email: {org['email']}")
    if show_tax_id and org.get("tax_id"):
        details.append(f"GSTIN: {org['tax_id']}")
    return details
