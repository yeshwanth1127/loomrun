from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from prisma.enums import CallOutcome, LeadActivityType, LeadStage

router = APIRouter()


def _enum_str(val) -> str:
    return val.name if hasattr(val, "name") else str(val)


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
        }
    )
    call_body = f"Call attempt {attempt}: {body.outcome.name}"
    if body.notes:
        call_body += f" — {body.notes}"
    await prisma.leadactivity.create(
        data={
            "leadId": body.lead_id,
            "userId": ctx.membership.userId,
            "type": LeadActivityType.CALL,
            "body": call_body,
        }
    )

    if lead.stage == LeadStage.NEW:
        await prisma.lead.update(
            where={"id": body.lead_id},
            data={"stage": LeadStage.CONTACTED, "lastActivityAt": datetime.utcnow()},
        )
        stage_note = body.outcome.name + (f" — {body.notes}" if body.notes else "")
        await prisma.leadactivity.create(
            data={
                "leadId": body.lead_id,
                "userId": ctx.membership.userId,
                "type": LeadActivityType.STAGE_CHANGE,
                "body": f"Moved to Contacted — {stage_note}",
            }
        )

    return {
        "id": row.id,
        "attempt_number": row.attemptNumber,
        "outcome": _enum_str(row.outcome),
        "created_at": row.createdAt.isoformat(),
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
        "user_email": call.user.email if call.user else None,
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
    day: str | None = Query(None, description="YYYY-MM-DD in UTC; default today"),
    user_id: str | None = Query(None, description="Filter by user ID"),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    if day:
        try:
            start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid day format") from e
    else:
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    where: dict = {
        "organizationId": ctx.organization_id,
        "createdAt": {"gte": start, "lt": end},
    }
    if user_id:
        where["userId"] = user_id
    calls = await prisma.telecallercalllog.find_many(
        where=where,
        include={"user": True, "lead": True},
    )
    by_outcome: dict[str, int] = {}
    for c in calls:
        name = _enum_str(c.outcome)
        by_outcome[name] = by_outcome.get(name, 0) + 1
    return {
        "date": start.date().isoformat(),
        "total_calls": len(calls),
        "by_outcome": by_outcome,
        "calls": [
            {
                "id": c.id,
                "lead_title": c.lead.title if c.lead else None,
                "user_email": c.user.email if c.user else None,
                "outcome": _enum_str(c.outcome),
                "created_at": c.createdAt.isoformat(),
            }
            for c in calls
        ],
    }
