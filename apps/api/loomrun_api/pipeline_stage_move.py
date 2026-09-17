"""Move a lead to a pipeline stage identified by systemKey (NEW, CONTACTED, …)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loomrun_api.pipeline_routing import (
    get_default_pipeline,
    lead_status_for_kind,
    legacy_stage_from_pipeline_stage,
    stage_for_system_key,
)
from loomrun_api.prisma_json import json_meta
from prisma.enums import LeadActivityType, LeadStage


def _enum_name(value: Any) -> str:
    return value.name if hasattr(value, "name") else str(value)


async def advance_lead_by_system_key(
    *,
    db,
    lead,
    system_key: str | LeadStage,
    user_id: str | None,
    body: str,
    metadata: dict | None = None,
    only_if_earlier: bool = False,
    force: bool = False,
) -> LeadStage:
    """Set lead.pipelineStageId (+ synced Lead.stage) for system_key in the lead's pipeline.

    When force=False (default), leads already in a WON/LOST stage are left unchanged.
    When force=True, allow reopen (e.g. LOST → WON on order placed); still no-ops if
    already on the target stage.
    """
    key = _enum_name(system_key)
    now = datetime.now(timezone.utc)

    pipeline = None
    if getattr(lead, "pipelineId", None):
        pipeline = await db.pipeline.find_unique(
            where={"id": lead.pipelineId},
            include={"stages": {"order_by": {"sortOrder": "asc"}}},
        )
    if pipeline is None:
        pipeline = await get_default_pipeline(lead.organizationId)

    target = stage_for_system_key(pipeline, key)
    if target is None:
        if key in LeadStage.__members__:
            await db.lead.update(
                where={"id": lead.id},
                data={"stage": LeadStage[key], "lastActivityAt": now},
            )
            await db.leadactivity.create(
                data={
                    "leadId": lead.id,
                    "userId": user_id,
                    "type": LeadActivityType.STAGE_CHANGE,
                    "body": body,
                    "metadata": json_meta({"stage": key, **(metadata or {})}),
                }
            )
            return LeadStage[key]
        return lead.stage if hasattr(lead.stage, "name") else LeadStage.NEW

    current = None
    if getattr(lead, "pipelineStageId", None):
        current = next((s for s in (pipeline.stages or []) if s.id == lead.pipelineStageId), None)

    if current and _enum_name(current.kind) in ("WON", "LOST"):
        # Already on the requested terminal stage → no-op.
        if _enum_name(current.kind) == key:
            await db.lead.update(where={"id": lead.id}, data={"lastActivityAt": now})
            return legacy_stage_from_pipeline_stage(current)
        if not force:
            await db.lead.update(where={"id": lead.id}, data={"lastActivityAt": now})
            return legacy_stage_from_pipeline_stage(current)

    if only_if_earlier and current is not None and current.sortOrder >= target.sortOrder:
        await db.lead.update(where={"id": lead.id}, data={"lastActivityAt": now})
        return legacy_stage_from_pipeline_stage(current)

    if current and current.id == target.id:
        await db.lead.update(where={"id": lead.id}, data={"lastActivityAt": now})
        return legacy_stage_from_pipeline_stage(target)

    data: dict[str, Any] = {
        "pipelineId": pipeline.id,
        "pipelineStageId": target.id,
        "stage": legacy_stage_from_pipeline_stage(target),
        "lastActivityAt": now,
    }
    status_val = lead_status_for_kind(target.kind)
    if status_val is not None:
        data["leadStatus"] = status_val

    old_pipeline_id = getattr(lead, "pipelineId", None)
    old_stage_id = getattr(lead, "pipelineStageId", None)

    await db.lead.update(where={"id": lead.id}, data=data)
    await db.leadactivity.create(
        data={
            "leadId": lead.id,
            "userId": user_id,
            "type": LeadActivityType.STAGE_CHANGE,
            "body": body,
            "metadata": json_meta(
                {
                    "stage": key,
                    "from_pipeline_id": old_pipeline_id,
                    "from_pipeline_stage_id": old_stage_id,
                    "to_pipeline_id": pipeline.id,
                    "to_pipeline_stage_id": target.id,
                    "pipeline_stage_id": target.id,
                    "pipeline_id": pipeline.id,
                    **(metadata or {}),
                }
            ),
        }
    )
    return legacy_stage_from_pipeline_stage(target)


async def mark_lead_won_on_order_placed(
    *,
    db,
    lead,
    user_id: str | None,
    order_number: str,
) -> LeadStage:
    """Push lead to Won on the Sales kanban when an order is placed (no-op if already Won)."""
    current_name = _enum_name(getattr(lead, "stage", None) or "NEW")
    if current_name == "WON":
        return LeadStage.WON

    return await advance_lead_by_system_key(
        db=db,
        lead=lead,
        system_key="WON",
        user_id=user_id,
        body=f"Moved to Won — order {order_number} placed",
        metadata={"reason": "order_placed", "order_number": order_number},
        force=True,
    )
