from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from prisma.enums import CallOutcome, LeadActivityType

router = APIRouter()


class CallLogCreate(BaseModel):
    lead_id: str
    outcome: CallOutcome
    notes: str | None = None
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
            "nextCallAt": body.next_call_at,
        }
    )
    await prisma.leadactivity.create(
        data={
            "leadId": body.lead_id,
            "userId": ctx.membership.userId,
            "type": LeadActivityType.CALL,
            "body": f"Call attempt {attempt}: {body.outcome.name}",
            "metadata": {"outcome": body.outcome.name, "notes": body.notes},
        }
    )
    return {
        "id": row.id,
        "attempt_number": row.attemptNumber,
        "outcome": row.outcome.name,
        "created_at": row.createdAt.isoformat(),
    }


@router.get("/orgs/{org_id}/telecaller/daily-summary")
async def telecaller_daily_summary(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD in UTC; default today"),
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
    calls = await prisma.telecallercalllog.find_many(
        where={
            "organizationId": ctx.organization_id,
            "createdAt": {"gte": start, "lt": end},
        },
        include={"user": True, "lead": True},
    )
    by_outcome: dict[str, int] = {}
    for c in calls:
        name = c.outcome.name if hasattr(c.outcome, "name") else str(c.outcome)
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
                "outcome": c.outcome.name if hasattr(c.outcome, "name") else str(c.outcome),
                "created_at": c.createdAt.isoformat(),
            }
            for c in calls
        ],
    }
