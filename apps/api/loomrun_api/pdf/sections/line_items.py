from __future__ import annotations

from typing import Any

from reportlab.lib.colors import HexColor, white

from loomrun_api.pdf.canvas_state import CanvasState
from loomrun_api.schemas.document_template import LineItemsSection

def render_line_items(section: LineItemsSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled:
        return
    raw_cols = [str(c) for c in (section.columns or [])]
    columns = [c for c in raw_cols if c in {"sl", "description", "qty", "unit_price", "line_total", "sku", "hsn"}]
    if not columns:
        columns = ["description", "qty", "unit_price", "line_total"]

    style = getattr(section, "style", "plain") or "plain"

    # Build dynamic column layout across the available content width.
    cw = float(state.content_width)
    min_sl = 26.0
    min_qty = 48.0
    min_rate = 78.0
    min_amount = 88.0

    def col_width(col: str) -> float:
        if col == "sl":
            return min_sl
        if col == "qty":
            return min_qty
        if col == "unit_price":
            return min_rate
        if col == "line_total":
            return min_amount
        if col == "sku":
            return 70.0
        if col == "hsn":
            return 55.0
        return 0.0

    fixed = sum(col_width(c) for c in columns if c != "description")
    desc_w = max(180.0, cw - fixed - 8.0)

    widths: dict[str, float] = {}
    x_offsets: dict[str, float] = {}
    x = 0.0
    for col in columns:
        w = desc_w if col == "description" else col_width(col)
        widths[col] = w
        x_offsets[col] = x
        x += w

    def label_for(col: str) -> str:
        if col == "sl":
            return "Sl."
        if col == "description":
            return "Description"
        if col == "qty":
            return "Qty"
        if col == "unit_price":
            return "Rate"
        if col == "line_total":
            return "Amount"
        if col == "sku":
            return "SKU"
        if col == "hsn":
            return "HSN"
        return col

    # Header row
    header_h = 16.0
    if style == "invoice_table":
        accent = str(ctx.get("theme", {}).get("accent_color") or "#2563eb")
        state.c.setFillColor(HexColor(accent))
        state.c.rect(state.margin, state.y - 4.0, cw, header_h, stroke=0, fill=1)
        state.c.setFillColor(white)
        state.c.setFont(state.font_bold, 9)
        baseline_y = state.y + 1.0
        for col in columns:
            state.c.drawString(state.margin + x_offsets[col] + 6.0, baseline_y, label_for(col))
        state.c.setFillColor(HexColor(ctx.get("theme", {}).get("primary_color") or "#111827"))
        state.move(header_h + 8.0)
    else:
        state.c.setFont(state.font_bold, 9)
        for col in columns:
            state.c.drawString(state.margin + x_offsets[col], state.y, label_for(col))
        state.move(12)
        state.hline()
        state.move(14)

    # Body rows
    row_h = 14.0
    state.c.setFont(state.font, 8.8)
    lines = ctx.get("lines", []) or []
    for idx, line in enumerate(lines, start=1):
        state.ensure_space(row_h + 10.0)
        for col in columns:
            value = _format_cell(col, line, state.currency, idx)
            x0 = state.margin + x_offsets[col]
            w = widths[col]
            if col in {"qty", "unit_price", "line_total"}:
                state.c.drawRightString(x0 + w - 6.0, state.y, value)
            elif col == "sl":
                state.c.drawCentredString(x0 + w / 2.0, state.y, value)
            else:
                state.c.drawString(x0 + 6.0 if style == "invoice_table" else x0, state.y, value[: int(w / 4)])
        state.move(row_h)


def _format_cell(col: str, line: dict, currency: str, idx: int) -> str:
    if col == "sl":
        return str(idx)
    if col == "description":
        return str(line.get("description", ""))[:60]
    if col == "qty":
        return f"{float(line.get('quantity', 0)):.0f}"
    if col == "unit_price":
        return f"{currency}{float(line.get('unit_price', 0)):,.2f}"
    if col == "line_total":
        return f"{currency}{float(line.get('line_total', 0)):,.2f}"
    if col == "sku":
        return str(line.get("sku") or "")[:14]
    if col == "hsn":
        return str(line.get("hsn") or "")[:10]
    return ""
