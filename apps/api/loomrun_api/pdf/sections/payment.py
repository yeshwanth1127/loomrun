from __future__ import annotations

from typing import Any

from loomrun_api.pdf.canvas_state import CanvasState, draw_image
from loomrun_api.pdf.merge_fields import resolve_merge_fields
from loomrun_api.schemas.document_template import PaymentSection

_LINE = 11.0


def _draw_line(state: CanvasState, text: str, *, bold: bool = False, size: float = 9) -> None:
    state.draw_text(state.margin, text, bold=bold, size=size)
    state.move(_LINE if size <= 9 else 12)


def render_payment(section: PaymentSection, state: CanvasState, ctx: dict[str, Any]) -> None:
    if not section.enabled:
        return
    org = ctx.get("org") or {}

    bank_lines: list[str] = []
    if org.get("bank_name"):
        bank_lines.append(f"BANK : {org['bank_name']}")
    if org.get("bank_account_number"):
        bank_lines.append(f"Account number : {org['bank_account_number']}")
    if org.get("bank_account_name"):
        bank_lines.append(f"Account Name : {org['bank_account_name']}")
    if org.get("bank_ifsc"):
        bank_lines.append(f"IFSC CODE- {org['bank_ifsc']}")
    if org.get("bank_swift"):
        bank_lines.append(f"Swift Code - {org['bank_swift']}")
    if org.get("bank_ad_code"):
        bank_lines.append(f"AD CODE- {org['bank_ad_code']}")
    if org.get("bank_branch"):
        bank_lines.append(f"Branch : {org['bank_branch']}")

    has_qr = bool(section.show_upi_qr and ctx.get("upi_qr_path"))
    note = resolve_merge_fields(section.payment_note, ctx).strip()
    if not bank_lines and not has_qr and not note:
        return

    qr_size = 90.0
    needed = 20.0
    if note:
        needed += 18.0
    if bank_lines:
        needed += 36.0 + len(bank_lines) * _LINE
    if has_qr:
        needed += 36.0 + qr_size + 16.0
    state.ensure_space(needed)

    if note:
        state.c.setFont(state.font, 9)
        _draw_line(state, note)

    if bank_lines:
        _draw_line(state, "Payment Instructions", bold=True, size=10)
        state.move(4)
        state.c.setFont(state.font, 9)
        _draw_line(state, "Send to bank")
        for line in bank_lines:
            _draw_line(state, line[:120])
        state.move(8)

    if has_qr:
        state.move(6)
        _draw_line(state, "Scan & Pay", bold=True, size=10)
        state.move(4)
        qr_top_y = state.y
        lh = draw_image(state, ctx["upi_qr_path"], state.margin, qr_size, qr_size)
        if lh <= 0:
            lh = qr_size
        state.y = qr_top_y - lh
        state.move(10)
        state.c.setFont(state.font, 9)
        _draw_line(state, "Scan the QR code to make payment")
        state.move(6)
