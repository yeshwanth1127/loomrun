from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from loomrun_api.date_filter import apply_created_at, day_label, parse_day_param
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.lead_call_sync import enum_str, sync_lead_after_call
from loomrun_api.prisma_client import prisma
from prisma.enums import CallOutcome

router = APIRouter()


def _enum_str(val) -> str:
    return val.name if hasattr(val, "name") else str(val)


def _caller_fields(user) -> dict:
    if not user:
        return {"user_email": None, "user_name": None, "logged_by": None}
    name = user.name.strip() if user.name else None
    return {
        "user_email": user.email,
        "user_name": name,
        "logged_by": name or user.email,
    }


class CallLogCreate(BaseModel):
    lead_id: str
    outcome: CallOutcome
    notes: str | None = None
    duration_seconds: int | None = None
    next_call_at: datetime | None = None


@router.post("/orgs/{org_id}/telecaller/calls", status_code=status.HTTP_201_CREATED)
async def log_call(
    org_id: str,
    body: CallLogCreate,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    lead = await prisma.lead.find_first(where={"id": body.lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    prev = await prisma.telecallercalllog.count(where={"leadId": body.lead_id})
    attempt = prev + 1
    row = await prisma.telecallercalllog.create(
        data={
            "organizationId": ctx.organization_id,
            "leadId": body.lead_id,
            "userId": ctx.membership.userId,
            "attemptNumber": attempt,
            "outcome": body.outcome,
            "notes": body.notes,
            "durationSeconds": body.duration_seconds,
            "nextCallAt": body.next_call_at,
            "callSource": "HUMAN",
        },
        include={"user": True},
    )
    caller = _caller_fields(row.user)
    new_stage = await sync_lead_after_call(
        lead_id=body.lead_id,
        user_id=ctx.membership.userId,
        outcome=body.outcome,
        notes=body.notes,
        attempt=attempt,
        lead_stage=lead.stage,
        logged_by=caller["logged_by"],
    )

    return {
        "id": row.id,
        "lead_id": body.lead_id,
        "attempt_number": row.attemptNumber,
        "outcome": _enum_str(row.outcome),
        "created_at": row.createdAt.isoformat(),
        "lead_stage": enum_str(new_stage),
        "stage_changed": new_stage != lead.stage,
        **caller,
    }


@router.get("/orgs/{org_id}/telecaller/calls/{call_id}")
async def get_call(
    org_id: str,
    call_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    call = await prisma.telecallercalllog.find_first(
        where={"id": call_id, "organizationId": ctx.organization_id},
        include={"user": True, "lead": True},
    )
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Call not found")
    return {
        "id": call.id,
        "lead_title": call.lead.title if call.lead else None,
        **_caller_fields(call.user),
        "outcome": _enum_str(call.outcome),
        "notes": call.notes,
        "duration_seconds": call.durationSeconds,
        "call_source": call.callSource,
        "attempt_number": call.attemptNumber,
        "recording_url": call.recordingUrl,
        "transcript_raw": call.transcriptRaw,
        "ai_summary": call.aiSummary,
        "created_at": call.createdAt.isoformat(),
        "next_call_at": call.nextCallAt.isoformat() if call.nextCallAt else None,
    }


@router.get("/orgs/{org_id}/telecaller/daily-summary")
async def telecaller_daily_summary(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD in UTC, or all for all time"),
    user_id: str | None = Query(None, description="Filter by user ID"),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    apply_created_at(where, day)
    if user_id:
        where["userId"] = user_id
    calls = await prisma.telecallercalllog.find_many(
        where=where,
        include={"user": True, "lead": True},
        order={"createdAt": "desc"},
    )
    by_outcome: dict[str, int] = {}
    for c in calls:
        name = _enum_str(c.outcome)
        by_outcome[name] = by_outcome.get(name, 0) + 1
    return {
        "date": day_label(day),
        "total_calls": len(calls),
        "by_outcome": by_outcome,
        "calls": [
            {
                "id": c.id,
                "lead_title": c.lead.title if c.lead else None,
                **_caller_fields(c.user),
                "outcome": _enum_str(c.outcome),
                "created_at": c.createdAt.isoformat(),
            }
            for c in calls
        ],
    }
