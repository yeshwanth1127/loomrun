"""Call logging shared by HTTP routers and the AI agent.

Reuses `sync_lead_after_call`, the same routine the Telecaller screen uses, so a
call the agent logs advances the lead's stage and follow-up state exactly as a
human-logged one does. Without that the two would record calls that look alike
but leave the pipeline in different states.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException, status

from loomrun_api.lead_call_sync import sync_lead_after_call
from loomrun_api.prisma_client import prisma
from loomrun_api.services.leads import resolve_lead
from loomrun_api.call_outcomes import TELECALLER_OUTCOMES
from prisma.enums import CallOutcome

OUTCOMES = [o.name for o in CallOutcome]
TELECALLER_OUTCOME_VALUES = [value for value, _label in TELECALLER_OUTCOMES]


def _enum_name(value: Any) -> str:
    return value.name if hasattr(value, "name") else str(value)


async def log_call(
    *,
    organization_id: str,
    user_id: str,
    lead_id: str,
    outcome: str,
    notes: str | None = None,
    duration_seconds: int | None = None,
    next_call_at: datetime | None = None,
) -> dict[str, Any]:
    """Record a call against a lead and advance the lead the way the UI does."""
    key = str(outcome or "").strip().upper()
    if key not in OUTCOMES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown outcome '{outcome}'. Valid outcomes: {', '.join(OUTCOMES)}",
        )
    lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)

    if key == "CALLBACK_SCHEDULED" and next_call_at is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="next_call_at is required when outcome is CALLBACK_SCHEDULED",
        )

    attempt = await prisma.telecallercalllog.count(where={"leadId": lead.id}) + 1
    row = await prisma.telecallercalllog.create(
        data={
            "organizationId": organization_id,
            "leadId": lead.id,
            "userId": user_id,
            "attemptNumber": attempt,
            "outcome": CallOutcome[key],
            "notes": notes,
            "durationSeconds": duration_seconds,
            "nextCallAt": next_call_at,
            "callSource": "HUMAN",
        },
        include={"user": True},
    )
    logged_by = None
    if row.user:
        logged_by = (row.user.name.strip() if row.user.name else None) or row.user.email

    lead_update: dict[str, Any] = {}
    if next_call_at is not None:
        lead_update["nextFollowUpAt"] = next_call_at
        lead_update["followUpRemindedAt"] = None
        lead_update["followUpWaRemindedAt"] = None
    elif key != "CALLBACK_SCHEDULED":
        lead_update["nextFollowUpAt"] = None
        lead_update["followUpRemindedAt"] = None
        lead_update["followUpWaRemindedAt"] = None
    if lead_update:
        await prisma.lead.update(where={"id": lead.id}, data=lead_update)

    new_stage = await sync_lead_after_call(
        lead_id=lead.id,
        user_id=user_id,
        outcome=CallOutcome[key],
        notes=notes,
        attempt=attempt,
        lead_stage=lead.stage,
        logged_by=logged_by,
    )
    return {
        "id": row.id,
        "lead_id": lead.id,
        "lead_title": lead.title,
        "attempt_number": row.attemptNumber,
        "outcome": _enum_name(row.outcome),
        "created_at": row.createdAt.isoformat(),
        "lead_stage": _enum_name(new_stage),
        "stage_changed": _enum_name(new_stage) != _enum_name(lead.stage),
        "counts_as_follow_up": key == "CALLBACK_SCHEDULED",
    }


async def list_calls(
    *, organization_id: str, lead_id: str | None = None, limit: int = 30
) -> dict[str, Any]:
    where: dict[str, Any] = {"organizationId": organization_id}
    if lead_id:
        lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
        where["leadId"] = lead.id
    total = await prisma.telecallercalllog.count(where=where)
    rows = await prisma.telecallercalllog.find_many(
        where=where,
        order={"createdAt": "desc"},
        take=max(1, min(int(limit or 30), 100)),
        include={"lead": True, "user": True},
    )
    return {
        "items": [
            {
                "id": r.id,
                "lead_id": r.leadId,
                "lead_title": r.lead.title if r.lead else None,
                "outcome": _enum_name(r.outcome),
                "attempt_number": r.attemptNumber,
                "notes": r.notes,
                "duration_seconds": r.durationSeconds,
                "next_call_at": r.nextCallAt.isoformat() if r.nextCallAt else None,
                "logged_by": (r.user.name or r.user.email) if r.user else None,
                "created_at": r.createdAt.isoformat(),
            }
            for r in rows
        ],
        "count": len(rows),
        "total": total,
        "outcomes": OUTCOMES,
        "telecaller_outcomes": [
            {"value": value, "label": label} for value, label in TELECALLER_OUTCOMES
        ],
    }
