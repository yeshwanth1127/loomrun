from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from prisma.enums import LeadActivityType, LeadSource, LeadStage

router = APIRouter()


class LeadCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    source: LeadSource = LeadSource.OTHER
    stage: LeadStage = LeadStage.NEW
    company: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None
    assignee_id: str | None = None
    next_follow_up_at: datetime | None = None
    estimated_value: float | None = None


class LeadUpdate(BaseModel):
    title: str | None = None
    source: LeadSource | None = None
    stage: LeadStage | None = None
    company: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None
    assignee_id: str | None = None
    next_follow_up_at: datetime | None = None
    estimated_value: float | None = None


class ActivityCreate(BaseModel):
    type: LeadActivityType = LeadActivityType.NOTE
    body: str = Field(min_length=1)
    metadata: dict | None = None


def _serialize_lead(lead) -> dict:
    return {
        "id": lead.id,
        "organization_id": lead.organizationId,
        "source": lead.source.name if hasattr(lead.source, "name") else str(lead.source),
        "stage": lead.stage.name if hasattr(lead.stage, "name") else str(lead.stage),
        "title": lead.title,
        "company": lead.company,
        "phone": lead.phone,
        "email": lead.email,
        "notes": lead.notes,
        "assignee_id": lead.assigneeId,
        "next_follow_up_at": lead.nextFollowUpAt.isoformat() if lead.nextFollowUpAt else None,
        "estimated_value": float(lead.estimatedValue) if lead.estimatedValue is not None else None,
        "created_at": lead.createdAt.isoformat(),
        "updated_at": lead.updatedAt.isoformat(),
    }


@router.get("/orgs/{org_id}/leads")
async def list_leads(
    org_id: str,
    stage: LeadStage | None = Query(None),
    assignee_id: str | None = Query(None),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    if stage is not None:
        where["stage"] = stage
    if assignee_id is not None:
        where["assigneeId"] = assignee_id
    leads = await prisma.lead.find_many(where=where, order={"updatedAt": "desc"})
    return {"items": [_serialize_lead(lead) for lead in leads]}


@router.post("/orgs/{org_id}/leads", status_code=status.HTTP_201_CREATED)
async def create_lead(org_id: str, body: LeadCreate, ctx: OrgContext = Depends(get_org_context)) -> dict:
    data = {
        "organizationId": ctx.organization_id,
        "title": body.title,
        "source": body.source,
        "stage": body.stage,
        "company": body.company,
        "phone": body.phone,
        "email": body.email,
        "notes": body.notes,
        "assigneeId": body.assignee_id,
        "nextFollowUpAt": body.next_follow_up_at,
    }
    if body.estimated_value is not None:
        data["estimatedValue"] = body.estimated_value
    lead = await prisma.lead.create(data=data)
    await prisma.leadactivity.create(
        data={
            "leadId": lead.id,
            "userId": ctx.membership.userId,
            "type": LeadActivityType.SYSTEM,
            "body": "Lead created",
        }
    )
    return _serialize_lead(lead)


@router.get("/orgs/{org_id}/leads/{lead_id}")
async def get_lead(org_id: str, lead_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    lead = await prisma.lead.find_first(
        where={"id": lead_id, "organizationId": ctx.organization_id},
        include={"activities": {"order_by": {"createdAt": "desc"}, "take": 100}},
    )
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    activities = [
        {
            "id": a.id,
            "type": a.type.name if hasattr(a.type, "name") else str(a.type),
            "body": a.body,
            "user_id": a.userId,
            "metadata": a.metadata,
            "created_at": a.createdAt.isoformat(),
        }
        for a in (lead.activities or [])
    ]
    return {**_serialize_lead(lead), "activities": activities}


@router.patch("/orgs/{org_id}/leads/{lead_id}")
async def update_lead(
    org_id: str, lead_id: str, body: LeadUpdate, ctx: OrgContext = Depends(get_org_context)
) -> dict:
    lead = await prisma.lead.find_first(where={"id": lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    update_data: dict = {}
    if body.title is not None:
        update_data["title"] = body.title
    if body.source is not None:
        update_data["source"] = body.source
    if body.stage is not None:
        update_data["stage"] = body.stage
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": ctx.membership.userId,
                "type": LeadActivityType.STAGE_CHANGE,
                "body": f"Stage set to {body.stage.name}",
                "metadata": {"stage": body.stage.name},
            }
        )
    if body.company is not None:
        update_data["company"] = body.company
    if body.phone is not None:
        update_data["phone"] = body.phone
    if body.email is not None:
        update_data["email"] = body.email
    if body.notes is not None:
        update_data["notes"] = body.notes
    if body.assignee_id is not None:
        update_data["assigneeId"] = body.assignee_id
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": ctx.membership.userId,
                "type": LeadActivityType.ASSIGNMENT,
                "body": "Assignee updated",
                "metadata": {"assignee_id": body.assignee_id},
            }
        )
    if body.next_follow_up_at is not None:
        update_data["nextFollowUpAt"] = body.next_follow_up_at
    if body.estimated_value is not None:
        update_data["estimatedValue"] = body.estimated_value
    if not update_data:
        return _serialize_lead(lead)
    updated = await prisma.lead.update(where={"id": lead_id}, data=update_data)
    return _serialize_lead(updated)


@router.delete("/orgs/{org_id}/leads/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(org_id: str, lead_id: str, ctx: OrgContext = Depends(get_org_context)) -> None:
    lead = await prisma.lead.find_first(where={"id": lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await prisma.lead.delete(where={"id": lead_id})


@router.post("/orgs/{org_id}/leads/{lead_id}/activities", status_code=status.HTTP_201_CREATED)
async def add_activity(
    org_id: str, lead_id: str, body: ActivityCreate, ctx: OrgContext = Depends(get_org_context)
) -> dict:
    lead = await prisma.lead.find_first(where={"id": lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    act = await prisma.leadactivity.create(
        data={
            "leadId": lead_id,
            "userId": ctx.membership.userId,
            "type": body.type,
            "body": body.body,
            "metadata": body.metadata,
        }
    )
    return {
        "id": act.id,
        "type": act.type.name if hasattr(act.type, "name") else str(act.type),
        "body": act.body,
        "created_at": act.createdAt.isoformat(),
    }
