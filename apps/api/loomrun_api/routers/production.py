from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from loomrun_api.date_filter import apply_created_at
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.collections import (
    normalize_payment_method,
    serialize_expected_payment,
    serialize_payment,
)
from loomrun_api.pnl import compute_pnl, serialize_expense
from loomrun_api import org_events
from loomrun_api.prisma_client import prisma
from loomrun_api.production_activity import log_production_activity, stage_label
from loomrun_api.services.production import next_order_number, new_tracking_token, serialize_order
from prisma.enums import (
    ExpectedPaymentStatus,
    OrderStatus,
    PaymentStatus,
    ProductionActivityType,
    ProductionStage,
)

router = APIRouter()


class ProductionCreate(BaseModel):
    lead_id: str
    quotation_id: str | None = None
    expected_completion_at: datetime | None = None
    expected_dispatch_at: datetime | None = None


class ProductionStageUpdate(BaseModel):
    stage: ProductionStage | None = None
    delay_flag: bool | None = None
    budget_cents: int | None = Field(default=None, ge=0)
    name: str | None = Field(default=None, max_length=200)
    order_status: OrderStatus | None = None
    expected_completion_at: datetime | None = None
    expected_dispatch_at: datetime | None = None
    actual_dispatch_at: datetime | None = None
    clear_expected_completion: bool = False
    clear_expected_dispatch: bool = False
    courier_name: str | None = Field(default=None, max_length=200)
    courier_tracking_no: str | None = Field(default=None, max_length=200)
    shipping_notes: str | None = Field(default=None, max_length=2000)
    on_hold_reason: str | None = Field(default=None, max_length=500)
    internal_note: str | None = Field(default=None, max_length=2000)
    customer_note: str | None = Field(default=None, max_length=2000)
    design_garment_type: str | None = Field(default=None, max_length=40)
    design_garment_color: str | None = Field(default=None, max_length=16)


class PaymentCreate(BaseModel):
    amount_cents: int = Field(gt=0)
    status: PaymentStatus = PaymentStatus.PAID
    note: str | None = None
    method: str | None = None
    reference: str | None = Field(default=None, max_length=200)
    label: str | None = Field(default=None, max_length=80)
    recorded_at: datetime | None = None
    expected_payment_id: str | None = None


class PaymentUpdate(BaseModel):
    amount_cents: int | None = Field(default=None, gt=0)
    status: PaymentStatus | None = None
    note: str | None = None
    method: str | None = None
    reference: str | None = Field(default=None, max_length=200)
    label: str | None = Field(default=None, max_length=80)
    recorded_at: datetime | None = None


class ExpectedPaymentCreate(BaseModel):
    amount_cents: int = Field(gt=0)
    expected_at: datetime | None = None
    note: str | None = Field(default=None, max_length=2000)
    label: str | None = Field(default=None, max_length=80)


class ExpectedPaymentUpdate(BaseModel):
    amount_cents: int | None = Field(default=None, gt=0)
    expected_at: datetime | None = None
    clear_expected_at: bool = False
    note: str | None = Field(default=None, max_length=2000)
    label: str | None = Field(default=None, max_length=80)


class ExpectedPaymentReschedule(BaseModel):
    expected_at: datetime | None = None
    clear_expected_at: bool = False
    note: str | None = Field(default=None, max_length=2000)


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
    return serialize_order(r)


def _enum_name(value) -> str:
    return value.name if hasattr(value, "name") else str(value)


def _iso(dt) -> str | None:
    if dt is None:
        return None
    return dt.isoformat() if hasattr(dt, "isoformat") else str(dt)


def _role_name(ctx: OrgContext) -> str:
    role = ctx.membership.role
    return role.name if hasattr(role, "name") else str(role)


def _is_owner(ctx: OrgContext) -> bool:
    return _role_name(ctx) == "OWNER"


def _serialize_order_for_role(r, ctx: OrgContext) -> dict:
    data = serialize_order(r)
    role = _role_name(ctx)
    if role == "OWNER":
        return data
    if role == "PRODUCTION_MANAGER":
        # Managers may view collection position, not company costs.
        data["expenses"] = []
        data["budget_cents"] = None
        pnl = data.get("pnl") or {}
        data["pnl"] = {
            **pnl,
            "budget_cents": None,
            "actual_cost_cents": 0,
            "margin_cents": None,
            "budget_variance_cents": None,
            "over_budget": False,
        }
        return data
    # Factory staff see ops fields only — no money.
    data["payments"] = []
    data["expected_payments"] = []
    data["payment_timeline"] = []
    data["expenses"] = []
    data["pnl"] = {
        "revenue_cents": None,
        "revenue_source": None,
        "budget_cents": None,
        "actual_cost_cents": 0,
        "collected_cents": 0,
        "balance_due_cents": None,
        "overpaid_cents": 0,
        "collection_percentage": None,
        "payment_status": "UNPAID",
        "next_expected_payment": None,
        "overdue_expected_count": 0,
        "overdue_expected_cents": 0,
        "active_expected_count": 0,
        "margin_cents": None,
        "budget_variance_cents": None,
        "collection_gap_cents": None,
        "over_budget": False,
    }
    data["budget_cents"] = None
    return data


_ORDER_MONEY_INCLUDE = {
    "lead": True,
    "quotation": True,
    "payments": True,
    "expectedPayments": True,
    "expenses": True,
}


_OPS_ROLES = require_roles("OWNER", "PRODUCTION", "PRODUCTION_MANAGER")
_OWNER_ONLY = require_roles("OWNER")


@router.get("/orgs/{org_id}/production/activity-log")
async def list_production_activity_log(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    ctx: OrgContext = Depends(_OPS_ROLES),
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
    lead_id: str | None = Query(None, description="Filter by lead id"),
    stage: str | None = Query(None, description="Production stage"),
    order_status: str | None = Query(None, description="Order health status"),
    search: str | None = Query(None, description="Search order number, name, or customer"),
    filter: str | None = Query(
        None,
        description="Preset: active | delayed | on_hold | shipped | completed",
    ),
    ctx: OrgContext = Depends(_OPS_ROLES),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    apply_created_at(where, day)
    if lead_id:
        where["leadId"] = lead_id
    if stage:
        key = stage.strip().upper()
        try:
            where["stage"] = ProductionStage[key]
        except KeyError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown stage '{stage}'",
            )
    if order_status:
        key = order_status.strip().upper()
        try:
            where["orderStatus"] = OrderStatus[key]
        except KeyError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown order_status '{order_status}'",
            )

    rows = await prisma.productionorder.find_many(
        where=where,
        order={"updatedAt": "desc"},
        include={
            "lead": True,
            "quotation": True,
            "payments": True,
            "expectedPayments": True,
            "expenses": {"include": {"createdBy": True}},
        },
    )
    items = [_serialize_order_for_role(r, ctx) for r in rows]

    q = (search or "").strip().lower()
    if q:
        items = [
            it
            for it in items
            if q in (it.get("order_number") or "").lower()
            or q in (it.get("name") or "").lower()
            or q in (it.get("display_name") or "").lower()
            or q in (it.get("lead_title") or "").lower()
        ]

    preset = (filter or "").strip().lower()
    if preset == "active":
        items = [
            it
            for it in items
            if it.get("stage") not in ("DELIVERED",)
            and it.get("order_status") not in ("COMPLETED", "CANCELLED")
        ]
    elif preset == "delayed":
        items = [it for it in items if it.get("order_status") == "DELAYED" or it.get("delay_flag")]
    elif preset == "on_hold":
        items = [it for it in items if it.get("order_status") == "ON_HOLD"]
    elif preset == "shipped":
        items = [it for it in items if it.get("stage") == "SHIPPED"]
    elif preset == "completed":
        items = [
            it
            for it in items
            if it.get("stage") == "DELIVERED" or it.get("order_status") == "COMPLETED"
        ]
    elif preset:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="filter must be one of: active, delayed, on_hold, shipped, completed",
        )

    return {"items": items, "count": len(items)}


@router.post("/orgs/{org_id}/production", status_code=status.HTTP_201_CREATED)
async def create_production(org_id: str, body: ProductionCreate, ctx: OrgContext = Depends(_OWNER_ONLY)) -> dict:
    lead = await prisma.lead.find_first(where={"id": body.lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if body.quotation_id:
        q = await prisma.quotation.find_first(
            where={"id": body.quotation_id, "organizationId": ctx.organization_id, "leadId": body.lead_id},
        )
        if not q:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Quotation not found for lead")
    order_number = await next_order_number(ctx.organization_id)
    stage = ProductionStage.FABRIC_CHECK
    row = await prisma.productionorder.create(
        data={
            "organizationId": ctx.organization_id,
            "leadId": body.lead_id,
            "quotationId": body.quotation_id,
            "orderNumber": order_number,
            "stage": stage,
            "orderStatus": OrderStatus.ON_TRACK,
            "expectedCompletionAt": body.expected_completion_at,
            "expectedDispatchAt": body.expected_dispatch_at,
            "trackingToken": new_tracking_token(),
            "trackingEnabled": True,
            "stageEnteredAt": datetime.now(timezone.utc),
        },
        include={
            "lead": True,
            "quotation": True,
            "payments": True,
            "expectedPayments": True,
            "expenses": {"include": {"createdBy": True}},
        },
    )
    stage_name = stage.name if hasattr(stage, "name") else str(stage)
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=row.id,
        lead_id=body.lead_id,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.ORDER_CREATED,
        body=f"Order {order_number} created at {stage_label(stage_name)}",
        metadata={
            "stage": stage_name,
            "quotation_id": body.quotation_id,
            "order_number": order_number,
            "expected_completion_at": _iso(body.expected_completion_at),
            "expected_dispatch_at": _iso(body.expected_dispatch_at),
        },
    )
    from loomrun_api.pipeline_stage_move import mark_lead_won_on_order_placed

    await mark_lead_won_on_order_placed(
        db=prisma,
        lead=lead,
        user_id=ctx.membership.userId,
        order_number=order_number,
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=row.id,
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_LEAD,
        entity_id=body.lead_id,
    )
    return _serialize_order(row)


@router.patch("/orgs/{org_id}/production/{order_id}")
async def update_production(
    org_id: str, order_id: str, body: ProductionStageUpdate, ctx: OrgContext = Depends(_OPS_ROLES)
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
        include={"lead": True},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")

    owner = _is_owner(ctx)
    # Factory staff may update ops fields; money + cancel stay Owner-only.
    if not owner:
        if body.budget_cents is not None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only owners can set budget")
        if body.order_status is not None and _enum_name(body.order_status) == "CANCELLED":
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only owners can cancel orders")

    old_stage = _enum_name(row.stage)
    old_status = _enum_name(getattr(row, "orderStatus", None) or OrderStatus.ON_TRACK)
    new_stage = _enum_name(body.stage) if body.stage is not None else old_stage
    data: dict = {}

    if body.stage is not None and new_stage != old_stage:
        data["stage"] = body.stage
        data["stageEnteredAt"] = datetime.now(timezone.utc)
        if new_stage == "DELIVERED":
            data["orderStatus"] = OrderStatus.COMPLETED
        if new_stage == "SHIPPED" and not row.actualDispatchAt and body.actual_dispatch_at is None:
            data["actualDispatchAt"] = datetime.now(timezone.utc)

    if body.delay_flag is not None and body.delay_flag != row.delayFlag:
        data["delayFlag"] = body.delay_flag
        if body.delay_flag and "orderStatus" not in data:
            data["orderStatus"] = OrderStatus.DELAYED
        elif not body.delay_flag and old_status == "DELAYED" and "orderStatus" not in data:
            data["orderStatus"] = OrderStatus.ON_TRACK

    if body.order_status is not None:
        new_status = _enum_name(body.order_status)
        data["orderStatus"] = body.order_status
        data["delayFlag"] = new_status == "DELAYED"
        if new_status == "CANCELLED":
            data["cancelledAt"] = datetime.now(timezone.utc)
        elif row.cancelledAt:
            data["cancelledAt"] = None
        if new_status != "ON_HOLD":
            data["onHoldReason"] = None

    budget_changed = False
    if owner:
        budget_changed = body.budget_cents is not None and body.budget_cents != row.budgetCents
        if budget_changed:
            data["budgetCents"] = body.budget_cents

    name_changed = False
    if "design_garment_type" in body.model_fields_set:
        from loomrun_api.garment_defaults import normalize_product_type
        raw = body.design_garment_type
        if raw is None or str(raw).strip() == "":
            data["designGarmentType"] = None
        else:
            nt = normalize_product_type(raw)
            if not nt:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid design garment type")
            data["designGarmentType"] = nt
    if "design_garment_color" in body.model_fields_set:
        from loomrun_api.garment_defaults import normalize_hex_color
        raw = body.design_garment_color
        if raw is None or str(raw).strip() == "":
            data["designGarmentColor"] = None
        else:
            try:
                data["designGarmentColor"] = normalize_hex_color(raw)
            except ValueError as exc:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    new_name: str | None = row.name
    if "name" in body.model_fields_set:
        cleaned = (body.name or "").strip() or None
        if cleaned != row.name:
            data["name"] = cleaned
            new_name = cleaned
            name_changed = True

    if "expected_completion_at" in body.model_fields_set and body.expected_completion_at is not None:
        data["expectedCompletionAt"] = body.expected_completion_at
    elif body.clear_expected_completion:
        data["expectedCompletionAt"] = None
    if "expected_dispatch_at" in body.model_fields_set and body.expected_dispatch_at is not None:
        data["expectedDispatchAt"] = body.expected_dispatch_at
    elif body.clear_expected_dispatch:
        data["expectedDispatchAt"] = None
    if body.actual_dispatch_at is not None:
        data["actualDispatchAt"] = body.actual_dispatch_at
    if "courier_name" in body.model_fields_set:
        data["courierName"] = (body.courier_name or "").strip() or None
    if "courier_tracking_no" in body.model_fields_set:
        data["courierTrackingNo"] = (body.courier_tracking_no or "").strip() or None
    if "shipping_notes" in body.model_fields_set:
        data["shippingNotes"] = (body.shipping_notes or "").strip() or None
    if "on_hold_reason" in body.model_fields_set:
        data["onHoldReason"] = (body.on_hold_reason or "").strip() or None

    internal_note = (body.internal_note or "").strip() or None
    customer_note = (body.customer_note or "").strip() or None
    notes_only = bool(internal_note or customer_note)

    if not data and not notes_only:
        full = await prisma.productionorder.find_first(
            where={"id": order_id, "organizationId": ctx.organization_id},
            include={
                "lead": True,
                "quotation": True,
                "payments": True,
                "expectedPayments": True,
                "expenses": {"include": {"createdBy": True}},
            },
        )
        return _serialize_order_for_role(full or row, ctx)

    updated = row
    if data:
        updated = await prisma.productionorder.update(
            where={"id": order_id},
            data=data,
            include={
                "lead": True,
                "quotation": True,
                "payments": True,
                "expectedPayments": True,
                "expenses": {"include": {"createdBy": True}},
            },
        )
        org_events.record_changed(
            organization_id=ctx.organization_id,
            entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
            entity_id=order_id,
        )
    else:
        updated = await prisma.productionorder.find_first(
            where={"id": order_id, "organizationId": ctx.organization_id},
            include={
                "lead": True,
                "quotation": True,
                "payments": True,
                "expectedPayments": True,
                "expenses": {"include": {"createdBy": True}},
            },
        )

    note_meta = {"internal_note": internal_note, "customer_note": customer_note}

    if body.stage is not None and new_stage != old_stage:
        body_text = f"Stage changed from {stage_label(old_stage)} to {stage_label(new_stage)}"
        if customer_note:
            body_text = f"{body_text}: {customer_note}"
        await log_production_activity(
            organization_id=ctx.organization_id,
            production_order_id=order_id,
            lead_id=row.leadId,
            user_id=ctx.membership.userId,
            activity_type=ProductionActivityType.STAGE_CHANGED,
            body=body_text,
            metadata={"from_stage": old_stage, "to_stage": new_stage, **note_meta},
        )
    elif notes_only:
        await log_production_activity(
            organization_id=ctx.organization_id,
            production_order_id=order_id,
            lead_id=row.leadId,
            user_id=ctx.membership.userId,
            activity_type=ProductionActivityType.NOTE_ADDED,
            body=customer_note or internal_note or "Note added",
            metadata=note_meta,
        )

    if "orderStatus" in data:
        new_status = _enum_name(data["orderStatus"])
        if new_status != old_status:
            await log_production_activity(
                organization_id=ctx.organization_id,
                production_order_id=order_id,
                lead_id=row.leadId,
                user_id=ctx.membership.userId,
                activity_type=ProductionActivityType.STATUS_CHANGED,
                body=(
                    f"Status changed from {old_status.replace('_', ' ').title()} "
                    f"to {new_status.replace('_', ' ').title()}"
                ),
                metadata={"from_status": old_status, "to_status": new_status},
            )

    if body.delay_flag is not None and body.delay_flag != row.delayFlag and "orderStatus" not in data:
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
        display = new_name or (updated.lead.title if updated and updated.lead else "Unnamed")
        await log_production_activity(
            organization_id=ctx.organization_id,
            production_order_id=order_id,
            lead_id=row.leadId,
            user_id=ctx.membership.userId,
            activity_type=ProductionActivityType.NAME_CHANGED,
            body=f"Order renamed to “{display}”",
            metadata={"name": new_name, "previous_name": row.name},
        )

    eta_keys = {"expectedCompletionAt", "expectedDispatchAt", "actualDispatchAt"}
    if eta_keys & data.keys():
        await log_production_activity(
            organization_id=ctx.organization_id,
            production_order_id=order_id,
            lead_id=row.leadId,
            user_id=ctx.membership.userId,
            activity_type=ProductionActivityType.ETA_UPDATED,
            body="ETA updated",
            metadata={
                "expected_completion_at": _iso(
                    data.get("expectedCompletionAt", row.expectedCompletionAt)
                ),
                "expected_dispatch_at": _iso(
                    data.get("expectedDispatchAt", row.expectedDispatchAt)
                ),
                "actual_dispatch_at": _iso(data.get("actualDispatchAt", row.actualDispatchAt)),
            },
        )

    ship_keys = {"courierName", "courierTrackingNo", "shippingNotes"}
    if ship_keys & data.keys():
        await log_production_activity(
            organization_id=ctx.organization_id,
            production_order_id=order_id,
            lead_id=row.leadId,
            user_id=ctx.membership.userId,
            activity_type=ProductionActivityType.SHIPMENT_UPDATED,
            body="Shipment details updated",
            metadata={
                "courier_name": data.get("courierName", row.courierName),
                "courier_tracking_no": data.get("courierTrackingNo", row.courierTrackingNo),
            },
        )

    return _serialize_order_for_role(updated, ctx)


@router.get("/orgs/{org_id}/production/{order_id}/activities")
async def list_order_activities(
    org_id: str, order_id: str, ctx: OrgContext = Depends(_OPS_ROLES)
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    acts = await prisma.productionactivity.find_many(
        where={"productionOrderId": order_id, "organizationId": ctx.organization_id},
        order={"createdAt": "desc"},
        include={"user": True},
        take=100,
    )
    return {"items": [_serialize_activity(a) for a in acts]}


class TrackingPatch(BaseModel):
    enabled: bool


@router.post("/orgs/{org_id}/production/{order_id}/tracking/regenerate")
async def regenerate_tracking_token(
    org_id: str, order_id: str, ctx: OrgContext = Depends(_OWNER_ONLY)
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    token = new_tracking_token()
    updated = await prisma.productionorder.update(
        where={"id": order_id},
        data={"trackingToken": token, "trackingEnabled": True},
        include={
            "lead": True,
            "quotation": True,
            "payments": True,
            "expectedPayments": True,
            "expenses": {"include": {"createdBy": True}},
        },
    )
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=row.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.NOTE_ADDED,
        body="Customer tracking link regenerated",
        metadata={"tracking_regenerated": True},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    return _serialize_order(updated)


@router.patch("/orgs/{org_id}/production/{order_id}/tracking")
async def patch_tracking(
    org_id: str,
    order_id: str,
    body: TrackingPatch,
    ctx: OrgContext = Depends(_OWNER_ONLY),
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    data: dict = {"trackingEnabled": body.enabled}
    if body.enabled and not row.trackingToken:
        data["trackingToken"] = new_tracking_token()
    updated = await prisma.productionorder.update(
        where={"id": order_id},
        data=data,
        include={
            "lead": True,
            "quotation": True,
            "payments": True,
            "expectedPayments": True,
            "expenses": {"include": {"createdBy": True}},
        },
    )
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=row.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.NOTE_ADDED,
        body="Customer tracking enabled" if body.enabled else "Customer tracking disabled",
        metadata={"tracking_enabled": body.enabled},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    return _serialize_order(updated)


@router.delete("/orgs/{org_id}/production/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_production(
    org_id: str, order_id: str, ctx: OrgContext = Depends(_OWNER_ONLY)
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
    org_id: str, order_id: str, ctx: OrgContext = Depends(_OWNER_ONLY)
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
        include={
            "lead": True,
            "quotation": True,
            "payments": True,
            "expectedPayments": True,
            "expenses": True,
        },
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    return {
        "production_order_id": row.id,
        "lead_id": row.leadId,
        "lead_title": row.lead.title if row.lead else None,
        **compute_pnl(order=row),
    }


async def _apply_expected_fulfillment(
    *,
    organization_id: str,
    order,
    payment,
    expected_row,
    amount_cents: int,
    user_id: str,
) -> None:
    remaining = max(int(expected_row.remainingCents) - amount_cents, 0)
    if remaining == 0:
        await prisma.expectedpayment.update(
            where={"id": expected_row.id},
            data={"remainingCents": 0, "status": ExpectedPaymentStatus.FULFILLED},
        )
        body = f"Expected payment fulfilled: ₹{amount_cents / 100:,.2f}"
    else:
        await prisma.expectedpayment.update(
            where={"id": expected_row.id},
            data={
                "remainingCents": remaining,
                "status": ExpectedPaymentStatus.PARTIALLY_FULFILLED,
            },
        )
        body = (
            f"Partial payment against expected: ₹{amount_cents / 100:,.2f}; "
            f"₹{remaining / 100:,.2f} still promised"
        )
    await log_production_activity(
        organization_id=organization_id,
        production_order_id=order.id,
        lead_id=order.leadId,
        user_id=user_id,
        activity_type=ProductionActivityType.EXPECTED_PAYMENT_FULFILLED,
        body=body,
        metadata={
            "expected_payment_id": expected_row.id,
            "payment_id": payment.id,
            "amount_cents": amount_cents,
            "remaining_cents": remaining,
        },
    )


@router.post("/orgs/{org_id}/production/{order_id}/payments", status_code=status.HTTP_201_CREATED)
async def add_payment(
    org_id: str, order_id: str, body: PaymentCreate, ctx: OrgContext = Depends(_OWNER_ONLY)
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    try:
        method = normalize_payment_method(body.method)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    expected_row = None
    if body.expected_payment_id:
        expected_row = await prisma.expectedpayment.find_first(
            where={
                "id": body.expected_payment_id,
                "organizationId": ctx.organization_id,
                "productionOrderId": order_id,
            }
        )
        if not expected_row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expected payment not found")
        exp_status = _enum_name(expected_row.status)
        if exp_status in ("FULFILLED", "CANCELLED"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Expected payment is already {exp_status.lower()}",
            )

    recorded_at = body.recorded_at or datetime.now(timezone.utc)
    p = await prisma.payment.create(
        data={
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
            "amountCents": body.amount_cents,
            "status": body.status,
            "note": body.note,
            "method": method,
            "reference": (body.reference or "").strip() or None,
            "label": (body.label or "").strip() or None,
            "recordedAt": recorded_at,
            "expectedPaymentId": expected_row.id if expected_row else None,
        }
    )
    status_name = _enum_name(body.status)
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
            "method": method,
            "reference": (body.reference or "").strip() or None,
            "label": (body.label or "").strip() or None,
            "note": body.note,
            "expected_payment_id": expected_row.id if expected_row else None,
        },
    )
    if expected_row and status_name in ("PAID", "PARTIAL"):
        await _apply_expected_fulfillment(
            organization_id=ctx.organization_id,
            order=row,
            payment=p,
            expected_row=expected_row,
            amount_cents=body.amount_cents,
            user_id=ctx.membership.userId,
        )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    return serialize_payment(p)


@router.patch("/orgs/{org_id}/production/{order_id}/payments/{payment_id}")
async def update_payment(
    org_id: str,
    order_id: str,
    payment_id: str,
    body: PaymentUpdate,
    ctx: OrgContext = Depends(_OWNER_ONLY),
) -> dict:
    order = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    payment = await prisma.payment.find_first(
        where={
            "id": payment_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        }
    )
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Payment not found")

    data: dict = {}
    if body.amount_cents is not None:
        data["amountCents"] = body.amount_cents
    if body.status is not None:
        data["status"] = body.status
    if body.note is not None:
        data["note"] = body.note
    if body.method is not None:
        try:
            data["method"] = normalize_payment_method(body.method)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if body.reference is not None:
        data["reference"] = body.reference.strip() or None
    if body.label is not None:
        data["label"] = body.label.strip() or None
    if body.recorded_at is not None:
        data["recordedAt"] = body.recorded_at
    if not data:
        return serialize_payment(payment)

    updated = await prisma.payment.update(where={"id": payment_id}, data=data)
    amount = updated.amountCents / 100
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.PAYMENT_UPDATED,
        body=f"Payment of ₹{amount:,.2f} updated",
        metadata={"payment_id": payment_id, "changes": {k: str(v) for k, v in data.items()}},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    return serialize_payment(updated)


@router.delete(
    "/orgs/{org_id}/production/{order_id}/payments/{payment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_payment(
    org_id: str,
    order_id: str,
    payment_id: str,
    ctx: OrgContext = Depends(_OWNER_ONLY),
) -> None:
    order = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    payment = await prisma.payment.find_first(
        where={
            "id": payment_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        }
    )
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Payment not found")

    if payment.expectedPaymentId:
        expected = await prisma.expectedpayment.find_first(
            where={"id": payment.expectedPaymentId, "productionOrderId": order_id}
        )
        if expected and _enum_name(expected.status) != "CANCELLED":
            status_name = _enum_name(payment.status)
            restore = payment.amountCents if status_name in ("PAID", "PARTIAL") else 0
            if restore:
                new_remaining = min(expected.amountCents, expected.remainingCents + restore)
                new_status = (
                    ExpectedPaymentStatus.FULFILLED
                    if new_remaining <= 0
                    else (
                        ExpectedPaymentStatus.OPEN
                        if new_remaining >= expected.amountCents
                        else ExpectedPaymentStatus.PARTIALLY_FULFILLED
                    )
                )
                await prisma.expectedpayment.update(
                    where={"id": expected.id},
                    data={"remainingCents": new_remaining, "status": new_status},
                )

    amount = payment.amountCents / 100
    await prisma.payment.delete(where={"id": payment_id})
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.PAYMENT_DELETED,
        body=f"Payment of ₹{amount:,.2f} deleted",
        metadata={"payment_id": payment_id, "amount_cents": payment.amountCents},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )


@router.post(
    "/orgs/{org_id}/production/{order_id}/expected-payments",
    status_code=status.HTTP_201_CREATED,
)
async def add_expected_payment(
    org_id: str,
    order_id: str,
    body: ExpectedPaymentCreate,
    ctx: OrgContext = Depends(_OWNER_ONLY),
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    ep = await prisma.expectedpayment.create(
        data={
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
            "amountCents": body.amount_cents,
            "remainingCents": body.amount_cents,
            "expectedAt": body.expected_at,
            "note": body.note,
            "label": (body.label or "").strip() or None,
            "status": ExpectedPaymentStatus.OPEN,
        }
    )
    amount = body.amount_cents / 100
    when = (
        body.expected_at.date().isoformat()
        if body.expected_at is not None
        else "unscheduled"
    )
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=row.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.EXPECTED_PAYMENT_ADDED,
        body=f"Expected payment added: ₹{amount:,.2f} for {when}",
        metadata={
            "expected_payment_id": ep.id,
            "amount_cents": body.amount_cents,
            "expected_at": body.expected_at.isoformat() if body.expected_at else None,
            "note": body.note,
            "label": (body.label or "").strip() or None,
        },
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    return serialize_expected_payment(ep)


@router.patch("/orgs/{org_id}/production/{order_id}/expected-payments/{expected_id}")
async def update_expected_payment(
    org_id: str,
    order_id: str,
    expected_id: str,
    body: ExpectedPaymentUpdate,
    ctx: OrgContext = Depends(_OWNER_ONLY),
) -> dict:
    order = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    ep = await prisma.expectedpayment.find_first(
        where={
            "id": expected_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        }
    )
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expected payment not found")
    if _enum_name(ep.status) in ("FULFILLED", "CANCELLED"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot edit a {_enum_name(ep.status).lower()} expected payment",
        )

    data: dict = {}
    if body.amount_cents is not None:
        fulfilled = ep.amountCents - ep.remainingCents
        if body.amount_cents < fulfilled:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Amount cannot be less than already fulfilled amount",
            )
        data["amountCents"] = body.amount_cents
        data["remainingCents"] = body.amount_cents - fulfilled
        if data["remainingCents"] == 0:
            data["status"] = ExpectedPaymentStatus.FULFILLED
        elif fulfilled > 0:
            data["status"] = ExpectedPaymentStatus.PARTIALLY_FULFILLED
        else:
            data["status"] = ExpectedPaymentStatus.OPEN
    if body.clear_expected_at:
        data["expectedAt"] = None
    elif body.expected_at is not None:
        data["expectedAt"] = body.expected_at
    if body.note is not None:
        data["note"] = body.note
    if body.label is not None:
        data["label"] = body.label.strip() or None
    if not data:
        return serialize_expected_payment(ep)

    updated = await prisma.expectedpayment.update(where={"id": expected_id}, data=data)
    amount = updated.amountCents / 100
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.EXPECTED_PAYMENT_ADDED,
        body=f"Expected payment updated: ₹{amount:,.2f}",
        metadata={"expected_payment_id": expected_id, "changes": list(data.keys())},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    return serialize_expected_payment(updated)


@router.post("/orgs/{org_id}/production/{order_id}/expected-payments/{expected_id}/reschedule")
async def reschedule_expected_payment(
    org_id: str,
    order_id: str,
    expected_id: str,
    body: ExpectedPaymentReschedule,
    ctx: OrgContext = Depends(_OWNER_ONLY),
) -> dict:
    order = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    ep = await prisma.expectedpayment.find_first(
        where={
            "id": expected_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        }
    )
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expected payment not found")
    if _enum_name(ep.status) in ("FULFILLED", "CANCELLED"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot reschedule a {_enum_name(ep.status).lower()} expected payment",
        )

    old_at = ep.expectedAt
    if body.clear_expected_at:
        new_at = None
    elif body.expected_at is not None:
        new_at = body.expected_at
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Provide expected_at or clear_expected_at",
        )

    data: dict = {"expectedAt": new_at}
    if body.note is not None:
        data["note"] = body.note
    updated = await prisma.expectedpayment.update(where={"id": expected_id}, data=data)

    def _fmt(dt):
        if dt is None:
            return "unscheduled"
        return dt.date().isoformat() if hasattr(dt, "date") else str(dt)

    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.EXPECTED_PAYMENT_RESCHEDULED,
        body=f"Expected payment rescheduled from {_fmt(old_at)} → {_fmt(new_at)}",
        metadata={
            "expected_payment_id": expected_id,
            "from": old_at.isoformat() if old_at else None,
            "to": new_at.isoformat() if new_at else None,
        },
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    return serialize_expected_payment(updated)


@router.post("/orgs/{org_id}/production/{order_id}/expected-payments/{expected_id}/cancel")
async def cancel_expected_payment(
    org_id: str,
    order_id: str,
    expected_id: str,
    ctx: OrgContext = Depends(_OWNER_ONLY),
) -> dict:
    order = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    ep = await prisma.expectedpayment.find_first(
        where={
            "id": expected_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        }
    )
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expected payment not found")
    if _enum_name(ep.status) == "CANCELLED":
        return serialize_expected_payment(ep)
    if _enum_name(ep.status) == "FULFILLED":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Cannot cancel a fulfilled expected payment"
        )

    updated = await prisma.expectedpayment.update(
        where={"id": expected_id},
        data={
            "status": ExpectedPaymentStatus.CANCELLED,
            "cancelledAt": datetime.now(timezone.utc),
        },
    )
    amount = ep.remainingCents / 100
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.EXPECTED_PAYMENT_CANCELLED,
        body=f"Expected payment cancelled: ₹{amount:,.2f}",
        metadata={"expected_payment_id": expected_id, "amount_cents": ep.remainingCents},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_PRODUCTION,
        entity_id=order_id,
    )
    return serialize_expected_payment(updated)


@router.post("/orgs/{org_id}/production/{order_id}/expenses", status_code=status.HTTP_201_CREATED)
async def add_production_expense(
    org_id: str, order_id: str, body: NestedExpenseCreate, ctx: OrgContext = Depends(_OWNER_ONLY)
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
