from datetime import datetime, timezone

from prisma import Prisma
from prisma.enums import CallOutcome, LeadActivityType, LeadStage

from loomrun_api.prisma_client import prisma as default_prisma
from loomrun_api.prisma_json import json_meta


def enum_str(val) -> str:
    return val.name if hasattr(val, "name") else str(val)


async def sync_lead_after_call(
    *,
    lead_id: str,
    user_id: str | None,
    outcome: CallOutcome,
    notes: str | None,
    attempt: int,
    lead_stage: LeadStage,
    logged_by: str | None = None,
    db: Prisma | None = None,
) -> LeadStage:
    """Record call activity and move NEW leads to CONTACTED (persisted on the lead)."""
    client = db or default_prisma
    now = datetime.now(timezone.utc)
    outcome_name = enum_str(outcome)

    call_body = f"Call attempt {attempt}: {outcome_name}"
    if notes:
        call_body += f" — {notes}"
    if logged_by:
        call_body += f" (logged by {logged_by})"

    await client.leadactivity.create(
        data={
            "leadId": lead_id,
            "userId": user_id,
            "type": LeadActivityType.CALL,
            "body": call_body,
        }
    )

    if lead_stage == LeadStage.NEW:
        stage_note = outcome_name + (f" — {notes}" if notes else "")
        by_suffix = f" (logged by {logged_by})" if logged_by else ""
        await client.lead.update(
            where={"id": lead_id},
            data={"stage": LeadStage.CONTACTED, "lastActivityAt": now},
        )
        await client.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.STAGE_CHANGE,
                "body": f"Moved to Contacted — {stage_note}{by_suffix}",
                "metadata": json_meta(
                    {
                        "stage": "CONTACTED",
                        "outcome": outcome_name,
                        "logged_by": logged_by,
                    }
                ),
            },
        )
        return LeadStage.CONTACTED

    await client.lead.update(
        where={"id": lead_id},
        data={"lastActivityAt": now},
    )
    return lead_stage
