"""Pipeline CRUD, routing rules, and overview aggregates (pipelineStageId only)."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from loomrun_api.pipeline_defaults import DEFAULT_STAGES
from loomrun_api.pipeline_routing import (
    _rule_matches,
    ensure_default_pipeline,
    entry_stage,
    get_default_pipeline,
    lead_status_for_kind,
    legacy_stage_from_pipeline_stage,
    stage_for_system_key,
)
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from prisma.enums import LeadActivityType, LeadSource, PipelineStageKind, PipelineType

SOURCE_LABELS: dict[str, str] = {
    "META_ADS": "Meta Ads",
    "GOOGLE_ADS": "Google Ads",
    "INDIAMART": "IndiaMART",
    "WHATSAPP": "WhatsApp",
    "INSTAGRAM": "Instagram",
    "WEB": "Website",
    "WEBSITE": "Website",
    "REFERRAL": "Referral",
    "TELECALLER": "Telecaller",
    "MANUAL": "Manual",
    "OTHER": "Other",
}


def _enum_name(value: Any) -> str:
    return value.name if hasattr(value, "name") else str(value)


def _slugify(name: str) -> str:
    s = re.sub(r"[^\w\s-]", "", (name or "").lower()).strip()
    s = re.sub(r"[-\s]+", "-", s)
    return (s[:48] or "stage").strip("-")


def serialize_stage(stage) -> dict[str, Any]:
    return {
        "id": stage.id,
        "pipeline_id": stage.pipelineId,
        "name": stage.name,
        "slug": stage.slug,
        "sort_order": stage.sortOrder,
        "kind": _enum_name(stage.kind),
        "probability": stage.probability,
        "system_key": stage.systemKey,
    }


def serialize_pipeline(pipeline, *, include_stages: bool = True) -> dict[str, Any]:
    data = {
        "id": pipeline.id,
        "organization_id": pipeline.organizationId,
        "name": pipeline.name,
        "type": _enum_name(pipeline.type),
        "is_default": pipeline.isDefault,
        "is_active": pipeline.isActive,
        "sort_order": pipeline.sortOrder,
        "created_at": pipeline.createdAt.isoformat() if pipeline.createdAt else None,
        "updated_at": pipeline.updatedAt.isoformat() if pipeline.updatedAt else None,
    }
    if include_stages:
        stages = list(getattr(pipeline, "stages", None) or [])
        stages.sort(key=lambda s: s.sortOrder)
        data["stages"] = [serialize_stage(s) for s in stages]
    return data


def serialize_rule(rule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "organization_id": rule.organizationId,
        "pipeline_id": rule.pipelineId,
        "priority": rule.priority,
        "is_active": rule.isActive,
        "source": _enum_name(rule.source) if rule.source is not None else None,
        "campaign_id": rule.campaignId,
        "campaign_name": rule.campaignName,
        "region": rule.region,
        "product_interest": rule.productInterest,
        "sector": rule.sector,
        "pipeline_name": rule.pipeline.name if getattr(rule, "pipeline", None) else None,
    }


async def list_pipelines(*, organization_id: str, include_archived: bool = True) -> dict[str, Any]:
    await ensure_default_pipeline(organization_id)
    where: dict[str, Any] = {"organizationId": organization_id}
    if not include_archived:
        where["isActive"] = True
    rows = await prisma.pipeline.find_many(
        where=where,
        order=[{"sortOrder": "asc"}, {"createdAt": "asc"}],
        include={"stages": {"order_by": {"sortOrder": "asc"}}},
    )
    return {"items": [serialize_pipeline(p) for p in rows]}


async def create_pipeline(
    *,
    organization_id: str,
    name: str,
    type: str = "GENERAL",
    copy_default_stages: bool = True,
    is_default: bool = False,
) -> dict[str, Any]:
    name = " ".join((name or "").split()).strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="name is required")
    type_key = (type or "GENERAL").strip().upper()
    if type_key not in PipelineType.__members__:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid type '{type}'")

    count = await prisma.pipeline.count(where={"organizationId": organization_id})
    make_default = is_default or count == 0

    stage_creates = []
    if copy_default_stages:
        for s_name, slug, order, kind, prob, system_key in DEFAULT_STAGES:
            stage_creates.append(
                {
                    "name": s_name,
                    "slug": slug,
                    "sortOrder": order,
                    "kind": PipelineStageKind[kind],
                    "probability": prob,
                    "systemKey": system_key,
                }
            )
    else:
        stage_creates = [
            {"name": "New", "slug": "new", "sortOrder": 0, "kind": PipelineStageKind.OPEN, "probability": 10, "systemKey": "NEW"},
            {"name": "Won", "slug": "won", "sortOrder": 1, "kind": PipelineStageKind.WON, "probability": 100, "systemKey": "WON"},
            {"name": "Lost", "slug": "lost", "sortOrder": 2, "kind": PipelineStageKind.LOST, "probability": 0, "systemKey": "LOST"},
        ]

    async with prisma.tx() as tx:
        if make_default:
            await tx.pipeline.update_many(
                where={"organizationId": organization_id, "isDefault": True},
                data={"isDefault": False},
            )
        pipeline = await tx.pipeline.create(
            data={
                "organizationId": organization_id,
                "name": name,
                "type": PipelineType[type_key],
                "isDefault": make_default,
                "isActive": True,
                "sortOrder": count,
                "stages": {"create": stage_creates},
            },
            include={"stages": {"order_by": {"sortOrder": "asc"}}},
        )
    return serialize_pipeline(pipeline)


async def update_pipeline(
    *,
    organization_id: str,
    pipeline_id: str,
    name: str | None = None,
    type: str | None = None,
    is_default: bool | None = None,
    is_active: bool | None = None,
    sort_order: int | None = None,
) -> dict[str, Any]:
    pipeline = await prisma.pipeline.find_first(
        where={"id": pipeline_id, "organizationId": organization_id},
    )
    if not pipeline:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pipeline not found")

    # Archive guard: cannot archive the only/default without another default
    if is_active is False and pipeline.isDefault:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Cannot archive the default pipeline. Make another active pipeline default first.",
        )
    if is_active is False and pipeline.isActive:
        other_default = await prisma.pipeline.find_first(
            where={
                "organizationId": organization_id,
                "isDefault": True,
                "isActive": True,
                "id": {"not": pipeline_id},
            }
        )
        if not other_default and pipeline.isDefault:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Cannot archive the default pipeline. Make another active pipeline default first.",
            )

    async with prisma.tx() as tx:
        data: dict[str, Any] = {}
        if name is not None:
            cleaned = " ".join(name.split()).strip()
            if not cleaned:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="name is required")
            data["name"] = cleaned
        if type is not None:
            type_key = type.strip().upper()
            if type_key not in PipelineType.__members__:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid type '{type}'")
            data["type"] = PipelineType[type_key]
        if sort_order is not None:
            data["sortOrder"] = sort_order
        if is_active is not None:
            data["isActive"] = is_active
        if is_default is True:
            other = await tx.pipeline.find_first(
                where={"id": pipeline_id, "organizationId": organization_id, "isActive": True}
            )
            if not other and not pipeline.isActive and is_active is not True:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail="Cannot set an archived pipeline as default. Reactivate it first.",
                )
            await tx.pipeline.update_many(
                where={"organizationId": organization_id, "isDefault": True},
                data={"isDefault": False},
            )
            data["isDefault"] = True
            data["isActive"] = True
        if data:
            await tx.pipeline.update(where={"id": pipeline_id}, data=data)

    updated = await prisma.pipeline.find_unique(
        where={"id": pipeline_id},
        include={"stages": {"order_by": {"sortOrder": "asc"}}},
    )
    return serialize_pipeline(updated)


async def delete_pipeline(
    *,
    organization_id: str,
    pipeline_id: str,
    move_leads_to_pipeline_id: str | None = None,
) -> dict[str, Any]:
    pipeline = await prisma.pipeline.find_first(
        where={"id": pipeline_id, "organizationId": organization_id},
        include={"stages": True},
    )
    if not pipeline:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    if pipeline.isDefault:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the default pipeline. Make another active pipeline default first.",
        )

    lead_count = await prisma.lead.count(where={"pipelineId": pipeline_id})
    if lead_count and not move_leads_to_pipeline_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Pipeline has {lead_count} lead(s). Pass move_leads_to_pipeline_id "
                "to move them, or archive the pipeline instead."
            ),
        )

    if lead_count and move_leads_to_pipeline_id:
        if move_leads_to_pipeline_id == pipeline_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Target pipeline must be different")
        target = await prisma.pipeline.find_first(
            where={
                "id": move_leads_to_pipeline_id,
                "organizationId": organization_id,
                "isActive": True,
            },
            include={"stages": {"order_by": {"sortOrder": "asc"}}},
        )
        if not target:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Target pipeline not found or archived")
        key_map = {s.systemKey: s for s in (target.stages or []) if s.systemKey}
        open_stages = [s for s in (target.stages or []) if _enum_name(s.kind) == "OPEN"]
        entry = min(open_stages, key=lambda s: s.sortOrder) if open_stages else (target.stages[0] if target.stages else None)
        if entry is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Target pipeline has no stages")

        leads = await prisma.lead.find_many(where={"pipelineId": pipeline_id})
        async with prisma.tx() as tx:
            for lead in leads:
                old_stage = next((s for s in (pipeline.stages or []) if s.id == lead.pipelineStageId), None)
                dest = key_map.get(old_stage.systemKey) if old_stage and old_stage.systemKey else entry
                await tx.lead.update(
                    where={"id": lead.id},
                    data={
                        "pipelineId": target.id,
                        "pipelineStageId": dest.id,
                        "stage": legacy_stage_from_pipeline_stage(dest),
                    },
                )
                await tx.leadactivity.create(
                    data={
                        "leadId": lead.id,
                        "type": LeadActivityType.SYSTEM,
                        "body": f"Moved from pipeline {pipeline.name} to {target.name} (pipeline deleted)",
                        "metadata": json_meta(
                            {
                                "from_pipeline_id": pipeline.id,
                                "from_pipeline_stage_id": lead.pipelineStageId,
                                "to_pipeline_id": target.id,
                                "to_pipeline_stage_id": dest.id,
                            }
                        ),
                    },
                )
            await tx.pipelineroutingrule.delete_many(where={"pipelineId": pipeline_id})
            await tx.pipeline.delete(where={"id": pipeline_id})
        return {"ok": True, "moved_leads": lead_count}

    async with prisma.tx() as tx:
        await tx.pipelineroutingrule.delete_many(where={"pipelineId": pipeline_id})
        await tx.pipeline.delete(where={"id": pipeline_id})
    return {"ok": True, "moved_leads": 0}


async def replace_stages(
    *,
    organization_id: str,
    pipeline_id: str,
    stages: list[dict[str, Any]],
) -> dict[str, Any]:
    pipeline = await prisma.pipeline.find_first(
        where={"id": pipeline_id, "organizationId": organization_id},
        include={"stages": True},
    )
    if not pipeline:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    if not stages:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="At least one stage is required")

    kinds = {str(s.get("kind") or "OPEN").upper() for s in stages}
    if "OPEN" not in kinds:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="At least one OPEN stage is required")

    existing_by_id = {s.id: s for s in (pipeline.stages or [])}
    seen_slugs: set[str] = set()
    keep_ids: set[str] = set()
    prepared: list[dict[str, Any]] = []

    for idx, raw in enumerate(stages):
        name = " ".join(str(raw.get("name") or "").split()).strip()
        if not name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Stage {idx + 1}: name is required")
        slug = _slugify(str(raw.get("slug") or name))
        if slug in seen_slugs:
            slug = f"{slug}-{idx}"
        seen_slugs.add(slug)
        kind_key = str(raw.get("kind") or "OPEN").upper()
        if kind_key not in PipelineStageKind.__members__:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid kind '{kind_key}'")
        prob = raw.get("probability")
        if prob is not None:
            try:
                prob = max(0, min(100, int(prob)))
            except (TypeError, ValueError):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="probability must be 0–100")
        system_key = raw.get("system_key")
        if system_key:
            system_key = str(system_key).strip().upper() or None
        stage_id = raw.get("id")
        if stage_id and stage_id in existing_by_id:
            keep_ids.add(stage_id)
            prepared.append(
                {
                    "id": stage_id,
                    "name": name,
                    "slug": slug,
                    "sortOrder": idx,
                    "kind": PipelineStageKind[kind_key],
                    "probability": prob,
                    "systemKey": system_key,
                }
            )
        else:
            prepared.append(
                {
                    "id": None,
                    "name": name,
                    "slug": slug,
                    "sortOrder": idx,
                    "kind": PipelineStageKind[kind_key],
                    "probability": prob,
                    "systemKey": system_key,
                }
            )

    drop_ids = [sid for sid in existing_by_id if sid not in keep_ids]
    if drop_ids:
        occupied = await prisma.lead.count(where={"pipelineStageId": {"in": drop_ids}})
        if occupied:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"{occupied} lead(s) are on stages being removed. "
                    "Move those leads to another stage before deleting stages."
                ),
            )

    async with prisma.tx() as tx:
        for item in prepared:
            if item["id"]:
                await tx.pipelinestage.update(
                    where={"id": item["id"]},
                    data={
                        "name": item["name"],
                        "slug": item["slug"],
                        "sortOrder": item["sortOrder"],
                        "kind": item["kind"],
                        "probability": item["probability"],
                        "systemKey": item["systemKey"],
                    },
                )
            else:
                created = await tx.pipelinestage.create(
                    data={
                        "pipelineId": pipeline_id,
                        "name": item["name"],
                        "slug": item["slug"],
                        "sortOrder": item["sortOrder"],
                        "kind": item["kind"],
                        "probability": item["probability"],
                        "systemKey": item["systemKey"],
                    }
                )
                item["id"] = created.id
        if drop_ids:
            await tx.pipelinestage.delete_many(where={"id": {"in": drop_ids}})

    updated = await prisma.pipeline.find_unique(
        where={"id": pipeline_id},
        include={"stages": {"order_by": {"sortOrder": "asc"}}},
    )
    return serialize_pipeline(updated)


async def list_routing_rules(*, organization_id: str) -> dict[str, Any]:
    await ensure_default_pipeline(organization_id)
    rows = await prisma.pipelineroutingrule.find_many(
        where={"organizationId": organization_id},
        order=[{"priority": "asc"}, {"createdAt": "asc"}, {"id": "asc"}],
        include={"pipeline": True},
    )
    return {"items": [serialize_rule(r) for r in rows]}


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split()).strip()
    return text or None


def _rule_fields_from_row(row) -> dict[str, Any]:
    return {
        "source": row.source if not isinstance(row, dict) else row.get("source"),
        "campaignId": getattr(row, "campaignId", None) if not isinstance(row, dict) else row.get("campaignId"),
        "campaignName": getattr(row, "campaignName", None) if not isinstance(row, dict) else row.get("campaignName"),
        "region": getattr(row, "region", None) if not isinstance(row, dict) else row.get("region"),
        "productInterest": getattr(row, "productInterest", None)
        if not isinstance(row, dict)
        else row.get("productInterest"),
        "sector": getattr(row, "sector", None) if not isinstance(row, dict) else row.get("sector"),
    }


def _campaign_identity(fields: dict[str, Any]) -> tuple[str | None, str | None]:
    cid = _clean_text(fields.get("campaignId") or fields.get("campaign_id"))
    cname = _clean_text(fields.get("campaignName") or fields.get("campaign_name"))
    return cid, (cname.lower() if cname else None)


def _is_campaign_rule_fields(fields: dict[str, Any]) -> bool:
    cid, cname = _campaign_identity(fields)
    return bool(cid or cname)


def _same_campaign_identity(a: dict[str, Any], b: dict[str, Any]) -> bool:
    aid, aname = _campaign_identity(a)
    bid, bname = _campaign_identity(b)
    if aid and bid:
        return aid == bid
    if aid or bid:
        return False
    return aname is not None and aname == bname


def _campaign_label(fields: dict[str, Any]) -> str:
    cid, cname_key = _campaign_identity(fields)
    name = _clean_text(fields.get("campaignName") or fields.get("campaign_name"))
    if name and cid:
        return f"{name}"
    if name:
        return name
    return cid or "campaign"


def _normalize_incoming_rule(raw: dict[str, Any], *, idx: int) -> dict[str, Any]:
    pipeline_id = raw.get("pipeline_id")
    if not pipeline_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Rule {idx + 1}: pipeline_id required")
    source = raw.get("source")
    source_enum = None
    if source:
        key = str(source).strip().upper()
        if key not in LeadSource.__members__:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid source '{source}'")
        source_enum = LeadSource[key]
    fields = {
        "source": source_enum,
        "campaignId": _clean_text(raw.get("campaign_id")),
        "campaignName": _clean_text(raw.get("campaign_name")),
        "region": _clean_text(raw.get("region")),
        "productInterest": _clean_text(raw.get("product_interest")),
        "sector": _clean_text(raw.get("sector")),
    }
    if all(v is None for v in fields.values()):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Rule {idx + 1}: set at least one match field",
        )
    return {
        "pipeline_id": pipeline_id,
        "is_active": bool(raw.get("is_active", True)),
        "fields": fields,
    }


async def replace_routing_rules(
    *,
    organization_id: str,
    rules: list[dict[str, Any]],
    user_id: str | None = None,
    migrate_existing_campaign_leads: bool = True,
) -> dict[str, Any]:
    normalized = [_normalize_incoming_rule(raw, idx=idx) for idx, raw in enumerate(rules)]
    pipeline_ids = {r["pipeline_id"] for r in normalized}
    if pipeline_ids:
        found = await prisma.pipeline.find_many(
            where={"organizationId": organization_id, "id": {"in": list(pipeline_ids)}},
        )
        found_ids = {p.id for p in found}
        missing = pipeline_ids - found_ids
        if missing:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown pipeline_id(s): {', '.join(sorted(missing))}",
            )
        inactive = [p for p in found if not p.isActive]
        if inactive and migrate_existing_campaign_leads:
            names = ", ".join(p.name for p in inactive)
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Cannot assign campaigns to archived pipeline(s): {names}. "
                    "Reactivate the pipeline first."
                ),
            )

    previous_rows = await prisma.pipelineroutingrule.find_many(
        where={"organizationId": organization_id},
        include={"pipeline": True},
    )

    # Prefer unique priorities: reindex 0..n-1 in list order
    async with prisma.tx() as tx:
        await tx.pipelineroutingrule.delete_many(where={"organizationId": organization_id})
        created_rows = []
        for idx, item in enumerate(normalized):
            fields = item["fields"]
            row = await tx.pipelineroutingrule.create(
                data={
                    "organizationId": organization_id,
                    "pipelineId": item["pipeline_id"],
                    "priority": idx,
                    "isActive": item["is_active"],
                    "source": fields["source"],
                    "campaignId": fields["campaignId"],
                    "campaignName": fields["campaignName"],
                    "region": fields["region"],
                    "productInterest": fields["productInterest"],
                    "sector": fields["sector"],
                },
                include={"pipeline": True},
            )
            created_rows.append(row)

    move_outs: list[dict[str, Any]] = []
    migrations: list[dict[str, Any]] = []
    if migrate_existing_campaign_leads:
        # 1) Evict leads for removed/replaced campaign assignments on each pipeline.
        move_outs = await _evict_replaced_campaign_assignments(
            organization_id=organization_id,
            user_id=user_id,
            previous_rows=previous_rows,
            new_rows=created_rows,
        )
        # 2) Pull matching leads into each new active campaign rule.
        for row in created_rows:
            if not row.isActive:
                continue
            if not row.campaignId and not row.campaignName:
                continue
            migrations.append(
                await apply_routing_rule_to_existing(
                    organization_id=organization_id,
                    user_id=user_id,
                    rule={},
                    rule_id=row.id,
                    reason="campaign_routing_assignment",
                )
            )

    moved_out = sum(int(r.get("moved") or 0) for r in move_outs)
    moved_in = sum(int(r.get("moved") or 0) for r in migrations)
    already = sum(int(r.get("already_in_target") or 0) for r in migrations)
    failed = sum(int(r.get("failed") or 0) for r in move_outs) + sum(
        int(r.get("failed") or 0) for r in migrations
    )

    return {
        "items": [serialize_rule(r) for r in created_rows],
        "migrations": migrations,
        "move_outs": move_outs,
        "replacement": {
            "moved_out": moved_out,
            "moved_in": moved_in,
            "already_in_target": already,
            "failed": failed,
        },
    }


async def preview_routing_rules_replace(
    *,
    organization_id: str,
    rules: list[dict[str, Any]],
) -> dict[str, Any]:
    """Preview campaign population replacement before saving routing rules."""
    await ensure_default_pipeline(organization_id)
    normalized = [_normalize_incoming_rule(raw, idx=idx) for idx, raw in enumerate(rules)]
    previous_rows = await prisma.pipelineroutingrule.find_many(
        where={"organizationId": organization_id},
        include={"pipeline": True},
    )
    default_pipe = await get_default_pipeline(organization_id)
    default_name = default_pipe.name if default_pipe else "default pipeline"

    new_active_campaign = [
        {"pipeline_id": item["pipeline_id"], "fields": item["fields"], "is_active": item["is_active"]}
        for item in normalized
        if item["is_active"] and _is_campaign_rule_fields(item["fields"])
    ]

    move_out_preview: list[dict[str, Any]] = []
    for old in previous_rows:
        if not old.isActive:
            continue
        old_fields = _rule_fields_from_row(old)
        if not _is_campaign_rule_fields(old_fields):
            continue
        still = any(
            n["pipeline_id"] == old.pipelineId and _same_campaign_identity(old_fields, n["fields"])
            for n in new_active_campaign
        )
        if still:
            continue
        keep_specs = [
            _rule_spec(n["fields"])
            for n in new_active_campaign
            if n["pipeline_id"] == old.pipelineId
        ]
        on_pipeline = await _find_leads_matching_rule(
            organization_id=organization_id,
            fields=old_fields,
            pipeline_id=old.pipelineId,
        )
        to_move = [
            lead
            for lead in on_pipeline
            if not _lead_matches_any_rule_specs(lead, keep_specs)
        ]
        pipe_name = old.pipeline.name if getattr(old, "pipeline", None) else old.pipelineId
        move_out_preview.append(
            {
                "pipeline_id": old.pipelineId,
                "pipeline_name": pipe_name,
                "campaign_id": old_fields.get("campaignId"),
                "campaign_name": old_fields.get("campaignName"),
                "campaign_label": _campaign_label(old_fields),
                "count": len(to_move),
                "default_pipeline_name": default_name,
            }
        )

    move_in_preview: list[dict[str, Any]] = []
    for item in new_active_campaign:
        preview = await preview_routing_rule_matches(
            organization_id=organization_id,
            rule={
                "source": _enum_name(item["fields"]["source"]) if item["fields"]["source"] else None,
                "campaign_id": item["fields"]["campaignId"],
                "campaign_name": item["fields"]["campaignName"],
                "region": item["fields"]["region"],
                "product_interest": item["fields"]["productInterest"],
                "sector": item["fields"]["sector"],
            },
            pipeline_id=item["pipeline_id"],
        )
        pipe = await prisma.pipeline.find_first(
            where={"id": item["pipeline_id"], "organizationId": organization_id},
        )
        move_in_preview.append(
            {
                "pipeline_id": item["pipeline_id"],
                "pipeline_name": pipe.name if pipe else item["pipeline_id"],
                "campaign_id": item["fields"]["campaignId"],
                "campaign_name": item["fields"]["campaignName"],
                "campaign_label": _campaign_label(item["fields"]),
                "matched": preview["matched"],
                "already_in_target": preview["already_in_target"],
                "movable": preview["movable"],
            }
        )

    return {
        "move_outs": move_out_preview,
        "move_ins": move_in_preview,
        "moved_out": sum(x["count"] for x in move_out_preview),
        "moved_in": sum(x["movable"] for x in move_in_preview),
        "already_in_target": sum(x["already_in_target"] for x in move_in_preview),
        "is_replacement": any(x["count"] > 0 for x in move_out_preview),
        "default_pipeline_name": default_name,
    }


async def _evict_replaced_campaign_assignments(
    *,
    organization_id: str,
    user_id: str | None,
    previous_rows: list[Any],
    new_rows: list[Any],
) -> list[dict[str, Any]]:
    new_active_campaign = [
        {"pipeline_id": row.pipelineId, "fields": _rule_fields_from_row(row)}
        for row in new_rows
        if row.isActive and (row.campaignId or row.campaignName)
    ]
    results: list[dict[str, Any]] = []
    default_pipe = await get_default_pipeline(organization_id)
    if not default_pipe:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Default pipeline not found")

    for old in previous_rows:
        if not old.isActive:
            continue
        old_fields = _rule_fields_from_row(old)
        if not _is_campaign_rule_fields(old_fields):
            continue
        still = any(
            n["pipeline_id"] == old.pipelineId and _same_campaign_identity(old_fields, n["fields"])
            for n in new_active_campaign
        )
        if still:
            continue

        keep_specs = [
            _rule_spec(n["fields"])
            for n in new_active_campaign
            if n["pipeline_id"] == old.pipelineId
        ]
        on_pipeline = await _find_leads_matching_rule(
            organization_id=organization_id,
            fields=old_fields,
            pipeline_id=old.pipelineId,
        )
        to_move = [
            lead
            for lead in on_pipeline
            if not _lead_matches_any_rule_specs(lead, keep_specs)
        ]
        if not to_move:
            results.append(
                {
                    "pipeline_id": old.pipelineId,
                    "pipeline_name": old.pipeline.name if getattr(old, "pipeline", None) else None,
                    "campaign_id": old_fields.get("campaignId"),
                    "campaign_name": old_fields.get("campaignName"),
                    "moved": 0,
                    "failed": 0,
                    "stages_preserved": 0,
                    "target_pipeline_id": default_pipe.id,
                    "target_pipeline_name": default_pipe.name,
                }
            )
            continue

        move_result = await _batch_move_leads_to_pipeline(
            leads=to_move,
            target_pipeline=default_pipe,
            user_id=user_id,
            reason="campaign_routing_replacement",
            activity_body=(
                f"Returned to pipeline {default_pipe.name} after campaign routing change"
            ),
            extra_meta={
                "from_campaign_id": old_fields.get("campaignId"),
                "from_campaign_name": old_fields.get("campaignName"),
                "evicted_from_pipeline_id": old.pipelineId,
            },
        )
        results.append(
            {
                "pipeline_id": old.pipelineId,
                "pipeline_name": old.pipeline.name if getattr(old, "pipeline", None) else None,
                "campaign_id": old_fields.get("campaignId"),
                "campaign_name": old_fields.get("campaignName"),
                "moved": move_result["moved"],
                "failed": move_result["failed"],
                "stages_preserved": move_result["stages_preserved"],
                "target_pipeline_id": default_pipe.id,
                "target_pipeline_name": default_pipe.name,
            }
        )
    return results


def _lead_matches_any_rule_specs(lead: Any, specs: list[Any]) -> bool:
    for rule in specs:
        if _rule_matches(
            rule,
            source_name=_enum_name(lead.source),
            campaign_id=getattr(lead, "campaignId", None),
            campaign_name=getattr(lead, "campaignName", None),
            region=getattr(lead, "region", None),
            product_interest=lead.productInterest,
            sector=getattr(lead, "sector", None),
        ):
            return True
    return False


def _parse_rule_match_fields(raw: dict[str, Any], *, label: str = "Rule") -> dict[str, Any]:
    source = raw.get("source")
    source_enum = None
    if source:
        key = str(source).strip().upper()
        if key not in LeadSource.__members__:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{label}: invalid source '{source}'")
        source_enum = LeadSource[key]
    fields = {
        "source": source_enum,
        "campaignId": _clean_text(raw.get("campaign_id")),
        "campaignName": _clean_text(raw.get("campaign_name")),
        "region": _clean_text(raw.get("region")),
        "productInterest": _clean_text(raw.get("product_interest")),
        "sector": _clean_text(raw.get("sector")),
    }
    if all(v is None for v in fields.values()):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"{label}: set at least one match field",
        )
    return fields


def _rule_spec(fields: dict[str, Any]):
    from types import SimpleNamespace

    return SimpleNamespace(
        source=fields["source"],
        campaignId=fields["campaignId"],
        campaignName=fields["campaignName"],
        region=fields["region"],
        productInterest=fields["productInterest"],
        sector=fields["sector"],
    )


def _db_where_for_rule(*, organization_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Broad DB filter; exact AND semantics are enforced with `_rule_matches` afterwards."""
    where: dict[str, Any] = {"organizationId": organization_id}
    clauses: list[dict[str, Any]] = []
    if fields["source"] is not None:
        clauses.append({"source": fields["source"]})
    if fields["campaignId"] is not None:
        clauses.append({"campaignId": fields["campaignId"]})
    if fields["campaignName"] is not None:
        clauses.append({"campaignName": {"equals": fields["campaignName"], "mode": "insensitive"}})
    if fields["region"] is not None:
        clauses.append({"region": {"equals": fields["region"], "mode": "insensitive"}})
    if fields["productInterest"] is not None:
        clauses.append({"productInterest": {"equals": fields["productInterest"], "mode": "insensitive"}})
    if fields["sector"] is not None:
        clauses.append({"sector": {"equals": fields["sector"], "mode": "insensitive"}})
    if clauses:
        where["AND"] = clauses
    return where


async def _find_leads_matching_rule(
    *,
    organization_id: str,
    fields: dict[str, Any],
    pipeline_id: str | None = None,
) -> list[Any]:
    rule = _rule_spec(fields)
    where = _db_where_for_rule(organization_id=organization_id, fields=fields)
    if pipeline_id:
        where = {**where, "pipelineId": pipeline_id}
    candidates = await prisma.lead.find_many(where=where)
    matched = []
    for lead in candidates:
        if _rule_matches(
            rule,
            source_name=_enum_name(lead.source),
            campaign_id=getattr(lead, "campaignId", None),
            campaign_name=getattr(lead, "campaignName", None),
            region=getattr(lead, "region", None),
            product_interest=lead.productInterest,
            sector=getattr(lead, "sector", None),
        ):
            matched.append(lead)
    return matched


async def preview_routing_rule_matches(
    *,
    organization_id: str,
    rule: dict[str, Any],
    pipeline_id: str | None = None,
) -> dict[str, Any]:
    fields = _parse_rule_match_fields(rule)
    target_pipeline_id = pipeline_id or rule.get("pipeline_id")
    matched = await _find_leads_matching_rule(organization_id=organization_id, fields=fields)
    already = 0
    if target_pipeline_id:
        already = sum(1 for lead in matched if getattr(lead, "pipelineId", None) == target_pipeline_id)
    return {
        "matched": len(matched),
        "already_in_target": already,
        "movable": max(0, len(matched) - already),
        "pipeline_id": target_pipeline_id,
    }


async def _batch_move_leads_to_pipeline(
    *,
    leads: list[Any],
    target_pipeline: Any,
    user_id: str | None,
    reason: str,
    activity_body: str,
    rule_id: str | None = None,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Move leads into target_pipeline in batches; preserve systemKey stages when possible."""
    fallback_stage = entry_stage(target_pipeline)
    if not fallback_stage:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Target pipeline has no stages")

    now = datetime.now(timezone.utc)
    moved = 0
    failed = 0
    preserved = 0
    batch_size = 50

    for i in range(0, len(leads), batch_size):
        batch = leads[i : i + batch_size]
        try:
            async with prisma.tx() as tx:
                for lead in batch:
                    old_pipeline_id = getattr(lead, "pipelineId", None)
                    old_stage_id = getattr(lead, "pipelineStageId", None)
                    legacy_name = _enum_name(lead.stage)
                    mapped = stage_for_system_key(target_pipeline, legacy_name) if legacy_name else None
                    target_stage = mapped or fallback_stage
                    if mapped is not None:
                        preserved += 1
                    legacy = legacy_stage_from_pipeline_stage(target_stage)
                    status_val = lead_status_for_kind(target_stage.kind)
                    data: dict[str, Any] = {
                        "pipelineId": target_pipeline.id,
                        "pipelineStageId": target_stage.id,
                        "stage": legacy,
                        "lastActivityAt": now,
                    }
                    if status_val is not None:
                        data["leadStatus"] = status_val
                    meta = {
                        "from_pipeline_id": old_pipeline_id,
                        "from_pipeline_stage_id": old_stage_id,
                        "to_pipeline_id": target_pipeline.id,
                        "to_pipeline_stage_id": target_stage.id,
                        "reason": reason,
                        "rule_id": rule_id,
                        "preserved_system_key": bool(mapped),
                        "legacy_stage": legacy_name,
                    }
                    if extra_meta:
                        meta.update(extra_meta)
                    await tx.lead.update(where={"id": lead.id}, data=data)
                    await tx.leadactivity.create(
                        data={
                            "leadId": lead.id,
                            "userId": user_id,
                            "type": LeadActivityType.STAGE_CHANGE,
                            "body": activity_body,
                            "metadata": json_meta(meta),
                        }
                    )
                    moved += 1
        except Exception:
            failed += len(batch)

    return {
        "moved": moved,
        "failed": failed,
        "stages_preserved": preserved,
        "pipeline_stage_id": fallback_stage.id,
        "pipeline_stage_name": fallback_stage.name,
    }


async def apply_routing_rule_to_existing(
    *,
    organization_id: str,
    user_id: str | None,
    rule: dict[str, Any],
    pipeline_id: str | None = None,
    rule_id: str | None = None,
    reason: str = "campaign_routing_assignment",
) -> dict[str, Any]:
    """Move existing matching leads onto the rule's target pipeline.

    Stage placement prefers a target stage whose systemKey matches the lead's
    legacy Lead.stage; otherwise the pipeline's first OPEN stage is used.
    """
    fields = None
    target_pipeline_id = pipeline_id or rule.get("pipeline_id")

    if rule_id:
        saved = await prisma.pipelineroutingrule.find_first(
            where={"id": rule_id, "organizationId": organization_id},
            include={"pipeline": True},
        )
        if not saved:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Routing rule not found")
        fields = {
            "source": saved.source,
            "campaignId": saved.campaignId,
            "campaignName": saved.campaignName,
            "region": saved.region,
            "productInterest": saved.productInterest,
            "sector": saved.sector,
        }
        if all(v is None for v in fields.values()):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Rule has no match fields")
        target_pipeline_id = target_pipeline_id or saved.pipelineId
    else:
        fields = _parse_rule_match_fields(rule)

    if not target_pipeline_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="pipeline_id is required")

    pipeline = await prisma.pipeline.find_first(
        where={"id": target_pipeline_id, "organizationId": organization_id, "isActive": True},
        include={"stages": {"order_by": {"sortOrder": "asc"}}},
    )
    if not pipeline:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Target pipeline not found or archived")

    fallback_stage = entry_stage(pipeline)
    if not fallback_stage:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Target pipeline has no stages")

    matched = await _find_leads_matching_rule(organization_id=organization_id, fields=fields)
    already = [lead for lead in matched if getattr(lead, "pipelineId", None) == pipeline.id]
    to_move = [lead for lead in matched if getattr(lead, "pipelineId", None) != pipeline.id]

    move_result = await _batch_move_leads_to_pipeline(
        leads=to_move,
        target_pipeline=pipeline,
        user_id=user_id,
        reason=reason,
        activity_body=f"Assigned to pipeline {pipeline.name} via campaign routing",
        rule_id=rule_id,
    )

    return {
        "matched": len(matched),
        "moved": move_result["moved"],
        "already_in_target": len(already),
        "failed": move_result["failed"],
        "stages_preserved": move_result["stages_preserved"],
        "pipeline_id": pipeline.id,
        "pipeline_name": pipeline.name,
        "pipeline_stage_id": fallback_stage.id,
        "pipeline_stage_name": fallback_stage.name,
    }


def _float_value(value) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


async def pipeline_overview(*, organization_id: str, pipeline_id: str) -> dict[str, Any]:
    """KPIs/funnel use pipelineStageId only — never legacy Lead.stage."""
    pipeline = await prisma.pipeline.find_first(
        where={"id": pipeline_id, "organizationId": organization_id},
        include={"stages": {"order_by": {"sortOrder": "asc"}}},
    )
    if not pipeline:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pipeline not found")

    leads = await prisma.lead.find_many(
        where={"organizationId": organization_id, "pipelineId": pipeline_id},
    )
    stage_by_id = {s.id: s for s in (pipeline.stages or [])}
    now = datetime.now(timezone.utc)

    total = len(leads)
    open_count = won_count = lost_count = 0
    age_seconds_sum = 0.0
    age_n = 0
    total_value = weighted_value = won_value = lost_value = 0.0
    funnel_counts: dict[str, int] = {s.id: 0 for s in (pipeline.stages or [])}
    tag_buckets = {"in_progress": {}, "lost": {}, "converted": {}}

    for lead in leads:
        # Analytics keyed only by pipelineStageId
        stage = stage_by_id.get(lead.pipelineStageId) if lead.pipelineStageId else None
        kind = _enum_name(stage.kind) if stage else "OPEN"
        value = _float_value(lead.estimatedValue)
        if stage and stage.id in funnel_counts:
            funnel_counts[stage.id] += 1

        if kind == "WON":
            won_count += 1
            won_value += value
        elif kind == "LOST":
            lost_count += 1
            lost_value += value
        else:
            open_count += 1
            total_value += value
            prob = stage.probability if stage and stage.probability is not None else 0
            weighted_value += value * (prob / 100.0)

        created = lead.createdAt
        if created:
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            age_seconds_sum += (now - created).total_seconds()
            age_n += 1

        tags = list(lead.tags or [])
        bucket_key = "converted" if kind == "WON" else ("lost" if kind == "LOST" else "in_progress")
        if not tags:
            label = stage.name if stage else "Unstaged"
            tag_buckets[bucket_key][label] = tag_buckets[bucket_key].get(label, 0) + 1
        else:
            for tag in tags:
                tag_buckets[bucket_key][tag] = tag_buckets[bucket_key].get(tag, 0) + 1

    avg_age_hours = (age_seconds_sum / age_n / 3600.0) if age_n else 0.0
    conversion = (won_count / total * 100.0) if total else 0.0

    funnel = []
    for stage in pipeline.stages or []:
        count = funnel_counts.get(stage.id, 0)
        funnel.append(
            {
                **serialize_stage(stage),
                "count": count,
                "percent": round(count / total * 100.0, 1) if total else 0.0,
            }
        )

    def _bucket_items(raw: dict[str, int]) -> list[dict[str, Any]]:
        return [{"label": k, "count": v} for k, v in sorted(raw.items(), key=lambda kv: (-kv[1], kv[0]))]

    source_counts: dict[str, int] = {}
    campaign_counts: dict[str, dict[str, Any]] = {}
    for lead in leads:
        src = _enum_name(lead.source)
        source_counts[src] = source_counts.get(src, 0) + 1
        cid = lead.campaignId
        if cid:
            if cid not in campaign_counts:
                campaign_counts[cid] = {
                    "id": cid,
                    "name": lead.campaignName or cid,
                    "leads_count": 0,
                }
            campaign_counts[cid]["leads_count"] += 1

    campaigns = sorted(campaign_counts.values(), key=lambda c: -c["leads_count"])[:20]
    sources = [
        {"source": k, "label": SOURCE_LABELS.get(k, k), "leads_count": v}
        for k, v in sorted(source_counts.items(), key=lambda kv: -kv[1])
    ]

    lead_ids = [l.id for l in leads]
    activities = []
    if lead_ids:
        acts = await prisma.leadactivity.find_many(
            where={"leadId": {"in": lead_ids}, "type": LeadActivityType.STAGE_CHANGE},
            order={"createdAt": "desc"},
            take=15,
            include={"lead": True, "user": True},
        )
        for a in acts:
            lead = a.lead
            user = a.user
            actor = None
            if user:
                actor = (user.name or "").strip() or user.email
            activities.append(
                {
                    "id": a.id,
                    "body": a.body,
                    "lead_id": a.leadId,
                    "lead_title": lead.title if lead else None,
                    "user_name": actor,
                    "created_at": a.createdAt.isoformat() if a.createdAt else None,
                }
            )

    return {
        "pipeline": serialize_pipeline(pipeline),
        "kpis": {
            "total_leads": total,
            "open_leads": open_count,
            "won_leads": won_count,
            "lost_leads": lost_count,
            "avg_lead_age_hours": round(avg_age_hours, 1),
            "conversion_rate": round(conversion, 1),
            "in_progress": open_count,
            "closed": won_count + lost_count,
        },
        "funnel": funnel,
        "by_tags": {
            "in_progress": {"total": sum(tag_buckets["in_progress"].values()), "items": _bucket_items(tag_buckets["in_progress"])},
            "lost": {"total": sum(tag_buckets["lost"].values()), "items": _bucket_items(tag_buckets["lost"])},
            "converted": {"total": sum(tag_buckets["converted"].values()), "items": _bucket_items(tag_buckets["converted"])},
        },
        "values": {
            "total_pipeline_value": round(total_value, 2),
            "weighted_pipeline_value": round(weighted_value, 2),
            "won_value": round(won_value, 2),
            "lost_value": round(lost_value, 2),
            "conversion_rate": round(conversion, 1),
        },
        "campaigns": campaigns,
        "sources": sources,
        "recent_activity": activities,
    }
