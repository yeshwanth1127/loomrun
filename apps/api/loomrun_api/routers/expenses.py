from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from loomrun_api.date_filter import parse_day_param
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.pnl import serialize_expense
from loomrun_api import org_events
from loomrun_api.prisma_client import prisma
from loomrun_api.production_activity import log_production_activity
from prisma.enums import ProductionActivityType

router = APIRouter()


def _label(value: str | None, *, field: str, required: bool = True, max_len: int = 80) -> str | None:
    text = " ".join(str(value or "").split())
    if not text:
        if required:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{field} is required")
        return None
    if len(text) > max_len:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{field} is too long")
    return text


class ExpenseLineIn(BaseModel):
    subcategory: str
    amount_cents: int = Field(gt=0)
    description: str | None = None
    incurred_at: datetime | None = None


class ExpenseCreate(BaseModel):
    lead_id: str | None = None
    production_order_id: str | None = None
    category: str
    subcategory: str | None = None
    amount_cents: int | None = Field(default=None, gt=0)
    description: str | None = None
    vendor: str | None = None
    incurred_at: datetime | None = None
    lines: list[ExpenseLineIn] | None = None


class ExpenseUpdate(BaseModel):
    lead_id: str | None = None
    production_order_id: str | None = None
    category: str | None = None
    subcategory: str | None = None
    amount_cents: int | None = Field(default=None, gt=0)
    description: str | None = None
    vendor: str | None = None
    incurred_at: datetime | None = None
    clear_production_order: bool = False
    clear_lead: bool = False
    clear_subcategory: bool = False


def _apply_incurred_at(where: dict, day: str | None) -> dict:
    rng = parse_day_param(day)
    if rng:
        where["incurredAt"] = {"gte": rng[0], "lt": rng[1]}
    return where


@router.get("/orgs/{org_id}/expenses")
async def list_expenses(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    scope: str = Query("all", description="all | job | overhead"),
    category: str | None = Query(None),
    production_order_id: str | None = Query(None),
    lead_id: str | None = Query(None),
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    _apply_incurred_at(where, day)

    scope_norm = (scope or "all").strip().lower()
    if scope_norm == "job":
        where["productionOrderId"] = {"not": None}
    elif scope_norm == "overhead":
        where["productionOrderId"] = None
    elif scope_norm != "all":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="scope must be all, job, or overhead")

    if category:
        where["category"] = {"equals": category.strip(), "mode": "insensitive"}
    if production_order_id:
        where["productionOrderId"] = production_order_id
    if lead_id:
        where["leadId"] = lead_id

    rows = await prisma.expense.find_many(
        where=where,
        order={"incurredAt": "desc"},
        include={"productionOrder": {"include": {"lead": True}}, "lead": True, "createdBy": True},
    )

    job_cost_total = sum(r.amountCents for r in rows if r.productionOrderId)
    overhead_total = sum(r.amountCents for r in rows if not r.productionOrderId)

    return {
        "items": [serialize_expense(r) for r in rows],
        "summary": {
            "job_cost_total_cents": job_cost_total,
            "overhead_total_cents": overhead_total,
            "total_cents": job_cost_total + overhead_total,
            "count": len(rows),
        },
    }


@router.post("/orgs/{org_id}/expenses", status_code=status.HTTP_201_CREATED)
async def create_expense(
    org_id: str, body: ExpenseCreate, ctx: OrgContext = Depends(require_roles("OWNER"))
) -> dict:
    lead = None
    order = None
    if body.lead_id:
        lead = await prisma.lead.find_first(
            where={"id": body.lead_id, "organizationId": ctx.organization_id},
        )
        if not lead:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
        order = await prisma.productionorder.find_first(
            where={"leadId": lead.id, "organizationId": ctx.organization_id},
        )
    elif body.production_order_id:
        order = await prisma.productionorder.find_first(
            where={"id": body.production_order_id, "organizationId": ctx.organization_id},
        )
        if not order:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")

    category = _label(body.category, field="category")
    include = {"productionOrder": {"include": {"lead": True}}, "lead": True, "createdBy": True}
    lines = body.lines or []
    if not lines:
        if body.amount_cents is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="amount_cents is required")
        lines = [
            ExpenseLineIn(
                subcategory=body.subcategory or "",
                amount_cents=body.amount_cents,
                description=body.description,
                incurred_at=body.incurred_at,
            )
        ]

    created = []
    for line in lines:
        subcategory = _label(line.subcategory, field="subcategory", required=False)
        incurred = line.incurred_at or datetime.now(timezone.utc)
        row = await prisma.expense.create(
            data={
                "organizationId": ctx.organization_id,
                "productionOrderId": order.id if order else None,
                "leadId": lead.id if lead else (order.leadId if order else None),
                "category": category,
                "subcategory": subcategory,
                "amountCents": line.amount_cents,
                "description": line.description or body.description,
                "vendor": body.vendor,
                "incurredAt": incurred,
                "createdById": ctx.membership.userId,
            },
            include=include,
        )
        org_events.record_changed(
            organization_id=ctx.organization_id,
            entity_type=org_events.qlix_docs.ENTITY_EXPENSE,
            entity_id=row.id,
        )
        if order:
            amount = line.amount_cents / 100
            await log_production_activity(
                organization_id=ctx.organization_id,
                production_order_id=order.id,
                lead_id=order.leadId,
                user_id=ctx.membership.userId,
                activity_type=ProductionActivityType.EXPENSE_RECORDED,
                body=f"Expense ₹{amount:,.2f} recorded ({category} / {subcategory})",
                metadata={
                    "expense_id": row.id,
                    "amount_cents": line.amount_cents,
                    "category": category,
                    "subcategory": subcategory,
                    "vendor": body.vendor,
                },
            )
        created.append(serialize_expense(row))

    if body.lines:
        return {
            "items": created,
            "count": len(created),
            "total_cents": sum(item["amount_cents"] for item in created),
        }
    return created[0]


@router.patch("/orgs/{org_id}/expenses/{expense_id}")
async def update_expense(
    org_id: str,
    expense_id: str,
    body: ExpenseUpdate,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    existing = await prisma.expense.find_first(
        where={"id": expense_id, "organizationId": ctx.organization_id},
    )
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense not found")

    data: dict = {}
    if body.category is not None:
        data["category"] = _label(body.category, field="category")
    if body.clear_subcategory:
        data["subcategory"] = None
    elif body.subcategory is not None:
        data["subcategory"] = _label(body.subcategory, field="subcategory")
    if body.amount_cents is not None:
        data["amountCents"] = body.amount_cents
    if body.description is not None:
        data["description"] = body.description
    if body.vendor is not None:
        data["vendor"] = body.vendor
    if body.incurred_at is not None:
        data["incurredAt"] = body.incurred_at

    if body.clear_lead:
        data["leadId"] = None
        data["productionOrderId"] = None
    elif body.lead_id is not None:
        lead = await prisma.lead.find_first(
            where={"id": body.lead_id, "organizationId": ctx.organization_id},
        )
        if not lead:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
        order = await prisma.productionorder.find_first(
            where={"leadId": lead.id, "organizationId": ctx.organization_id},
        )
        data["leadId"] = lead.id
        data["productionOrderId"] = order.id if order else None
    elif body.clear_production_order:
        data["productionOrderId"] = None
    elif body.production_order_id is not None:
        order = await prisma.productionorder.find_first(
            where={"id": body.production_order_id, "organizationId": ctx.organization_id},
        )
        if not order:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
        data["productionOrderId"] = body.production_order_id
        data["leadId"] = order.leadId

    if not data:
        row = await prisma.expense.find_unique(
            where={"id": expense_id},
            include={"productionOrder": {"include": {"lead": True}}, "lead": True, "createdBy": True},
        )
        return serialize_expense(row)

    updated = await prisma.expense.update(
        where={"id": expense_id},
        data=data,
        include={"productionOrder": {"include": {"lead": True}}, "lead": True, "createdBy": True},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_EXPENSE,
        entity_id=expense_id,
    )
    return serialize_expense(updated)


@router.delete("/orgs/{org_id}/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(
    org_id: str, expense_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))
) -> None:
    existing = await prisma.expense.find_first(
        where={"id": expense_id, "organizationId": ctx.organization_id},
    )
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense not found")
    await prisma.expense.delete(where={"id": expense_id})
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_EXPENSE,
        entity_id=expense_id,
        deleted=True,
    )
