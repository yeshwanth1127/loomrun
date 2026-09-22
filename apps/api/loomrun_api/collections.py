"""Order collections helpers: actual vs expected payments, status, timeline.

Expected/promised amounts never count toward collected revenue.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from prisma.enums import PaymentStatus

PAYMENT_METHODS = ("CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER")

# Order-level collection status (independent of production stage).
COLLECTION_UNPAID = "UNPAID"
COLLECTION_PARTIALLY_PAID = "PARTIALLY_PAID"
COLLECTION_PAID = "PAID"
COLLECTION_OVERDUE = "OVERDUE"

_ACTIVE_EXPECTED = frozenset({"OPEN", "PARTIALLY_FULFILLED"})
_COLLECTED_STATUSES = frozenset(
    {PaymentStatus.PAID.name, PaymentStatus.PARTIAL.name, "PAID", "PARTIAL"}
)


def _enum_name(value: Any) -> str:
    return value.name if hasattr(value, "name") else str(value)


def _iso(dt: Any) -> str | None:
    if dt is None:
        return None
    return dt.isoformat() if hasattr(dt, "isoformat") else str(dt)


def _as_date(dt: Any) -> date | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        aware = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).date()
    if isinstance(dt, date):
        return dt
    try:
        parsed = datetime.fromisoformat(str(dt).replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).date()
    except (TypeError, ValueError):
        return None


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def normalize_payment_method(value: str | None) -> str | None:
    if value is None:
        return None
    key = str(value).strip().upper().replace(" ", "_").replace("-", "_")
    if not key:
        return None
    if key not in PAYMENT_METHODS:
        raise ValueError(
            f"Unknown payment method '{value}'. Valid: {', '.join(PAYMENT_METHODS)}"
        )
    return key


def collected_cents(payments: list | None) -> int:
    total = 0
    for p in payments or []:
        status = _enum_name(getattr(p, "status", None))
        if status in _COLLECTED_STATUSES:
            total += int(getattr(p, "amountCents", 0) or 0)
    return total


def serialize_payment(p) -> dict[str, Any]:
    return {
        "id": p.id,
        "amount_cents": p.amountCents,
        "status": _enum_name(p.status),
        "method": getattr(p, "method", None),
        "reference": getattr(p, "reference", None),
        "label": getattr(p, "label", None),
        "note": p.note,
        "recorded_at": _iso(p.recordedAt),
        "expected_payment_id": getattr(p, "expectedPaymentId", None),
    }


def serialize_expected_payment(ep, *, today: date | None = None) -> dict[str, Any]:
    today = today or _today_utc()
    status = _enum_name(ep.status)
    expected_at = getattr(ep, "expectedAt", None)
    expected_date = _as_date(expected_at)
    remaining = int(getattr(ep, "remainingCents", 0) or 0)
    is_active = status in _ACTIVE_EXPECTED and remaining > 0
    overdue = bool(is_active and expected_date is not None and expected_date < today)
    days_overdue = (today - expected_date).days if overdue and expected_date else None
    return {
        "id": ep.id,
        "amount_cents": ep.amountCents,
        "remaining_cents": remaining,
        "expected_at": _iso(expected_at),
        "label": getattr(ep, "label", None),
        "note": getattr(ep, "note", None),
        "status": status,
        "is_overdue": overdue,
        "days_overdue": days_overdue,
        "is_unscheduled": expected_at is None and is_active,
        "created_at": _iso(getattr(ep, "createdAt", None)),
        "updated_at": _iso(getattr(ep, "updatedAt", None)),
        "cancelled_at": _iso(getattr(ep, "cancelledAt", None)),
    }


def compute_collections(
    *,
    revenue_cents: int | None,
    payments: list | None = None,
    expected_payments: list | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Derive order collection summary from actual + expected payment rows."""
    today = today or _today_utc()
    collected = collected_cents(payments)

    if revenue_cents is None:
        balance_due = None
        overpaid = 0
        collection_pct = None
        gap = None
    else:
        raw_gap = revenue_cents - collected
        balance_due = max(raw_gap, 0)
        overpaid = max(-raw_gap, 0)
        gap = raw_gap  # may be negative (legacy field; prefer balance_due / overpaid)
        collection_pct = (
            round((collected / revenue_cents) * 100, 1) if revenue_cents > 0 else None
        )

    active_expected: list[dict[str, Any]] = []
    overdue_count = 0
    overdue_cents = 0
    next_expected: dict[str, Any] | None = None

    for ep in expected_payments or []:
        row = serialize_expected_payment(ep, today=today)
        if row["status"] not in _ACTIVE_EXPECTED or row["remaining_cents"] <= 0:
            continue
        active_expected.append(row)
        if row["is_overdue"]:
            overdue_count += 1
            overdue_cents += row["remaining_cents"]

    # Next expected: soonest dated active promise, else any unscheduled
    dated = [
        r
        for r in active_expected
        if r["expected_at"] is not None and not r["is_overdue"]
    ]
    dated.sort(key=lambda r: r["expected_at"] or "")
    overdue_rows = [r for r in active_expected if r["is_overdue"]]
    overdue_rows.sort(key=lambda r: r["expected_at"] or "")
    unscheduled = [r for r in active_expected if r["expected_at"] is None]

    if overdue_rows:
        next_expected = overdue_rows[0]
    elif dated:
        next_expected = dated[0]
    elif unscheduled:
        next_expected = unscheduled[0]

    # Payment status
    if revenue_cents is None:
        # Without an order value, treat purely from collected money.
        if collected <= 0:
            payment_status = COLLECTION_UNPAID
        else:
            payment_status = COLLECTION_PAID
    elif balance_due == 0:
        payment_status = COLLECTION_PAID
    elif overdue_count > 0:
        payment_status = COLLECTION_OVERDUE
    elif collected <= 0:
        payment_status = COLLECTION_UNPAID
    else:
        payment_status = COLLECTION_PARTIALLY_PAID

    return {
        "collected_cents": collected,
        "balance_due_cents": balance_due,
        "overpaid_cents": overpaid,
        "collection_gap_cents": gap,
        "collection_percentage": collection_pct,
        "payment_status": payment_status,
        "next_expected_payment": next_expected,
        "overdue_expected_count": overdue_count,
        "overdue_expected_cents": overdue_cents,
        "active_expected_count": len(active_expected),
    }


def build_payment_timeline(
    *,
    order,
    payments: list | None = None,
    expected_payments: list | None = None,
    activities: list | None = None,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Chronological view over payments, expected promises, and key order events."""
    today = today or _today_utc()
    events: list[dict[str, Any]] = []

    created_at = getattr(order, "createdAt", None)
    if created_at is not None:
        events.append(
            {
                "id": f"order-created-{order.id}",
                "kind": "ORDER_EVENT",
                "marker": "filled",
                "at": _iso(created_at),
                "title": "Order confirmed",
                "subtitle": None,
                "amount_cents": None,
                "meta": {},
            }
        )

    for p in payments or []:
        status = _enum_name(p.status)
        is_actual = status in _COLLECTED_STATUSES
        label = getattr(p, "label", None) or ("Payment received" if is_actual else "Payment noted")
        events.append(
            {
                "id": f"payment-{p.id}",
                "kind": "ACTUAL_PAYMENT" if is_actual else "PAYMENT_NOTE",
                "marker": "filled" if is_actual else "open",
                "at": _iso(p.recordedAt),
                "title": label,
                "subtitle": p.note,
                "amount_cents": p.amountCents if is_actual else None,
                "meta": {
                    "payment_id": p.id,
                    "status": status,
                    "method": getattr(p, "method", None),
                    "reference": getattr(p, "reference", None),
                    "expected_payment_id": getattr(p, "expectedPaymentId", None),
                },
            }
        )

    for ep in expected_payments or []:
        row = serialize_expected_payment(ep, today=today)
        if row["status"] == "CANCELLED":
            continue
        if row["status"] == "FULFILLED":
            # Fulfilled promises are represented by the linked actual payment(s).
            continue
        kind = "OVERDUE_PAYMENT" if row["is_overdue"] else "EXPECTED_PAYMENT"
        marker = "overdue" if row["is_overdue"] else "open"
        title = row["label"] or "Expected payment"
        at = row["expected_at"]
        events.append(
            {
                "id": f"expected-{ep.id}",
                "kind": kind,
                "marker": marker,
                "at": at,
                "title": title,
                "subtitle": row["note"],
                "amount_cents": row["remaining_cents"],
                "meta": {
                    "expected_payment_id": ep.id,
                    "status": row["status"],
                    "is_unscheduled": row["is_unscheduled"],
                    "is_overdue": row["is_overdue"],
                    "days_overdue": row["days_overdue"],
                    "original_amount_cents": row["amount_cents"],
                },
            }
        )

    for act in activities or []:
        atype = _enum_name(getattr(act, "type", None))
        if atype != "STAGE_CHANGED":
            continue
        meta = getattr(act, "metadata", None) or {}
        to_stage = meta.get("to_stage") if isinstance(meta, dict) else None
        if to_stage not in ("DELIVERED", "SHIPPED"):
            continue
        events.append(
            {
                "id": f"activity-{act.id}",
                "kind": "ORDER_EVENT",
                "marker": "filled",
                "at": _iso(act.createdAt),
                "title": "Order delivered" if to_stage == "DELIVERED" else "Order shipped",
                "subtitle": getattr(act, "body", None),
                "amount_cents": None,
                "meta": {"activity_id": act.id, "to_stage": to_stage},
            }
        )

    def sort_key(ev: dict[str, Any]):
        at = ev.get("at")
        # Unscheduled expected payments sort last
        if at is None:
            return ("9", "", ev["id"])
        return ("0", at, ev["id"])

    events.sort(key=sort_key)
    return events
