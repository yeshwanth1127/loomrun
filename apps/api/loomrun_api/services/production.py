"""Production orders shared by HTTP routers and the AI agent.

Reuses the same P&L, activity-logging and Brain-sync helpers the Production
screen uses, so an order the agent moves looks identical to one a person moved.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from loomrun_api import org_events
from loomrun_api.pnl import compute_pnl, serialize_expense
from loomrun_api.prisma_client import prisma
from loomrun_api.production_activity import log_production_activity, stage_label
from loomrun_api.services.leads import resolve_lead
from prisma.enums import (
    PaymentStatus,
    ProductionActivityType,
    ProductionStage,
)

_ORDER_INCLUDE = {
    "lead": True,
    "quotation": True,
    "payments": True,
    "expenses": {"include": {"createdBy": True}},
}

STAGES = [s.name for s in ProductionStage]


def _enum_name(value: Any) -> str:
    return value.name if hasattr(value, "name") else str(value)


def serialize_order(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "lead_id": r.leadId,
        "quotation_id": r.quotationId,
        "name": r.name,
        "stage": _enum_name(r.stage),
        "delay_flag": r.delayFlag,
        "budget_cents": r.budgetCents,
        "stage_entered_at": r.stageEnteredAt.isoformat() if r.stageEnteredAt else None,
        "lead_title": r.lead.title if getattr(r, "lead", None) else None,
        "payments": [
            {
                "id": p.id,
                "amount_cents": p.amountCents,
                "status": _enum_name(p.status),
                "note": p.note,
                "recorded_at": p.recordedAt.isoformat() if p.recordedAt else None,
            }
            for p in (getattr(r, "payments", None) or [])
        ],
        "expenses": [serialize_expense(e) for e in (getattr(r, "expenses", None) or [])],
        "pnl": compute_pnl(order=r),
    }


async def _require_order(*, organization_id: str, order_id: str):
    """Find an order by its id, or by the lead it belongs to."""
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": organization_id},
        include=_ORDER_INCLUDE,
    )
    if row:
        return row
    # Callers naturally reach for the customer, not the order id.
    lead = await resolve_lead(organization_id=organization_id, lead_id=order_id)
    row = await prisma.productionorder.find_first(
        where={"leadId": lead.id, "organizationId": organization_id},
        include=_ORDER_INCLUDE,
    )
    if not row:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=(
                f"'{lead.title}' has no production order yet. "
                "IMPORTANT: if you were asked to move this lead to NEW, CONTACTED, "
                "QUALIFICATION, QUOTATION, NEGOTIATION, SAMPLE, WON or LOST, that "
                "is the SALES pipeline, not the factory — call update_lead with "
                "that stage instead, and it will work without a production order. "
                "Only call create_production_order if the user actually wants "
                "manufacturing started."
            ),
        )
    return row


async def list_production_orders(
    *, organization_id: str, stage: str | None = None, limit: int = 50
) -> dict[str, Any]:
    where: dict[str, Any] = {"organizationId": organization_id}
    if stage:
        key = str(stage).strip().upper()
        if key not in STAGES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown stage '{stage}'. Valid stages: {', '.join(STAGES)}",
            )
        where["stage"] = ProductionStage[key]
    total = await prisma.productionorder.count(where=where)
    rows = await prisma.productionorder.find_many(
        where=where,
        order={"updatedAt": "desc"},
        take=max(1, min(int(limit or 50), 100)),
        include=_ORDER_INCLUDE,
    )
    return {
        "items": [serialize_order(r) for r in rows],
        "count": len(rows),
        "total": total,
        "stages": STAGES,
    }


async def get_production_order(*, organization_id: str, order_id: str) -> dict[str, Any]:
    return serialize_order(
        await _require_order(organization_id=organization_id, order_id=order_id)
    )


async def create_production_order(
    *, organization_id: str, user_id: str, lead_id: str, quotation_id: str | None = None
) -> dict[str, Any]:
    lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
    existing = await prisma.productionorder.find_unique(where={"leadId": lead.id})
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"'{lead.title}' already has a production order (id {existing.id}).",
        )
    if quotation_id:
        q = await prisma.quotation.find_first(
            where={
                "id": quotation_id,
                "organizationId": organization_id,
                "leadId": lead.id,
            }
        )
        if not q:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="That quotation does not belong to this lead.",
            )

    stage = ProductionStage.FABRIC_CHECK
    row = await prisma.productionorder.create(
        data={
            "organizationId": organization_id,
            "leadId": lead.id,
            "quotationId": quotation_id,
            "stage": stage,
            "stageEnteredAt": datetime.now(timezone.utc),
        }
    )
    await log_production_activity(
        organization_id=organization_id,
        production_order_id=row.id,
        lead_id=lead.id,
        user_id=user_id,
        activity_type=ProductionActivityType.ORDER_CREATED,
        body=f"Production order started at {stage_label(stage.name)}",
        metadata={"stage": stage.name, "source": "loomrun_ai"},
    )
    org_events.record_changed(
        organization_id=organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=row.id,
    )
    return await get_production_order(organization_id=organization_id, order_id=row.id)


async def update_production_order(
    *,
    organization_id: str,
    user_id: str,
    order_id: str,
    stage: str | None = None,
    delay_flag: bool | None = None,
    budget_cents: int | None = None,
    name: str | None = None,
) -> dict[str, Any]:
    row = await _require_order(organization_id=organization_id, order_id=order_id)
    old_stage = _enum_name(row.stage)

    data: dict[str, Any] = {}
    new_stage = old_stage
    if stage is not None:
        key = str(stage).strip().upper()
        if key not in STAGES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown stage '{stage}'. Valid stages: {', '.join(STAGES)}",
            )
        new_stage = key
        data["stage"] = ProductionStage[key]
        if key != old_stage:
            data["stageEnteredAt"] = datetime.now(timezone.utc)
    if delay_flag is not None:
        data["delayFlag"] = delay_flag
    if budget_cents is not None:
        if budget_cents < 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="budget_cents cannot be negative"
            )
        data["budgetCents"] = budget_cents
    if name is not None:
        data["name"] = name
    if not data:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Nothing to update — pass stage, delay_flag, budget_cents or name.",
        )

    await prisma.productionorder.update(where={"id": row.id}, data=data)
    org_events.record_changed(
        organization_id=organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=row.id,
    )
    if stage is not None and new_stage != old_stage:
        await log_production_activity(
            organization_id=organization_id,
            production_order_id=row.id,
            lead_id=row.leadId,
            user_id=user_id,
            activity_type=ProductionActivityType.STAGE_CHANGED,
            body=f"Stage changed from {stage_label(old_stage)} to {stage_label(new_stage)}",
            metadata={"from_stage": old_stage, "to_stage": new_stage, "source": "loomrun_ai"},
        )
    return await get_production_order(organization_id=organization_id, order_id=row.id)


async def record_production_payment(
    *,
    organization_id: str,
    user_id: str,
    order_id: str,
    amount_cents: int,
    payment_status: str = "PAID",
    note: str | None = None,
) -> dict[str, Any]:
    if amount_cents <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="amount_cents must be greater than zero"
        )
    row = await _require_order(organization_id=organization_id, order_id=order_id)
    key = str(payment_status or "PAID").strip().upper()
    valid = [s.name for s in PaymentStatus]
    if key not in valid:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown payment status '{payment_status}'. Valid: {', '.join(valid)}",
        )
    await prisma.payment.create(
        data={
            "organizationId": organization_id,
            "productionOrderId": row.id,
            "amountCents": amount_cents,
            "status": PaymentStatus[key],
            "note": note,
            "recordedAt": datetime.now(timezone.utc),
        }
    )
    await log_production_activity(
        organization_id=organization_id,
        production_order_id=row.id,
        lead_id=row.leadId,
        user_id=user_id,
        activity_type=ProductionActivityType.PAYMENT_RECORDED,
        body=f"Payment recorded: {amount_cents / 100:.2f} ({key})",
        metadata={"amount_cents": amount_cents, "status": key, "source": "loomrun_ai"},
    )
    org_events.record_changed(
        organization_id=organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=row.id,
    )
    return await get_production_order(organization_id=organization_id, order_id=row.id)


async def record_production_expense(
    *,
    organization_id: str,
    user_id: str,
    order_id: str,
    category: str,
    amount_cents: int,
    subcategory: str | None = None,
    description: str | None = None,
    vendor: str | None = None,
) -> dict[str, Any]:
    if amount_cents <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="amount_cents must be greater than zero"
        )
    row = await _require_order(organization_id=organization_id, order_id=order_id)
    cat = " ".join(str(category or "").split())
    if not cat:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="category is required")
    sub = " ".join(str(subcategory or "").split()) or None
    await prisma.expense.create(
        data={
            "organizationId": organization_id,
            "productionOrderId": row.id,
            "leadId": row.leadId,
            "category": cat,
            "subcategory": sub,
            "amountCents": amount_cents,
            "description": description,
            "vendor": vendor,
            "incurredAt": datetime.now(timezone.utc),
            "createdById": user_id,
        }
    )
    label = f"{cat} / {sub}" if sub else cat
    await log_production_activity(
        organization_id=organization_id,
        production_order_id=row.id,
        lead_id=row.leadId,
        user_id=user_id,
        activity_type=ProductionActivityType.EXPENSE_RECORDED,
        body=f"Expense added: {label} {amount_cents / 100:.2f}",
        metadata={
            "amount_cents": amount_cents,
            "category": cat,
            "subcategory": sub,
            "source": "loomrun_ai",
        },
    )
    org_events.record_changed(
        organization_id=organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=row.id,
    )
    return await get_production_order(organization_id=organization_id, order_id=row.id)
