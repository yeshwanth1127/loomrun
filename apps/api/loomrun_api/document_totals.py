"""Canonical quotation/invoice totals (shared by API, PDF, and tests).

Money uses Decimal with half-up rounding to 2 places — never float for persistence.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

TWOPLACES = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal("100")


def to_decimal(value: Any, *, default: Decimal = ZERO) -> Decimal:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def normalize_tax_rate(
    tax_enabled: bool,
    tax_rate: Any,
) -> Decimal | None:
    """Return validated rate (0–100) when GST is enabled, else None."""
    if not tax_enabled:
        return None
    rate = to_decimal(tax_rate, default=ZERO)
    if rate < ZERO or rate > HUNDRED:
        raise ValueError("GST rate must be between 0 and 100")
    return quantize_money(rate)


def compute_document_totals(
    *,
    lines: list[dict[str, Any]],
    tax_enabled: bool = False,
    tax_rate: Any = None,
) -> dict[str, Any]:
    """Compute subtotal, GST amount, and grand total from line items.

    ``lines`` items need ``quantity`` and ``unit_price`` (or ``unitPrice``).
    Taxable base = sum of line totals (discounts are not modeled on documents yet).
    """
    line_rows: list[dict[str, Any]] = []
    subtotal = ZERO
    for i, ln in enumerate(lines or []):
        qty = to_decimal(ln.get("quantity"), default=ZERO)
        price = to_decimal(
            ln.get("unit_price") if "unit_price" in ln else ln.get("unitPrice"),
            default=ZERO,
        )
        line_total = quantize_money(qty * price)
        subtotal += line_total
        line_rows.append(
            {
                "description": str(ln.get("description") or "").strip(),
                "quantity": qty,
                "unit_price": price,
                "line_total": line_total,
                "sort_order": int(ln.get("sort_order", ln.get("sortOrder", i)) or i),
            }
        )
    subtotal = quantize_money(subtotal)

    rate = normalize_tax_rate(tax_enabled, tax_rate)
    if tax_enabled and rate is not None and rate > ZERO:
        tax = quantize_money(subtotal * rate / HUNDRED)
    else:
        tax = ZERO
        if not tax_enabled:
            rate = None

    total = quantize_money(subtotal + tax)
    return {
        "lines": line_rows,
        "subtotal": subtotal,
        "tax_enabled": bool(tax_enabled),
        "tax_rate": rate,
        "tax": tax,
        "total": total,
    }


def money_float(value: Decimal | None) -> float:
    """Serialize Decimal money for JSON API responses."""
    if value is None:
        return 0.0
    return float(quantize_money(to_decimal(value)))
