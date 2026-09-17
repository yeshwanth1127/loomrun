"""Resolve which pipeline a lead belongs to from routing rules.

Auto-routing runs only for new/unassigned leads (create, CSV, connectors).
Assigned leads are never silently moved when attributes change.
"""

from __future__ import annotations

from typing import Any

from loomrun_api.pipeline_defaults import DEFAULT_PIPELINE_NAME, DEFAULT_STAGES
from loomrun_api.prisma_client import prisma
from prisma.enums import LeadSource, LeadStage, LeadStatus, PipelineStageKind, PipelineType


def _enum_name(value: Any) -> str | None:
    if value is None:
        return None
    return value.name if hasattr(value, "name") else str(value)


def _norm(value: str | None) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split()).strip()
    return text or None


def _norm_ci(value: str | None) -> str | None:
    text = _norm(value)
    return text.casefold() if text else None


async def ensure_default_pipeline(organization_id: str):
    """Create the default Sales pipeline + stages if the org has none."""
    existing = await prisma.pipeline.find_first(
        where={"organizationId": organization_id, "isDefault": True},
        include={"stages": {"order_by": {"sortOrder": "asc"}}},
    )
    if existing:
        return existing

    any_pipeline = await prisma.pipeline.find_first(
        where={"organizationId": organization_id, "isActive": True},
        include={"stages": {"order_by": {"sortOrder": "asc"}}},
        order={"createdAt": "asc"},
    )
    if any_pipeline:
        async with prisma.tx() as tx:
            await tx.pipeline.update_many(
                where={"organizationId": organization_id, "isDefault": True},
                data={"isDefault": False},
            )
            await tx.pipeline.update(
                where={"id": any_pipeline.id},
                data={"isDefault": True, "isActive": True},
            )
        return await prisma.pipeline.find_unique(
            where={"id": any_pipeline.id},
            include={"stages": {"order_by": {"sortOrder": "asc"}}},
        )

    pipeline = await prisma.pipeline.create(
        data={
            "organizationId": organization_id,
            "name": DEFAULT_PIPELINE_NAME,
            "type": PipelineType.GENERAL,
            "isDefault": True,
            "isActive": True,
            "sortOrder": 0,
            "stages": {
                "create": [
                    {
                        "name": name,
                        "slug": slug,
                        "sortOrder": order,
                        "kind": PipelineStageKind[kind],
                        "probability": prob,
                        "systemKey": system_key,
                    }
                    for name, slug, order, kind, prob, system_key in DEFAULT_STAGES
                ]
            },
        },
        include={"stages": {"order_by": {"sortOrder": "asc"}}},
    )
    return pipeline


async def get_default_pipeline(organization_id: str):
    pipeline = await prisma.pipeline.find_first(
        where={"organizationId": organization_id, "isDefault": True, "isActive": True},
        include={"stages": {"order_by": {"sortOrder": "asc"}}},
    )
    if pipeline:
        return pipeline
    return await ensure_default_pipeline(organization_id)


def entry_stage(pipeline) -> Any | None:
    stages = list(pipeline.stages or [])
    open_stages = [s for s in stages if _enum_name(s.kind) == "OPEN"]
    if open_stages:
        return min(open_stages, key=lambda s: s.sortOrder)
    return min(stages, key=lambda s: s.sortOrder) if stages else None


def stage_for_system_key(pipeline, system_key: str | LeadStage | None):
    if system_key is None:
        return None
    key = _enum_name(system_key) or str(system_key)
    for stage in pipeline.stages or []:
        if stage.systemKey == key:
            return stage
    return None


def lead_status_for_kind(kind: PipelineStageKind | str | None) -> LeadStatus | None:
    name = _enum_name(kind)
    if name == "WON":
        return LeadStatus.WON
    if name == "LOST":
        return LeadStatus.LOST
    if name == "OPEN":
        return LeadStatus.ACTIVE
    return None


def legacy_stage_from_pipeline_stage(stage) -> LeadStage:
    key = stage.systemKey if stage else None
    if key and key in LeadStage.__members__:
        return LeadStage[key]
    kind = _enum_name(getattr(stage, "kind", None))
    if kind == "WON":
        return LeadStage.WON
    if kind == "LOST":
        return LeadStage.LOST
    return LeadStage.NEW


def _rule_matches(
    rule,
    *,
    source_name: str | None,
    campaign_id: str | None,
    campaign_name: str | None,
    region: str | None,
    product_interest: str | None,
    sector: str | None,
) -> bool:
    matched_any = False
    if rule.source is not None:
        matched_any = True
        if source_name != _enum_name(rule.source):
            return False
    if rule.campaignId is not None:
        matched_any = True
        if _norm(campaign_id) != _norm(rule.campaignId):
            return False
    if rule.campaignName is not None:
        matched_any = True
        if _norm_ci(campaign_name) != _norm_ci(rule.campaignName):
            return False
    if rule.region is not None:
        matched_any = True
        if _norm_ci(region) != _norm_ci(rule.region):
            return False
    if rule.productInterest is not None:
        matched_any = True
        if _norm_ci(product_interest) != _norm_ci(rule.productInterest):
            return False
    if rule.sector is not None:
        matched_any = True
        if _norm_ci(sector) != _norm_ci(rule.sector):
            return False
    return matched_any


async def resolve_pipeline_for_lead(
    *,
    organization_id: str,
    source: LeadSource | str | None = None,
    campaign_id: str | None = None,
    campaign_name: str | None = None,
    region: str | None = None,
    product_interest: str | None = None,
    sector: str | None = None,
    pipeline_id: str | None = None,
    allow_archived: bool = False,
):
    """Pick a pipeline: explicit id (must be active unless allow_archived), else rules, else default."""
    if pipeline_id:
        where: dict[str, Any] = {"id": pipeline_id, "organizationId": organization_id}
        if not allow_archived:
            where["isActive"] = True
        pipeline = await prisma.pipeline.find_first(
            where=where,
            include={"stages": {"order_by": {"sortOrder": "asc"}}},
        )
        if pipeline:
            return pipeline, "explicit"
        # Explicit archived target rejected for routing — fall through

    source_name = _enum_name(source)
    campaign_id_n = _norm(campaign_id)
    campaign_name_n = _norm(campaign_name)
    region_n = _norm(region)
    product_n = _norm(product_interest)
    sector_n = _norm(sector)

    # Deterministic: priority asc, then createdAt asc, then id asc
    rules = await prisma.pipelineroutingrule.find_many(
        where={"organizationId": organization_id, "isActive": True},
        order=[{"priority": "asc"}, {"createdAt": "asc"}, {"id": "asc"}],
        include={"pipeline": {"include": {"stages": {"order_by": {"sortOrder": "asc"}}}}},
    )

    for rule in rules:
        pipeline = rule.pipeline
        if not pipeline or not pipeline.isActive:
            continue
        if not _rule_matches(
            rule,
            source_name=source_name,
            campaign_id=campaign_id_n,
            campaign_name=campaign_name_n,
            region=region_n,
            product_interest=product_n,
            sector=sector_n,
        ):
            continue
        if not getattr(pipeline, "stages", None):
            pipeline = await prisma.pipeline.find_unique(
                where={"id": pipeline.id},
                include={"stages": {"order_by": {"sortOrder": "asc"}}},
            )
        return pipeline, "rule"

    default = await get_default_pipeline(organization_id)
    return default, "default"


async def assignment_fields(
    *,
    organization_id: str,
    source: LeadSource | str | None = None,
    campaign_id: str | None = None,
    campaign_name: str | None = None,
    region: str | None = None,
    product_interest: str | None = None,
    sector: str | None = None,
    pipeline_id: str | None = None,
    prefer_system_key: str | LeadStage | None = None,
) -> dict[str, Any]:
    """Return Lead create fields for pipeline + stage (+ synced legacy stage/status)."""
    pipeline, reason = await resolve_pipeline_for_lead(
        organization_id=organization_id,
        source=source,
        campaign_id=campaign_id,
        campaign_name=campaign_name,
        region=region,
        product_interest=product_interest,
        sector=sector,
        pipeline_id=pipeline_id,
        allow_archived=False,
    )
    stage = None
    if prefer_system_key is not None:
        stage = stage_for_system_key(pipeline, prefer_system_key)
    if stage is None:
        stage = entry_stage(pipeline)
    if stage is None:
        return {}

    legacy = legacy_stage_from_pipeline_stage(stage)
    status = lead_status_for_kind(stage.kind)
    data: dict[str, Any] = {
        "pipelineId": pipeline.id,
        "pipelineStageId": stage.id,
        "stage": legacy,
        "_pipeline_name": pipeline.name,
        "_stage_name": stage.name,
        "_route_reason": reason,
    }
    if status is not None:
        data["leadStatus"] = status
    return data


async def merge_pipeline_into_create_data(
    data: dict[str, Any],
    *,
    organization_id: str,
) -> dict[str, Any]:
    """Attach pipeline assignment for raw lead.create calls (create/ingest/connectors)."""
    if data.get("pipelineId") and data.get("pipelineStageId"):
        from fastapi import HTTPException
        pipeline = await prisma.pipeline.find_first(where={
            "id": data["pipelineId"], "organizationId": organization_id,
        }, include={"stages": True})
        if not pipeline or not any(s.id == data["pipelineStageId"] for s in pipeline.stages or []):
            raise HTTPException(400, "Invalid pipeline or stage for this organization")
        return data
    routed = await assignment_fields(
        organization_id=organization_id,
        source=data.get("source"),
        campaign_id=data.get("campaignId"),
        campaign_name=data.get("campaignName"),
        region=data.get("region"),
        product_interest=data.get("productInterest"),
        sector=data.get("sector"),
        pipeline_id=data.get("pipelineId"),
        prefer_system_key=data.get("stage") or "NEW",
    )
    for key in ("pipelineId", "pipelineStageId", "stage", "leadStatus"):
        if key in routed:
            data[key] = routed[key]
    return data
