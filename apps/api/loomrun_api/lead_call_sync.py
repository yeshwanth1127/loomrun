from datetime import datetime, timezone

from prisma import Prisma
from prisma.enums import CallOutcome, LeadActivityType, LeadStage

from loomrun_api.call_outcomes import outcome_label, stage_key_for_outcome
from loomrun_api.pipeline_stage_move import advance_lead_by_system_key
from loomrun_api.prisma_client import prisma as default_prisma
from loomrun_api.prisma_json import json_meta


def enum_str(val) -> str:
    return val.name if hasattr(val, "name") else str(val)


# Closed / won / lost keys — always apply even if the lead is already past NEW.
_FORCE_STAGE_KEYS = frozenset({"WON", "LOST", "SAMPLE", "QUALIFICATION", "NEGOTIATION", "QUOTATION"})


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
    """Record call activity and advance LeadStage when the outcome implies it.

    Activity-only statuses (WhatsApp Sent, Email Sent, Busy, …) never move the
    pipeline. Deal Won / Deal Lost / Sample / Meeting statuses do.
    NEW leads still move to CONTACTED on any logged call when no stronger
    stage mapping applies.
    """
    client = db or default_prisma
    now = datetime.now(timezone.utc)
    outcome_name = enum_str(outcome)
    label = outcome_label(outcome)

    call_body = f"Call attempt {attempt}: {label}"
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
            "metadata": json_meta({"outcome": outcome_name, "attempt": attempt}),
        }
    )

    lead = await client.lead.find_unique(where={"id": lead_id})
    if not lead:
        return lead_stage

    current_stage = lead.stage if hasattr(lead.stage, "name") else lead_stage
    current_name = enum_str(current_stage)
    target_key = stage_key_for_outcome(outcome)

    # Explicit stage posted on the telecaller form already applied — respect it
    # unless the outcome maps to a stronger closed/won/lost/sample key.
    stage_note = label + (f" — {notes}" if notes else "")
    by_suffix = f" (logged by {logged_by})" if logged_by else ""

    if target_key and (target_key in _FORCE_STAGE_KEYS or current_name == "NEW"):
        if current_name != target_key:
            return await advance_lead_by_system_key(
                db=client,
                lead=lead,
                system_key=target_key,
                user_id=user_id,
                body=f"Moved to {target_key.replace('_', ' ').title()} — {stage_note}{by_suffix}",
                metadata={"outcome": outcome_name, "logged_by": logged_by},
            )

    if current_name == "NEW":
        # Any call on a brand-new lead at least moves them to Contacted.
        return await advance_lead_by_system_key(
            db=client,
            lead=lead,
            system_key="CONTACTED",
            user_id=user_id,
            body=f"Moved to Contacted — {stage_note}{by_suffix}",
            metadata={"outcome": outcome_name, "logged_by": logged_by},
        )

    await client.lead.update(
        where={"id": lead_id},
        data={"lastActivityAt": now},
    )
    return current_stage if isinstance(current_stage, LeadStage) else lead_stage
