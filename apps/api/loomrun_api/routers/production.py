from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from loomrun_api.date_filter import apply_created_at
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.pnl import compute_pnl, serialize_expense
from loomrun_api import org_events
from loomrun_api.prisma_client import prisma
from loomrun_api.production_activity import log_production_activity, stage_label
from prisma.enums import PaymentStatus, ProductionActivityType, ProductionStage

router = APIRouter()


class ProductionCreate(BaseModel):
    lead_id: str
    quotation_id: str | None = None


class ProductionStageUpdate(BaseModel):
    stage: ProductionStage | None = None
    delay_flag: bool | None = None
    budget_cents: int | None = Field(default=None, ge=0)
    name: str | None = Field(default=None, max_length=200)


class PaymentCreate(BaseModel):
    amount_cents: int = Field(gt=0)
    status: PaymentStatus = PaymentStatus.PAID
    note: str | None = None


class NestedExpenseCreate(BaseModel):
    category: str
    subcategory: str | None = None
    amount_cents: int = Field(gt=0)
    description: str | None = None
    vendor: str | None = None
    incurred_at: datetime | None = None


def _serialize_activity(act) -> dict:
    return {
        "id": act.id,
        "production_order_id": act.productionOrderId,
        "lead_id": act.leadId,
        "type": act.type.name if hasattr(act.type, "name") else str(act.type),
        "body": act.body,
        "metadata": act.metadata,
        "user_id": act.userId,
        "user_name": act.user.name if act.user else None,
        "created_at": act.createdAt.isoformat(),
    }


def _display_name(r) -> str | None:
    if getattr(r, "name", None):
        return r.name
    if r.lead:
        return r.lead.title
    return None


def _serialize_order(r) -> dict:
    pnl = compute_pnl(order=r)
    lead_title = r.lead.title if r.lead else None
    return {
        "id": r.id,
        "lead_id": r.leadId,
        "quotation_id": r.quotationId,
        "name": r.name,
        "display_name": _display_name(r),
        "stage": r.stage.name if hasattr(r.stage, "name") else str(r.stage),
        "delay_flag": r.delayFlag,
        "budget_cents": r.budgetCents,
        "stage_entered_at": r.stageEnteredAt.isoformat(),
        "lead_title": lead_title,
        "payments": [
            {
                "id": p.id,
                "amount_cents": p.amountCents,
                "status": p.status.name if hasattr(p.status, "name") else str(p.status),
                "note": p.note,
                "recorded_at": p.recordedAt.isoformat() if p.recordedAt else None,
            }
            for p in (r.payments or [])
        ],
        "expenses": [serialize_expense(e) for e in (r.expenses or [])],
        "pnl": pnl,
    }


@router.get("/orgs/{org_id}/production/activity-log")
async def list_production_activity_log(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    apply_created_at(where, day)
    rows = await prisma.productionactivity.find_many(
        where=where,
        order={"createdAt": "desc"},
        include={"lead": True, "user": True},
    )
    grouped: dict[str, dict] = {}
    for act in rows:
        lead_id = act.leadId
        if lead_id not in grouped:
            grouped[lead_id] = {
                "lead_id": lead_id,
                "lead_title": act.lead.title if act.lead else None,
                "production_order_id": act.productionOrderId,
                "activities": [],
            }
        grouped[lead_id]["activities"].append(_serialize_activity(act))
    groups = sorted(
        grouped.values(),
        key=lambda g: g["activities"][0]["created_at"] if g["activities"] else "",
        reverse=True,
    )
    return {"groups": groups}


@router.get("/orgs/{org_id}/production")
async def list_production(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    apply_created_at(where, day)
    rows = await prisma.productionorder.find_many(
        where=where,
        order={"updatedAt": "desc"},
        include={
            "lead": True,
            "quotation": True,
            "payments": True,
            "expenses": {"include": {"createdBy": True}},
        },
    )
    return {"items": [_serialize_order(r) for r in rows]}


@router.post("/orgs/{org_id}/production", status_code=status.HTTP_201_CREATED)
async def create_production(org_id: str, body: ProductionCreate, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    lead = await prisma.lead.find_first(where={"id": body.lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    existing = await prisma.productionorder.find_unique(where={"leadId": body.lead_id})
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Production order already exists for this lead")
    if body.quotation_id:
        q = await prisma.quotation.find_first(
            where={"id": body.quotation_id, "organizationId": ctx.organization_id, "leadId": body.lead_id},
        )
        if not q:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Quotation not found for lead")
    stage = ProductionStage.FABRIC_CHECK
    row = await prisma.productionorder.create(
        data={
            "organizationId": ctx.organization_id,
            "leadId": body.lead_id,
            "quotationId": body.quotation_id,
            "stage": stage,
            "stageEnteredAt": datetime.now(timezone.utc),
        },
    )
    stage_name = stage.name if hasattr(stage, "name") else str(stage)
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=row.id,
        lead_id=body.lead_id,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.ORDER_CREATED,
        body=f"Production order started at {stage_label(stage_name)}",
        metadata={"stage": stage_name, "quotation_id": body.quotation_id},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=row.id,
    )
    return {
        "id": row.id,
        "lead_id": row.leadId,
        "stage": stage_name,
    }


@router.patch("/orgs/{org_id}/production/{order_id}")
async def update_production(
    org_id: str, order_id: str, body: ProductionStageUpdate, ctx: OrgContext = Depends(require_roles("OWNER"))
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
        include={"lead": True},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    old_stage = row.stage.name if hasattr(row.stage, "name") else str(row.stage)
    new_stage = body.stage.name if body.stage is not None and hasattr(body.stage, "name") else (
        str(body.stage) if body.stage is not None else old_stage
    )
    data: dict = {}
    if body.stage is not None and new_stage != old_stage:
        data["stage"] = body.stage
        data["stageEnteredAt"] = datetime.now(timezone.utc)
    if body.delay_flag is not None and body.delay_flag != row.delayFlag:
        data["delayFlag"] = body.delay_flag
    budget_changed = body.budget_cents is not None and body.budget_cents != row.budgetCents
    if budget_changed:
        data["budgetCents"] = body.budget_cents

    name_changed = False
    new_name: str | None = row.name
    if "name" in body.model_fields_set:
        cleaned = (body.name or "").strip() or None
        if cleaned != row.name:
            data["name"] = cleaned
            new_name = cleaned
            name_changed = True

    if not data:
        return {
            "id": row.id,
            "stage": old_stage,
            "delay_flag": row.delayFlag,
            "budget_cents": row.budgetCents,
            "name": row.name,
            "display_name": _display_name(row),
            "lead_title": row.lead.title if row.lead else None,
        }
    updated = await prisma.productionorder.update(
        where={"id": order_id},
        data=data,
        include={"lead": True},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    if body.stage is not None and new_stage != old_stage:
        await log_production_activity(
            organization_id=ctx.organization_id,
            production_order_id=order_id,
            lead_id=row.leadId,
            user_id=ctx.membership.userId,
            activity_type=ProductionActivityType.STAGE_CHANGED,
            body=f"Stage changed from {stage_label(old_stage)} to {stage_label(new_stage)}",
            metadata={"from_stage": old_stage, "to_stage": new_stage},
        )
    if body.delay_flag is not None and body.delay_flag != row.delayFlag:
        await log_production_activity(
            organization_id=ctx.organization_id,
            production_order_id=order_id,
            lead_id=row.leadId,
            user_id=ctx.membership.userId,
            activity_type=ProductionActivityType.DELAY_TOGGLED,
            body="Order marked as delayed" if body.delay_flag else "Delay flag cleared",
            metadata={"delay_flag": body.delay_flag},
        )
    if budget_changed:
        amount = (body.budget_cents or 0) / 100
        await log_production_activity(
            organization_id=ctx.organization_id,
            production_order_id=order_id,
            lead_id=row.leadId,
            user_id=ctx.membership.userId,
            activity_type=ProductionActivityType.BUDGET_SET,
            body=f"Budget set to ₹{amount:,.2f}",
            metadata={"budget_cents": body.budget_cents},
        )
    if name_changed:
        display = new_name or (updated.lead.title if updated.lead else "Unnamed")
        await log_production_activity(
            organization_id=ctx.organization_id,
            production_order_id=order_id,
            lead_id=row.leadId,
            user_id=ctx.membership.userId,
            activity_type=ProductionActivityType.NAME_CHANGED,
            body=f"Order renamed to “{display}”",
            metadata={"name": new_name, "previous_name": row.name},
        )
    return {
        "id": updated.id,
        "stage": updated.stage.name if hasattr(updated.stage, "name") else str(updated.stage),
        "delay_flag": updated.delayFlag,
        "budget_cents": updated.budgetCents,
        "name": updated.name,
        "display_name": _display_name(updated),
        "lead_title": updated.lead.title if updated.lead else None,
    }


@router.delete("/orgs/{org_id}/production/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_production(
    org_id: str, order_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))
) -> None:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    # Payments, expenses, and activities cascade-delete via their FK relations.
    await prisma.productionorder.delete(where={"id": order_id})
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
        deleted=True,
    )


@router.get("/orgs/{org_id}/production/{order_id}/pnl")
async def get_production_pnl(
    org_id: str, order_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
        include={"lead": True, "quotation": True, "payments": True, "expenses": True},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    return {
        "production_order_id": row.id,
        "lead_id": row.leadId,
        "lead_title": row.lead.title if row.lead else None,
        **compute_pnl(order=row),
    }


@router.post("/orgs/{org_id}/production/{order_id}/payments", status_code=status.HTTP_201_CREATED)
async def add_payment(
    org_id: str, order_id: str, body: PaymentCreate, ctx: OrgContext = Depends(require_roles("OWNER"))
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    p = await prisma.payment.create(
        data={
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
            "amountCents": body.amount_cents,
            "status": body.status,
            "note": body.note,
        }
    )
    status_name = body.status.name if hasattr(body.status, "name") else str(body.status)
    amount = body.amount_cents / 100
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=row.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.PAYMENT_RECORDED,
        body=f"Payment of ₹{amount:,.2f} recorded ({status_name})",
        metadata={
            "payment_id": p.id,
            "amount_cents": body.amount_cents,
            "status": status_name,
            "note": body.note,
        },
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    return {
        "id": p.id,
        "amount_cents": p.amountCents,
        "status": p.status.name if hasattr(p.status, "name") else str(p.status),
    }


@router.post("/orgs/{org_id}/production/{order_id}/expenses", status_code=status.HTTP_201_CREATED)
async def add_production_expense(
    org_id: str, order_id: str, body: NestedExpenseCreate, ctx: OrgContext = Depends(require_roles("OWNER"))
) -> dict:
    order = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")

    incurred = body.incurred_at or datetime.now(timezone.utc)
    row = await prisma.expense.create(
        data={
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
            "leadId": order.leadId,
            "category": " ".join(body.category.split()),
            "subcategory": " ".join((body.subcategory or "").split()) or None,
            "amountCents": body.amount_cents,
            "description": body.description,
            "vendor": body.vendor,
            "incurredAt": incurred,
            "createdById": ctx.membership.userId,
        },
        include={"productionOrder": {"include": {"lead": True}}, "lead": True, "createdBy": True},
    )
    cat = " ".join(body.category.split())
    sub = " ".join((body.subcategory or "").split()) or None
    amount = body.amount_cents / 100
    label = f"{cat} / {sub}" if sub else cat
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.EXPENSE_RECORDED,
        body=f"Expense ₹{amount:,.2f} recorded ({label})",
        metadata={
            "expense_id": row.id,
            "amount_cents": body.amount_cents,
            "category": cat,
            "subcategory": sub,
            "vendor": body.vendor,
        },
    )
    return serialize_expense(row)
