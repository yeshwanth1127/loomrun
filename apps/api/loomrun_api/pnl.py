"""Job P&L helpers for production orders."""

from __future__ import annotations

from decimal import Decimal

from prisma.enums import PaymentStatus


def _to_cents(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return int((value * 100).quantize(Decimal("1")))
    try:
        return int(round(float(value) * 100))
    except (TypeError, ValueError):
        return None


def compute_pnl(*, order, expenses: list | None = None, payments: list | None = None) -> dict:
    """Compute P&L lines for a production order.

    Expects order to optionally include ``lead`` and ``quotation`` relations.
    """
    expenses = expenses if expenses is not None else (getattr(order, "expenses", None) or [])
    payments = payments if payments is not None else (getattr(order, "payments", None) or [])

    revenue_cents: int | None = None
    revenue_source: str | None = None
    quotation = getattr(order, "quotation", None)
    if quotation is not None and quotation.total is not None:
        revenue_cents = _to_cents(quotation.total)
        revenue_source = "quotation"
    else:
        lead = getattr(order, "lead", None)
        if lead is not None and lead.estimatedValue is not None:
            revenue_cents = _to_cents(lead.estimatedValue)
            revenue_source = "estimated_value"

    budget_cents = order.budgetCents
    actual_cost_cents = sum(e.amountCents for e in expenses)

    collected_cents = 0
    for p in payments:
        status = p.status.name if hasattr(p.status, "name") else str(p.status)
        if status in (PaymentStatus.PAID.name, PaymentStatus.PARTIAL.name, "PAID", "PARTIAL"):
            collected_cents += p.amountCents

    margin_cents = (revenue_cents - actual_cost_cents) if revenue_cents is not None else None
    budget_variance_cents = (budget_cents - actual_cost_cents) if budget_cents is not None else None
    collection_gap_cents = (revenue_cents - collected_cents) if revenue_cents is not None else None
    over_budget = budget_cents is not None and actual_cost_cents > budget_cents

    return {
        "revenue_cents": revenue_cents,
        "revenue_source": revenue_source,
        "budget_cents": budget_cents,
        "actual_cost_cents": actual_cost_cents,
        "collected_cents": collected_cents,
        "margin_cents": margin_cents,
        "budget_variance_cents": budget_variance_cents,
        "collection_gap_cents": collection_gap_cents,
        "over_budget": over_budget,
    }


def serialize_expense(e) -> dict:
    lead = getattr(e, "lead", None)
    if lead is None and getattr(e, "productionOrder", None):
        lead = getattr(e.productionOrder, "lead", None)
    return {
        "id": e.id,
        "organization_id": e.organizationId,
        "production_order_id": e.productionOrderId,
        "lead_id": e.leadId,
        "category": e.category.name if hasattr(e.category, "name") else (e.category or ""),
        "subcategory": getattr(e, "subcategory", None),
        "amount_cents": e.amountCents,
        "description": e.description,
        "vendor": e.vendor,
        "incurred_at": e.incurredAt.isoformat(),
        "created_by_id": e.createdById,
        "created_at": e.createdAt.isoformat(),
        "updated_at": e.updatedAt.isoformat(),
        "lead_title": lead.title if lead else None,
        "created_by_name": e.createdBy.name if getattr(e, "createdBy", None) else None,
    }
