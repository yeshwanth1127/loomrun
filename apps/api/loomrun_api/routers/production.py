from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from prisma.enums import PaymentStatus, ProductionStage

router = APIRouter()


class ProductionCreate(BaseModel):
    lead_id: str
    quotation_id: str | None = None


class ProductionStageUpdate(BaseModel):
    stage: ProductionStage
    delay_flag: bool | None = None


class PaymentCreate(BaseModel):
    amount_cents: int = Field(gt=0)
    status: PaymentStatus = PaymentStatus.PAID
    note: str | None = None


@router.get("/orgs/{org_id}/production")
async def list_production(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    rows = await prisma.productionorder.find_many(
        where={"organizationId": ctx.organization_id},
        order={"updatedAt": "desc"},
        include={"lead": True, "quotation": True, "payments": True},
    )
    return {
        "items": [
            {
                "id": r.id,
                "lead_id": r.leadId,
                "quotation_id": r.quotationId,
                "stage": r.stage.name if hasattr(r.stage, "name") else str(r.stage),
                "delay_flag": r.delayFlag,
                "stage_entered_at": r.stageEnteredAt.isoformat(),
                "lead_title": r.lead.title if r.lead else None,
                "payments": [
                    {"id": p.id, "amount_cents": p.amountCents, "status": p.status.name} for p in (r.payments or [])
                ],
            }
            for r in rows
        ]
    }


@router.post("/orgs/{org_id}/production", status_code=status.HTTP_201_CREATED)
async def create_production(org_id: str, body: ProductionCreate, ctx: OrgContext = Depends(get_org_context)) -> dict:
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
    row = await prisma.productionorder.create(
        data={
            "organizationId": ctx.organization_id,
            "leadId": body.lead_id,
            "quotationId": body.quotation_id,
            "stage": ProductionStage.FABRIC_CHECK,
            "stageEnteredAt": datetime.now(timezone.utc),
        },
    )
    return {
        "id": row.id,
        "lead_id": row.leadId,
        "stage": row.stage.name if hasattr(row.stage, "name") else str(row.stage),
    }


@router.patch("/orgs/{org_id}/production/{order_id}")
async def update_production_stage(
    org_id: str, order_id: str, body: ProductionStageUpdate, ctx: OrgContext = Depends(get_org_context)
) -> dict:
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    data: dict = {"stage": body.stage, "stageEnteredAt": datetime.now(timezone.utc)}
    if body.delay_flag is not None:
        data["delayFlag"] = body.delay_flag
    updated = await prisma.productionorder.update(where={"id": order_id}, data=data)
    return {
        "id": updated.id,
        "stage": updated.stage.name if hasattr(updated.stage, "name") else str(updated.stage),
        "delay_flag": updated.delayFlag,
    }


@router.post("/orgs/{org_id}/production/{order_id}/payments", status_code=status.HTTP_201_CREATED)
async def add_payment(
    org_id: str, order_id: str, body: PaymentCreate, ctx: OrgContext = Depends(get_org_context)
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
    return {"id": p.id, "amount_cents": p.amountCents, "status": p.status.name}
