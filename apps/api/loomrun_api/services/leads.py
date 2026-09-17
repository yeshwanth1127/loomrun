"""Lead CRUD / search shared by HTTP routers and the AI agent."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from loomrun_api import org_events
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.whatsapp_template_service import schedule_greeting
from prisma.enums import LeadActivityType, LeadSource, LeadStage, LeadStatus

_FOLLOW_UP_DEFINITION = (
    "A follow-up is a lead whose most recent call ended in CALLBACK_SCHEDULED "
    "— the same rule the Follow-ups screen uses."
)

SOURCE_SCORES: dict[str, int] = {
    "META_ADS": 30,
    "GOOGLE_ADS": 30,
    "INDIAMART": 25,
    "WHATSAPP": 20,
    "INSTAGRAM": 15,
    "WEB": 15,
    "WEBSITE": 15,
    "REFERRAL": 15,
    "TELECALLER": 10,
    "MANUAL": 10,
    "OTHER": 10,
}

_SOURCE_ALIASES: dict[str, str] = {
    "META": "META_ADS",
    "META_ADS": "META_ADS",
    "FACEBOOK": "META_ADS",
    "FB": "META_ADS",
    "GOOGLE": "GOOGLE_ADS",
    "GOOGLE_ADS": "GOOGLE_ADS",
    "INDIAMART": "INDIAMART",
    "WHATSAPP": "WHATSAPP",
    "INSTAGRAM": "INSTAGRAM",
    "WEB": "WEB",
    "WEBSITE": "WEBSITE",
    "REFERRAL": "REFERRAL",
    "TELECALLER": "TELECALLER",
    "MANUAL": "MANUAL",
    "OTHER": "OTHER",
}


def _resolve_lead_source(source: str | None) -> LeadSource | None:
    if source is None:
        return None
    key = str(source).strip().upper().replace(" ", "_").replace("-", "_")
    if not key:
        return None
    mapped = _SOURCE_ALIASES.get(key, key)
    if mapped not in LeadSource.__members__:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown source '{source}'. Use a LeadSource value such as META_ADS or GOOGLE_ADS.",
        )
    return LeadSource[mapped]


async def list_attribution_campaigns(
    *,
    organization_id: str,
    source: str | None = None,
) -> dict[str, Any]:
    """Distinct normalized campaigns already seen on org leads.

    Campaign ID is the stable key: same name + different IDs are separate rows.
    Uses Lead.campaignId / Lead.campaignName only (no Marketing API).
    """
    resolved = _resolve_lead_source(source)
    where: dict[str, Any] = {
        "organizationId": organization_id,
        "campaignId": {"not": None},
    }
    if resolved is not None:
        where["source"] = resolved

    leads = await prisma.lead.find_many(
        where=where,
        order={"updatedAt": "desc"},
    )

    buckets: dict[tuple[str, str], dict[str, Any]] = {}
    for lead in leads:
        cid = (lead.campaignId or "").strip()
        if not cid:
            continue
        src = lead.source.name if hasattr(lead.source, "name") else str(lead.source)
        key = (src, cid)
        seen_at = lead.updatedAt or lead.createdAt
        row = buckets.get(key)
        if row is None:
            buckets[key] = {
                "source": src,
                "campaign_id": cid,
                "campaign_name": (lead.campaignName or "").strip() or cid,
                "lead_count": 1,
                "last_seen_at": seen_at.isoformat() if seen_at else None,
            }
            continue
        row["lead_count"] += 1
        if lead.campaignName and (
            not row["campaign_name"] or row["campaign_name"] == cid
        ):
            row["campaign_name"] = lead.campaignName.strip()
        if seen_at and (
            not row["last_seen_at"] or seen_at.isoformat() > row["last_seen_at"]
        ):
            row["last_seen_at"] = seen_at.isoformat()

    items = sorted(
        buckets.values(),
        key=lambda r: (-int(r["lead_count"]), str(r["campaign_name"]).casefold(), r["campaign_id"]),
    )
    return {"items": items, "count": len(items)}


def compute_lead_score(
    source,
    phone: str | None,
    email: str | None,
    product_interest: str | None,
    city: str | None,
) -> int:
    src = source.name if hasattr(source, "name") else str(source)
    score = SOURCE_SCORES.get(src, 10)
    if phone and email:
        score += 15
    if product_interest:
        score += 10
    if city:
        score += 5
    return min(score, 100)


def call_summary_fields(call) -> dict:
    if not call:
        return {
            "last_call_outcome": None,
            "last_call_logged_by": None,
            "last_call_notes": None,
            "last_call_at": None,
        }
    outcome = call.outcome.name if hasattr(call.outcome, "name") else str(call.outcome)
    user = getattr(call, "user", None)
    logged_by = None
    if user:
        logged_by = (user.name.strip() if user.name else None) or user.email
    elif call.callSource == "AI_AUTO":
        logged_by = "AI Auto-Call"
    return {
        "last_call_outcome": outcome,
        "last_call_logged_by": logged_by,
        "last_call_notes": call.notes,
        "last_call_at": call.createdAt.isoformat() if call.createdAt else None,
    }


def serialize_lead(lead, *, with_last_call: bool = False, last_call=None) -> dict:
    next_follow_up = lead.nextFollowUpAt.isoformat() if lead.nextFollowUpAt else None
    if with_last_call and last_call is not None:
        outcome = last_call.outcome.name if hasattr(last_call.outcome, "name") else str(last_call.outcome)
        # Stale dates linger when a later call resolves the callback (e.g. Order Confirmed).
        if outcome != "CALLBACK_SCHEDULED":
            next_follow_up = None
    data = {
        "id": lead.id,
        "organization_id": lead.organizationId,
        "source": lead.source.name if hasattr(lead.source, "name") else str(lead.source),
        "stage": lead.stage.name if hasattr(lead.stage, "name") else str(lead.stage),
        "lead_status": lead.leadStatus.name if hasattr(lead.leadStatus, "name") else str(lead.leadStatus),
        "pipeline_id": getattr(lead, "pipelineId", None),
        "pipeline_stage_id": getattr(lead, "pipelineStageId", None),
        "region": getattr(lead, "region", None),
        "sector": getattr(lead, "sector", None),
        "campaign_id": getattr(lead, "campaignId", None),
        "campaign_name": getattr(lead, "campaignName", None),
        "title": lead.title,
        "company": lead.company,
        "phone": lead.phone,
        "email": lead.email,
        "city": lead.city,
        "source_detail": lead.sourceDetail,
        "product_interest": lead.productInterest,
        "quantity_estimate": lead.quantityEstimate,
        "lead_score": lead.leadScore,
        "tags": list(lead.tags) if lead.tags else [],
        "notes": lead.notes,
        "assignee_id": lead.assigneeId,
        "next_follow_up_at": next_follow_up,
        "last_activity_at": lead.lastActivityAt.isoformat() if lead.lastActivityAt else None,
        "estimated_value": float(lead.estimatedValue) if lead.estimatedValue is not None else None,
        "meta_campaign_id": lead.metaCampaignId,
        "meta_campaign_name": lead.metaCampaignName,
        "meta_adset_name": lead.metaAdsetName,
        "meta_ad_name": lead.metaAdName,
        "meta_form_name": lead.metaFormName,
        "created_at": lead.createdAt.isoformat(),
        "updated_at": lead.updatedAt.isoformat(),
    }
    pipeline = getattr(lead, "pipeline", None)
    if pipeline is not None:
        data["pipeline_name"] = pipeline.name
    stage_row = getattr(lead, "pipelineStage", None)
    if stage_row is not None:
        data["pipeline_stage_name"] = stage_row.name
        data["pipeline_stage_kind"] = (
            stage_row.kind.name if hasattr(stage_row.kind, "name") else str(stage_row.kind)
        )
    if with_last_call:
        data.update(call_summary_fields(last_call))
    return data


def _emit_n8n(org_id: str, event: str, data: dict) -> None:
    from loomrun_api.n8n_events import emit_automation_event

    asyncio.create_task(emit_automation_event(org_id, event, data))


async def _delayed_auto_call(lead_id: str, org_id: str) -> None:
    await asyncio.sleep(300)
    try:
        from loomrun_api.workers import check_lead_call_needed

        await check_lead_call_needed({}, lead_id, org_id)
    except Exception:
        pass


async def _assert_assignee_in_org(organization_id: str, assignee_id: str | None) -> None:
    if not assignee_id:
        return
    membership = await prisma.membership.find_first(
        where={"organizationId": organization_id, "userId": assignee_id},
    )
    if not membership:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Assignee is not a member of this organization",
        )


# How the agent may order a lead search. "newest" means newly *created*, which
# is what someone asking for the "latest lead" means — not the most recently
# edited row, which is what updatedAt gives you.
LEAD_SORTS: dict[str, dict[str, str]] = {
    "newest": {"createdAt": "desc"},
    "oldest": {"createdAt": "asc"},
    "recently_updated": {"updatedAt": "desc"},
    "highest_value": {"estimatedValue": "desc"},
    "highest_score": {"leadScore": "desc"},
}
DEFAULT_LEAD_SORT = "newest"


async def resolve_lead(*, organization_id: str, lead_id: str):
    """Find a lead by id, or by name when the caller passed one.

    The agent is told a lead_id is required and is repeatedly given a person's
    name instead — it has the customer's name from the user and not much reason
    to believe an opaque id exists. Rejecting that outright made it invent
    leads: told "not found", it concluded the customer was missing and created a
    duplicate. Resolving the name here removes the failure mode instead of
    describing it. An ambiguous name still refuses, and says which leads matched
    so the caller can pick one.
    """
    needle = (lead_id or "").strip()
    if not needle:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="lead_id is required")

    lead = await prisma.lead.find_first(
        where={"id": needle, "organizationId": organization_id}
    )
    if lead:
        return lead

    matches = await prisma.lead.find_many(
        where={
            "organizationId": organization_id,
            "OR": [
                {"title": {"equals": needle, "mode": "insensitive"}},
                {"company": {"equals": needle, "mode": "insensitive"}},
            ],
        },
        order={"createdAt": "desc"},
        take=6,
    )
    if not matches:
        matches = await prisma.lead.find_many(
            where={
                "organizationId": organization_id,
                "OR": [
                    {"title": {"contains": needle, "mode": "insensitive"}},
                    {"company": {"contains": needle, "mode": "insensitive"}},
                ],
            },
            order={"createdAt": "desc"},
            take=6,
        )

    if len(matches) == 1:
        return matches[0]

    if not matches:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=(
                f"No lead matches '{needle}' — not as an id, a name, or a company. "
                "Do NOT create a new lead to work around this: check the spelling "
                "with search_leads first."
            ),
        )

    options = "; ".join(
        f"{m.id} = {m.title}" + (f" ({m.company})" if m.company else "") for m in matches
    )
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        detail=(
            f"'{needle}' matches {len(matches)} leads. Ask the user which one, "
            f"then retry with its id: {options}"
        ),
    )


async def search_leads(
    *,
    organization_id: str,
    search: str | None = None,
    stage: LeadStage | str | None = None,
    assignee_id: str | None = None,
    limit: int = 20,
    sort: str | None = None,
) -> dict[str, Any]:
    where: dict = {"organizationId": organization_id}
    if stage is not None:
        if isinstance(stage, LeadStage):
            where["stage"] = stage
        else:
            key = str(stage).strip().upper()
            if key not in LeadStage.__members__:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Unknown stage '{stage}'. Valid stages: "
                        f"{', '.join(LeadStage.__members__)}"
                    ),
                )
            where["stage"] = LeadStage[key]
    if assignee_id is not None:
        where["assigneeId"] = assignee_id
    if search:
        where["OR"] = [
            {"title": {"contains": search, "mode": "insensitive"}},
            {"phone": {"contains": search, "mode": "insensitive"}},
            {"company": {"contains": search, "mode": "insensitive"}},
            {"email": {"contains": search, "mode": "insensitive"}},
        ]
    take = max(1, min(int(limit or 20), 50))
    sort_key = (sort or DEFAULT_LEAD_SORT).strip().lower()
    order = LEAD_SORTS.get(sort_key) or LEAD_SORTS[DEFAULT_LEAD_SORT]
    total = await prisma.lead.count(where=where)
    leads = await prisma.lead.find_many(
        where=where,
        order=order,
        take=take,
        include={"assignee": True},
    )
    items = []
    for lead in leads:
        row = serialize_lead(lead)
        if lead.assignee:
            row["assignee"] = {
                "id": lead.assignee.id,
                "name": lead.assignee.name,
                "email": lead.assignee.email,
            }
        items.append(row)
    # `sort` is echoed back so the model can state on what basis a row is the
    # "latest" one, instead of inferring an order the payload never stated.
    return {
        "items": items,
        "count": len(items),
        "total": total,
        "sort": sort_key if sort_key in LEAD_SORTS else DEFAULT_LEAD_SORT,
        "ordered_by": order,
    }


def _enum_name(value: Any) -> str:
    return value.name if hasattr(value, "name") else str(value)


async def _group_count(*, field: str, where: dict[str, Any]) -> dict[str, int]:
    """Count rows per distinct value of `field`, in the database.

    Grouping in SQL rather than pulling every row: an org with tens of
    thousands of leads would otherwise load all of them just to tally two
    columns, on a call that runs at the top of every AI turn.
    """
    rows = await prisma.lead.group_by(by=[field], where=where, count=True)
    counts: dict[str, int] = {}
    for row in rows or []:
        key = _enum_name(row.get(field))
        tally = row.get("_count") or {}
        counts[key] = int(tally.get("_all") or 0)
    return counts


async def count_leads(*, organization_id: str) -> dict[str, Any]:
    """Organisation-wide lead totals. Use this for 'how many leads' — not search_leads."""
    where: dict[str, Any] = {"organizationId": organization_id}
    total = await prisma.lead.count(where=where)
    by_stage = await _group_count(field="stage", where=where)
    by_status = await _group_count(field="leadStatus", where=where)
    return {"total": total, "by_status": by_status, "by_stage": by_stage}


async def list_follow_ups(
    *, organization_id: str, limit: int = 50
) -> dict[str, Any]:
    """Leads awaiting a follow-up, defined exactly as the Follow-ups screen does.

    The screen calls /leads?last_call_outcome=CALLBACK_SCHEDULED — a follow-up is
    a lead whose *most recent* call ended in a scheduled callback. That is not
    the same as nextFollowUpAt being set, and the two disagree in practice: this
    org has one lead on the Follow-ups page and zero with nextFollowUpAt. The
    agent used to have neither notion available and answered "no follow-ups"
    while the screen listed one, so this deliberately mirrors the screen rather
    than inventing a third definition. Both fields are returned per row so the
    agent can talk about the date when there is one.
    """
    leads = await prisma.lead.find_many(
        where={"organizationId": organization_id},
        order={"updatedAt": "desc"},
        include={"assignee": True},
    )
    if not leads:
        return {"items": [], "count": 0, "total": 0, "buckets": {}, "definition": _FOLLOW_UP_DEFINITION}

    calls = await prisma.telecallercalllog.find_many(
        where={
            "organizationId": organization_id,
            "leadId": {"in": [lead.id for lead in leads]},
        },
        order={"createdAt": "desc"},
        include={"user": True},
    )
    latest: dict[str, Any] = {}
    for call in calls:
        if call.leadId not in latest:
            latest[call.leadId] = call

    now = datetime.now(timezone.utc)
    items: list[dict[str, Any]] = []
    buckets = {
        "overdue": 0,
        "due_now": 0,
        "later_today": 0,
        "today": 0,
        "upcoming": 0,
        "unscheduled": 0,
    }

    from loomrun_api.follow_up_reminders import follow_up_bucket

    for lead in leads:
        call = latest.get(lead.id)
        if not call or _enum_name(call.outcome) != "CALLBACK_SCHEDULED":
            continue
        due = lead.nextFollowUpAt
        bucket = follow_up_bucket(due, now=now)
        # Keep legacy "today" count for callers that expect it
        if bucket in ("due_now", "later_today"):
            buckets["today"] += 1
        buckets[bucket] = buckets.get(bucket, 0) + 1
        row = serialize_lead(lead, with_last_call=True, last_call=call)
        row["follow_up_bucket"] = bucket
        if lead.assignee:
            row["assignee"] = {
                "id": lead.assignee.id,
                "name": lead.assignee.name,
                "email": lead.assignee.email,
            }
        items.append(row)

    total = len(items)
    return {
        "items": items[: max(1, min(int(limit or 50), 100))],
        "count": min(total, max(1, min(int(limit or 50), 100))),
        "total": total,
        "buckets": buckets,
        "definition": _FOLLOW_UP_DEFINITION,
    }


async def get_lead(*, organization_id: str, lead_id: str) -> dict[str, Any]:
    resolved = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
    lead = await prisma.lead.find_first(
        where={"id": resolved.id, "organizationId": organization_id},
        include={
            "activities": {"order_by": {"createdAt": "desc"}, "take": 20},
            "assignee": True,
            "pipeline": True,
            "pipelineStage": True,
        },
    )
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    activities = [
        {
            "id": a.id,
            "type": a.type.name if hasattr(a.type, "name") else str(a.type),
            "body": a.body,
            "user_id": a.userId,
            "created_at": a.createdAt.isoformat(),
        }
        for a in (lead.activities or [])
    ]
    assignee = None
    if lead.assignee:
        assignee = {"id": lead.assignee.id, "name": lead.assignee.name, "email": lead.assignee.email}
    last_call = await prisma.telecallercalllog.find_first(
        where={"organizationId": organization_id, "leadId": lead.id},
        order={"createdAt": "desc"},
        include={"user": True},
    )
    return {
        **serialize_lead(lead, with_last_call=True, last_call=last_call),
        "activities": activities,
        "assignee": assignee,
    }


async def create_lead(
    *,
    organization_id: str,
    user_id: str,
    title: str,
    source: LeadSource | str = LeadSource.OTHER,
    stage: LeadStage | str = LeadStage.NEW,
    company: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    city: str | None = None,
    source_detail: str | None = None,
    product_interest: str | None = None,
    quantity_estimate: str | None = None,
    tags: list[str] | None = None,
    notes: str | None = None,
    assignee_id: str | None = None,
    next_follow_up_at: datetime | None = None,
    estimated_value: float | None = None,
    region: str | None = None,
    sector: str | None = None,
    campaign_id: str | None = None,
    campaign_name: str | None = None,
    pipeline_id: str | None = None,
    pipeline_stage_id: str | None = None,
    meta_campaign_id: str | None = None,
    meta_campaign_name: str | None = None,
    organization=None,
    activity_body: str = "Lead created",
    activity_metadata: dict | None = None,
) -> dict[str, Any]:
    from loomrun_api.entitlements import get_org_entitlements
    from loomrun_api.pipeline_routing import merge_pipeline_into_create_data

    org = organization or await prisma.organization.find_unique(where={"id": organization_id})
    if org:
        ents = get_org_entitlements(org)
        if ents.max_leads is not None:
            lead_count = await prisma.lead.count(where={"organizationId": organization_id})
            if lead_count >= ents.max_leads:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"Lead limit reached ({ents.max_leads} on your plan). "
                        "Upgrade to Growth or Scale for unlimited leads."
                    ),
                )

    if isinstance(source, str):
        source = LeadSource[source] if source in LeadSource.__members__ else LeadSource.OTHER
    if isinstance(stage, str):
        stage = LeadStage[stage]

    await _assert_assignee_in_org(organization_id, assignee_id)

    # Prefer normalized campaign fields; fall back to Meta mirrors when only those are set.
    resolved_campaign_id = (campaign_id or meta_campaign_id or "").strip() or None
    resolved_campaign_name = (campaign_name or meta_campaign_name or "").strip() or None

    score = compute_lead_score(source, phone, email, product_interest, city)
    data: dict = {
        "organizationId": organization_id,
        "title": title,
        "source": source,
        "stage": stage,
        "company": company,
        "phone": phone,
        "email": email,
        "city": city,
        "sourceDetail": source_detail,
        "productInterest": product_interest,
        "quantityEstimate": quantity_estimate,
        "leadScore": score,
        "tags": tags or [],
        "notes": notes,
        "assigneeId": assignee_id,
        "nextFollowUpAt": next_follow_up_at,
        "lastActivityAt": datetime.utcnow(),
        "region": (region or "").strip() or None,
        "sector": (sector or "").strip() or None,
        "campaignId": resolved_campaign_id,
        "campaignName": resolved_campaign_name,
    }
    if estimated_value is not None:
        data["estimatedValue"] = estimated_value
    if meta_campaign_id is not None:
        data["metaCampaignId"] = meta_campaign_id
    if meta_campaign_name is not None:
        data["metaCampaignName"] = meta_campaign_name
    if pipeline_id:
        data["pipelineId"] = pipeline_id
    if pipeline_stage_id:
        data["pipelineStageId"] = pipeline_stage_id

    data = await merge_pipeline_into_create_data(data, organization_id=organization_id)

    lead = await prisma.lead.create(data=data)
    act_data: dict = {
        "leadId": lead.id,
        "userId": user_id,
        "type": LeadActivityType.SYSTEM,
        "body": activity_body,
    }
    if activity_metadata is not None:
        act_data["metadata"] = json_meta(activity_metadata)
    await prisma.leadactivity.create(data=act_data)

    asyncio.create_task(_delayed_auto_call(lead.id, organization_id))
    schedule_greeting(organization_id, lead.id)
    org_events.emit(
        organization_id,
        "lead.created",
        {"lead": serialize_lead(lead)},
        entity_type=org_events.qlix_docs.ENTITY_LEAD,
        entity_id=lead.id,
    )

    return serialize_lead(lead)


async def update_lead(
    *,
    organization_id: str,
    user_id: str,
    lead_id: str,
    title: str | None = None,
    source: LeadSource | str | None = None,
    stage: LeadStage | str | None = None,
    lead_status: LeadStatus | str | None = None,
    company: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    city: str | None = None,
    source_detail: str | None = None,
    product_interest: str | None = None,
    quantity_estimate: str | None = None,
    tags: list[str] | None = None,
    notes: str | None = None,
    assignee_id: str | None = None,
    next_follow_up_at: datetime | None = None,
    estimated_value: float | None = None,
    region: str | None = None,
    sector: str | None = None,
    campaign_id: str | None = None,
    campaign_name: str | None = None,
    pipeline_id: str | None = None,
    pipeline_stage_id: str | None = None,
    reroute: bool = False,
    activity_source: str | None = None,
) -> dict[str, Any]:
    from loomrun_api.pipeline_routing import (
        assignment_fields,
        lead_status_for_kind,
        legacy_stage_from_pipeline_stage,
    )

    lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
    lead_id = lead.id

    if isinstance(source, str):
        source = LeadSource[source]
    if isinstance(stage, str):
        stage = LeadStage[stage]
    if isinstance(lead_status, str):
        lead_status = LeadStatus[lead_status]

    if assignee_id is not None:
        await _assert_assignee_in_org(organization_id, assignee_id)

    update_data: dict = {"lastActivityAt": datetime.utcnow()}
    previous_stage = lead.stage.name if hasattr(lead.stage, "name") else str(lead.stage)
    stage_changed = False
    pipeline_moved = False
    meta_extra = {"source": activity_source} if activity_source else None
    old_pipeline_id = getattr(lead, "pipelineId", None)
    old_pipeline_stage_id = getattr(lead, "pipelineStageId", None)

    if title is not None:
        update_data["title"] = title
    if source is not None:
        update_data["source"] = source
    if company is not None:
        update_data["company"] = company
    if phone is not None:
        update_data["phone"] = phone
    if email is not None:
        update_data["email"] = email
    if city is not None:
        update_data["city"] = city
    if source_detail is not None:
        update_data["sourceDetail"] = source_detail
    if product_interest is not None:
        update_data["productInterest"] = product_interest
        update_data["leadScore"] = compute_lead_score(
            source if source is not None else lead.source,
            phone if phone is not None else lead.phone,
            email if email is not None else lead.email,
            product_interest,
            city if city is not None else lead.city,
        )
    if quantity_estimate is not None:
        update_data["quantityEstimate"] = quantity_estimate
    if tags is not None:
        update_data["tags"] = tags
    if notes is not None:
        update_data["notes"] = notes
    if assignee_id is not None:
        update_data["assigneeId"] = assignee_id
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.ASSIGNMENT,
                "body": "Assignee updated",
                "metadata": json_meta({"assignee_id": assignee_id, **(meta_extra or {})}),
            }
        )
    if next_follow_up_at is not None:
        update_data["nextFollowUpAt"] = next_follow_up_at
        update_data["followUpRemindedAt"] = None
        update_data["followUpWaRemindedAt"] = None
    if estimated_value is not None:
        update_data["estimatedValue"] = estimated_value
    if region is not None:
        update_data["region"] = region.strip() or None
    if sector is not None:
        update_data["sector"] = sector.strip() or None
    if campaign_id is not None:
        update_data["campaignId"] = str(campaign_id).strip() or None
    if campaign_name is not None:
        update_data["campaignName"] = campaign_name.strip() or None

    # Explicit pipeline/stage move (manual) — no silent attribute reroute.
    if pipeline_id is not None or pipeline_stage_id is not None:
        target_pipeline_id = pipeline_id or old_pipeline_id
        if not target_pipeline_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="pipeline_id is required")
        pipeline = await prisma.pipeline.find_first(
            where={
                "id": target_pipeline_id,
                "organizationId": organization_id,
                "isActive": True,
            },
            include={"stages": {"order_by": {"sortOrder": "asc"}}},
        )
        if not pipeline:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Pipeline not found or archived")
        target_stage = None
        if pipeline_stage_id:
            target_stage = next((s for s in (pipeline.stages or []) if s.id == pipeline_stage_id), None)
            if not target_stage:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail="pipeline_stage_id is not in the target pipeline",
                )
        else:
            from loomrun_api.pipeline_routing import entry_stage

            target_stage = entry_stage(pipeline)
        if not target_stage:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Pipeline has no stages")
        if target_pipeline_id != old_pipeline_id or target_stage.id != old_pipeline_stage_id:
            update_data["pipelineId"] = pipeline.id
            update_data["pipelineStageId"] = target_stage.id
            update_data["stage"] = legacy_stage_from_pipeline_stage(target_stage)
            status_val = lead_status_for_kind(target_stage.kind)
            if status_val is not None and lead_status is None:
                update_data["leadStatus"] = status_val
            pipeline_moved = True
            stage_changed = True

    # Legacy stage update: sync into current pipeline's matching systemKey stage when possible.
    elif stage is not None and stage != lead.stage:
        stage_name = stage.name if hasattr(stage, "name") else str(stage)
        update_data["stage"] = stage
        stage_changed = True
        pipeline = None
        if old_pipeline_id:
            pipeline = await prisma.pipeline.find_unique(
                where={"id": old_pipeline_id},
                include={"stages": {"order_by": {"sortOrder": "asc"}}},
            )
        if pipeline:
            from loomrun_api.pipeline_routing import stage_for_system_key

            mapped = stage_for_system_key(pipeline, stage_name)
            if mapped:
                update_data["pipelineStageId"] = mapped.id
                status_val = lead_status_for_kind(mapped.kind)
                if status_val is not None and lead_status is None:
                    update_data["leadStatus"] = status_val
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.STAGE_CHANGE,
                "body": f"Stage changed to {stage_name}",
                "metadata": json_meta({"stage": stage_name, **(meta_extra or {})}),
            }
        )

    if lead_status is not None:
        update_data["leadStatus"] = lead_status

    # Explicit reroute only — never silent when attributes change.
    if reroute and pipeline_id is None and pipeline_stage_id is None:
        routed = await assignment_fields(
            organization_id=organization_id,
            source=source if source is not None else lead.source,
            campaign_id=(
                update_data.get("campaignId")
                if "campaignId" in update_data
                else getattr(lead, "campaignId", None)
            ),
            campaign_name=(
                update_data.get("campaignName")
                if "campaignName" in update_data
                else getattr(lead, "campaignName", None)
            ),
            region=update_data.get("region") if "region" in update_data else getattr(lead, "region", None),
            product_interest=(
                update_data.get("productInterest")
                if "productInterest" in update_data
                else lead.productInterest
            ),
            sector=update_data.get("sector") if "sector" in update_data else getattr(lead, "sector", None),
        )
        new_pid = routed.get("pipelineId")
        new_sid = routed.get("pipelineStageId")
        if new_pid and new_sid and (new_pid != old_pipeline_id or new_sid != old_pipeline_stage_id):
            update_data["pipelineId"] = new_pid
            update_data["pipelineStageId"] = new_sid
            if "stage" in routed:
                update_data["stage"] = routed["stage"]
            if "leadStatus" in routed and lead_status is None:
                update_data["leadStatus"] = routed["leadStatus"]
            pipeline_moved = True
            stage_changed = True

    # Unassigned leads: assign pipeline on update if still missing.
    if not old_pipeline_id and "pipelineId" not in update_data:
        routed = await assignment_fields(
            organization_id=organization_id,
            source=source if source is not None else lead.source,
            campaign_id=(
                update_data.get("campaignId")
                if "campaignId" in update_data
                else getattr(lead, "campaignId", None)
            ),
            campaign_name=(
                update_data.get("campaignName")
                if "campaignName" in update_data
                else getattr(lead, "campaignName", None)
            ),
            region=update_data.get("region") if "region" in update_data else getattr(lead, "region", None),
            product_interest=(
                update_data.get("productInterest")
                if "productInterest" in update_data
                else lead.productInterest
            ),
            sector=update_data.get("sector") if "sector" in update_data else getattr(lead, "sector", None),
            prefer_system_key=stage if stage is not None else lead.stage,
        )
        for key in ("pipelineId", "pipelineStageId", "stage", "leadStatus"):
            if key in routed and key not in update_data:
                update_data[key] = routed[key]
        if routed.get("pipelineId"):
            pipeline_moved = True

    updated = await prisma.lead.update(where={"id": lead_id}, data=update_data)

    if pipeline_moved:
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.STAGE_CHANGE,
                "body": "Pipeline updated" if reroute else "Moved to pipeline stage",
                "metadata": json_meta(
                    {
                        "from_pipeline_id": old_pipeline_id,
                        "from_pipeline_stage_id": old_pipeline_stage_id,
                        "to_pipeline_id": getattr(updated, "pipelineId", None),
                        "to_pipeline_stage_id": getattr(updated, "pipelineStageId", None),
                        "reroute": bool(reroute),
                        **(meta_extra or {}),
                    }
                ),
            }
        )

    org_events.record_changed(
        organization_id=organization_id,
        entity_type=org_events.qlix_docs.ENTITY_LEAD,
        entity_id=lead_id,
    )
    if stage_changed:
        new_stage = updated.stage.name if hasattr(updated.stage, "name") else str(updated.stage)
        _emit_n8n(
            organization_id,
            "lead.stage_changed",
            {
                "lead": serialize_lead(updated),
                "from_stage": previous_stage,
                "to_stage": new_stage,
            },
        )
    return serialize_lead(updated)


async def import_parsed_leads(
    *,
    organization_id: str,
    user_id: str,
    parsed: list[dict[str, Any]],
    organization=None,
) -> dict[str, Any]:
    """Create historical leads from a CSV parse. Skips greetings, auto-calls and n8n.

    Duplicate phone (last 10 digits) or email within the org is skipped so a
    re-upload does not clone the same people.
    """
    from loomrun_api.entitlements import get_org_entitlements
    from loomrun_api.leads_csv import phone_dedupe_key

    org = organization or await prisma.organization.find_unique(where={"id": organization_id})
    max_leads = None
    remaining = None
    if org:
        ents = get_org_entitlements(org)
        max_leads = ents.max_leads
        if max_leads is not None:
            lead_count = await prisma.lead.count(where={"organizationId": organization_id})
            remaining = max(0, max_leads - lead_count)

    existing = await prisma.lead.find_many(
        where={"organizationId": organization_id},
        select={"phone": True, "email": True},
    )
    seen_phones: set[str] = set()
    seen_emails: set[str] = set()
    for lead in existing:
        key = phone_dedupe_key(lead.phone)
        if key:
            seen_phones.add(key)
        if lead.email:
            seen_emails.add(lead.email.strip().lower())

    created = 0
    skipped = 0
    errors: list[str] = []
    skipped_limit = False

    for item in parsed:
        if remaining is not None and created >= remaining:
            skipped_limit = True
            skipped += 1
            continue

        phone_key = phone_dedupe_key(item.get("phone"))
        email_key = (item.get("email") or "").strip().lower() or None
        if phone_key and phone_key in seen_phones:
            skipped += 1
            continue
        if email_key and email_key in seen_emails:
            skipped += 1
            continue

        stage_key = item.get("stage") or "NEW"
        if stage_key not in LeadStage.__members__:
            stage_key = "NEW"
        source_key = item.get("source") or "OTHER"
        if source_key not in LeadSource.__members__:
            source_key = "OTHER"
        stage = LeadStage[stage_key]
        source = LeadSource[source_key]
        lead_status = LeadStatus.ACTIVE
        if stage_key == "WON":
            lead_status = LeadStatus.WON
        elif stage_key == "LOST":
            lead_status = LeadStatus.LOST

        phone = item.get("phone")
        email = item.get("email")
        product_interest = item.get("product_interest")
        city = item.get("city")
        score = compute_lead_score(source, phone, email, product_interest, city)
        data: dict = {
            "organizationId": organization_id,
            "title": item["title"],
            "source": source,
            "stage": stage,
            "leadStatus": lead_status,
            "company": item.get("company"),
            "phone": phone,
            "email": email,
            "city": city,
            "sourceDetail": "CSV import",
            "productInterest": product_interest,
            "quantityEstimate": item.get("quantity_estimate"),
            "leadScore": score,
            "tags": item.get("tags") or ["csv-import"],
            "notes": item.get("notes"),
            "lastActivityAt": datetime.utcnow(),
            "region": (item.get("region") or "").strip() or None,
            "sector": (item.get("sector") or "").strip() or None,
            "campaignId": (str(item["campaign_id"]).strip() if item.get("campaign_id") else None),
            "campaignName": (item.get("campaign_name") or "").strip() or None,
        }
        if item.get("estimated_value") is not None:
            data["estimatedValue"] = item["estimated_value"]
        if item.get("created_at") is not None:
            data["createdAt"] = item["created_at"]

        from loomrun_api.pipeline_routing import merge_pipeline_into_create_data

        try:
            data = await merge_pipeline_into_create_data(data, organization_id=organization_id)
            lead = await prisma.lead.create(data=data)
            await prisma.leadactivity.create(
                data={
                    "leadId": lead.id,
                    "userId": user_id,
                    "type": LeadActivityType.SYSTEM,
                    "body": "Imported from CSV",
                    "metadata": json_meta({"source": "csv", "row": item.get("row")}),
                }
            )
            org_events.record_changed(
                organization_id=organization_id,
                entity_type=org_events.qlix_docs.ENTITY_LEAD,
                entity_id=lead.id,
            )
        except Exception as e:
            errors.append(f"Row {item.get('row', '?')}: could not save '{item.get('title', '?')}': {e}")
            continue

        created += 1
        if phone_key:
            seen_phones.add(phone_key)
        if email_key:
            seen_emails.add(email_key)

    if skipped_limit:
        errors.append(
            f"Lead limit reached ({max_leads} on your plan). "
            f"{created} imported; remaining rows were skipped. Upgrade for unlimited leads."
        )

    return {"created": created, "skipped": skipped, "errors": errors}
