"""Production orders shared by HTTP routers and the AI agent.

Reuses the same P&L, activity-logging and Brain-sync helpers the Production
screen uses, so an order the agent moves looks identical to one a person moved.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from loomrun_api import org_events
from loomrun_api.pnl import compute_pnl, serialize_expense
from loomrun_api.prisma_client import prisma
from loomrun_api.production_activity import log_production_activity, stage_label
from loomrun_api.services.leads import resolve_lead
from prisma.enums import (
    OrderStatus,
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
ORDER_STATUSES = [s.name for s in OrderStatus]
_TERMINAL_STAGES = {"SHIPPED", "DELIVERED"}
_LOCKED_STATUSES = {"ON_HOLD", "CANCELLED", "COMPLETED"}

# Customer-facing milestones (collapsed from internal stages)
CUSTOMER_MILESTONES: list[tuple[str, str]] = [
    ("CONFIRMED", "Order Confirmed"),
    ("MATERIALS", "Materials"),
    ("PRODUCTION", "Production"),
    ("QC", "Quality Check"),
    ("PACKING", "Packing"),
    ("SHIPPED", "Shipped"),
    ("DELIVERED", "Delivered"),
]

_STAGE_TO_MILESTONE: dict[str, str] = {
    "PENDING": "CONFIRMED",
    "FABRIC_CHECK": "CONFIRMED",
    "PROCUREMENT": "MATERIALS",
    "FABRIC_RECEIVED": "MATERIALS",
    "CUTTING": "PRODUCTION",
    "PRINTING": "PRODUCTION",
    "STITCHING": "PRODUCTION",
    "QC": "QC",
    "PACKING": "PACKING",
    "PAYMENT_HOLD": "PACKING",
    "READY_DISPATCH": "PACKING",
    "SHIPPED": "SHIPPED",
    "DELIVERED": "DELIVERED",
}


def new_tracking_token() -> str:
    return secrets.token_urlsafe(16)


def customer_milestone_for_stage(stage: str) -> str:
    return _STAGE_TO_MILESTONE.get(str(stage).strip().upper(), "CONFIRMED")


def _parse_sequence(value: str, prefix: str) -> int | None:
    if not value.startswith(prefix):
        return None
    try:
        return int(value[len(prefix) :])
    except ValueError:
        return None


async def next_order_number(org_id: str) -> str:
    year = datetime.now(timezone.utc).year
    return await _next_order_number_for_prefix(org_id, f"ORD-{year}-")


async def _next_order_number_for_prefix(org_id: str, prefix: str) -> str:
    rows = await prisma.productionorder.find_many(
        where={"organizationId": org_id, "orderNumber": {"startswith": prefix}},
    )
    max_seq = 0
    for row in rows:
        seq = _parse_sequence(row.orderNumber, prefix)
        if seq is not None:
            max_seq = max(max_seq, seq)
    return f"{prefix}{(max_seq + 1):05d}"


def _enum_name(value: Any) -> str:
    return value.name if hasattr(value, "name") else str(value)


def _iso(dt: Any) -> str | None:
    if dt is None:
        return None
    return dt.isoformat() if hasattr(dt, "isoformat") else str(dt)


def resolve_order_status(r) -> str:
    """Effective health status — auto-flags overdue dispatches as DELAYED."""
    stored = _enum_name(getattr(r, "orderStatus", None) or OrderStatus.ON_TRACK)
    if stored in _LOCKED_STATUSES:
        return stored
    stage = _enum_name(r.stage)
    if stage == "DELIVERED":
        return "COMPLETED"
    eta = getattr(r, "expectedDispatchAt", None)
    if eta is not None and stage not in _TERMINAL_STAGES:
        now = datetime.now(timezone.utc)
        eta_aware = eta if eta.tzinfo else eta.replace(tzinfo=timezone.utc)
        if eta_aware < now:
            return "DELAYED"
    if getattr(r, "delayFlag", False) and stored == "ON_TRACK":
        return "DELAYED"
    return stored


def days_until(dt: Any) -> int | None:
    if dt is None:
        return None
    now = datetime.now(timezone.utc)
    aware = dt if getattr(dt, "tzinfo", None) else dt.replace(tzinfo=timezone.utc)
    return (aware.date() - now.date()).days


def serialize_order(r) -> dict[str, Any]:
    status = resolve_order_status(r)
    return {
        "id": r.id,
        "lead_id": r.leadId,
        "quotation_id": r.quotationId,
        "order_number": r.orderNumber,
        "name": r.name,
        "display_name": r.name or (r.lead.title if getattr(r, "lead", None) else None),
        "stage": _enum_name(r.stage),
        "order_status": status,
        "delay_flag": r.delayFlag or status == "DELAYED",
        "budget_cents": r.budgetCents,
        "expected_completion_at": _iso(getattr(r, "expectedCompletionAt", None)),
        "expected_dispatch_at": _iso(getattr(r, "expectedDispatchAt", None)),
        "actual_dispatch_at": _iso(getattr(r, "actualDispatchAt", None)),
        "courier_name": getattr(r, "courierName", None),
        "courier_tracking_no": getattr(r, "courierTrackingNo", None),
        "shipping_notes": getattr(r, "shippingNotes", None),
        "on_hold_reason": getattr(r, "onHoldReason", None),
        "cancelled_at": _iso(getattr(r, "cancelledAt", None)),
        "tracking_token": getattr(r, "trackingToken", None),
        "tracking_enabled": bool(getattr(r, "trackingEnabled", True)),
        "days_until_dispatch": days_until(getattr(r, "expectedDispatchAt", None)),
        "customer_milestone": customer_milestone_for_stage(_enum_name(r.stage)),
        "stage_entered_at": _iso(r.stageEnteredAt),
        "lead_title": r.lead.title if getattr(r, "lead", None) else None,
        "lead_phone": r.lead.phone if getattr(r, "lead", None) else None,
        "payments": [
            {
                "id": p.id,
                "amount_cents": p.amountCents,
                "status": _enum_name(p.status),
                "note": p.note,
                "recorded_at": _iso(p.recordedAt),
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
    *,
    organization_id: str,
    stage: str | None = None,
    lead_id: str | None = None,
    limit: int = 50,
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
    if lead_id:
        where["leadId"] = lead_id
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
    *,
    organization_id: str,
    user_id: str,
    lead_id: str,
    quotation_id: str | None = None,
    expected_completion_at: datetime | None = None,
    expected_dispatch_at: datetime | None = None,
) -> dict[str, Any]:
    lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
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

    order_number = await next_order_number(organization_id)
    stage = ProductionStage.FABRIC_CHECK
    row = await prisma.productionorder.create(
        data={
            "organizationId": organization_id,
            "leadId": lead.id,
            "quotationId": quotation_id,
            "orderNumber": order_number,
            "stage": stage,
            "orderStatus": OrderStatus.ON_TRACK,
            "expectedCompletionAt": expected_completion_at,
            "expectedDispatchAt": expected_dispatch_at,
            "trackingToken": new_tracking_token(),
            "trackingEnabled": True,
            "stageEnteredAt": datetime.now(timezone.utc),
        }
    )
    await log_production_activity(
        organization_id=organization_id,
        production_order_id=row.id,
        lead_id=lead.id,
        user_id=user_id,
        activity_type=ProductionActivityType.ORDER_CREATED,
        body=f"Order {order_number} created at {stage_label(stage.name)}",
        metadata={
            "stage": stage.name,
            "quotation_id": quotation_id,
            "order_number": order_number,
            "expected_completion_at": _iso(expected_completion_at),
            "expected_dispatch_at": _iso(expected_dispatch_at),
        },
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
    order_status: str | None = None,
    expected_completion_at: datetime | None = None,
    expected_dispatch_at: datetime | None = None,
    actual_dispatch_at: datetime | None = None,
    courier_name: str | None = None,
    courier_tracking_no: str | None = None,
    shipping_notes: str | None = None,
    on_hold_reason: str | None = None,
    internal_note: str | None = None,
    customer_note: str | None = None,
    clear_expected_completion: bool = False,
    clear_expected_dispatch: bool = False,
) -> dict[str, Any]:
    row = await _require_order(organization_id=organization_id, order_id=order_id)
    old_stage = _enum_name(row.stage)
    old_status = _enum_name(getattr(row, "orderStatus", None) or OrderStatus.ON_TRACK)

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
        if key == "DELIVERED":
            data["orderStatus"] = OrderStatus.COMPLETED
        if key == "SHIPPED" and not row.actualDispatchAt and actual_dispatch_at is None:
            data["actualDispatchAt"] = datetime.now(timezone.utc)

    if delay_flag is not None:
        data["delayFlag"] = delay_flag
        if delay_flag and "orderStatus" not in data:
            data["orderStatus"] = OrderStatus.DELAYED
        elif not delay_flag and old_status == "DELAYED" and "orderStatus" not in data:
            data["orderStatus"] = OrderStatus.ON_TRACK

    if order_status is not None:
        key = str(order_status).strip().upper()
        if key not in ORDER_STATUSES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown order_status '{order_status}'. Valid: {', '.join(ORDER_STATUSES)}",
            )
        data["orderStatus"] = OrderStatus[key]
        data["delayFlag"] = key == "DELAYED"
        if key == "CANCELLED":
            data["cancelledAt"] = datetime.now(timezone.utc)
        elif key != "CANCELLED" and row.cancelledAt:
            data["cancelledAt"] = None
        if key != "ON_HOLD":
            data["onHoldReason"] = None

    if budget_cents is not None:
        if budget_cents < 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="budget_cents cannot be negative"
            )
        data["budgetCents"] = budget_cents
    if name is not None:
        data["name"] = name
    if expected_completion_at is not None:
        data["expectedCompletionAt"] = expected_completion_at
    elif clear_expected_completion:
        data["expectedCompletionAt"] = None
    if expected_dispatch_at is not None:
        data["expectedDispatchAt"] = expected_dispatch_at
    elif clear_expected_dispatch:
        data["expectedDispatchAt"] = None
    if actual_dispatch_at is not None:
        data["actualDispatchAt"] = actual_dispatch_at
    if courier_name is not None:
        data["courierName"] = courier_name.strip() or None
    if courier_tracking_no is not None:
        data["courierTrackingNo"] = courier_tracking_no.strip() or None
    if shipping_notes is not None:
        data["shippingNotes"] = shipping_notes.strip() or None
    if on_hold_reason is not None:
        data["onHoldReason"] = on_hold_reason.strip() or None

    notes_only = bool(internal_note or customer_note)
    if not data and not notes_only:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Nothing to update.",
        )

    if data:
        await prisma.productionorder.update(where={"id": row.id}, data=data)
        org_events.record_changed(
            organization_id=organization_id,
            entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
            entity_id=row.id,
        )

    note_meta = {
        "internal_note": (internal_note or "").strip() or None,
        "customer_note": (customer_note or "").strip() or None,
    }

    if stage is not None and new_stage != old_stage:
        body = f"Stage changed from {stage_label(old_stage)} to {stage_label(new_stage)}"
        if note_meta["customer_note"]:
            body = f"{body}: {note_meta['customer_note']}"
        await log_production_activity(
            organization_id=organization_id,
            production_order_id=row.id,
            lead_id=row.leadId,
            user_id=user_id,
            activity_type=ProductionActivityType.STAGE_CHANGED,
            body=body,
            metadata={
                "from_stage": old_stage,
                "to_stage": new_stage,
                **note_meta,
                "source": "loomrun_ai",
            },
        )
    elif notes_only:
        await log_production_activity(
            organization_id=organization_id,
            production_order_id=row.id,
            lead_id=row.leadId,
            user_id=user_id,
            activity_type=ProductionActivityType.NOTE_ADDED,
            body=note_meta["customer_note"] or note_meta["internal_note"] or "Note added",
            metadata={**note_meta, "source": "loomrun_ai"},
        )

    if "orderStatus" in data:
        new_status = _enum_name(data["orderStatus"])
        if new_status != old_status:
            await log_production_activity(
                organization_id=organization_id,
                production_order_id=row.id,
                lead_id=row.leadId,
                user_id=user_id,
                activity_type=ProductionActivityType.STATUS_CHANGED,
                body=f"Status changed from {old_status.replace('_', ' ').title()} to {new_status.replace('_', ' ').title()}",
                metadata={"from_status": old_status, "to_status": new_status},
            )

    eta_changed = any(
        k in data
        for k in ("expectedCompletionAt", "expectedDispatchAt", "actualDispatchAt")
    )
    if eta_changed:
        await log_production_activity(
            organization_id=organization_id,
            production_order_id=row.id,
            lead_id=row.leadId,
            user_id=user_id,
            activity_type=ProductionActivityType.ETA_UPDATED,
            body="ETA updated",
            metadata={
                "expected_completion_at": _iso(data.get("expectedCompletionAt", row.expectedCompletionAt)),
                "expected_dispatch_at": _iso(data.get("expectedDispatchAt", row.expectedDispatchAt)),
                "actual_dispatch_at": _iso(data.get("actualDispatchAt", row.actualDispatchAt)),
            },
        )

    ship_changed = any(
        k in data for k in ("courierName", "courierTrackingNo", "shippingNotes")
    )
    if ship_changed:
        await log_production_activity(
            organization_id=organization_id,
            production_order_id=row.id,
            lead_id=row.leadId,
            user_id=user_id,
            activity_type=ProductionActivityType.SHIPMENT_UPDATED,
            body="Shipment details updated",
            metadata={
                "courier_name": data.get("courierName", row.courierName),
                "courier_tracking_no": data.get("courierTrackingNo", row.courierTrackingNo),
            },
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
