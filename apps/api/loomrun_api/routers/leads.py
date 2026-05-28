import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from loomrun_api.config import settings
from loomrun_api.date_filter import apply_created_at
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from prisma.enums import LeadActivityType, LeadSource, LeadStage, LeadStatus

router = APIRouter()

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


def _compute_lead_score(source, phone: str | None, email: str | None, product_interest: str | None, city: str | None) -> int:
    src = source.name if hasattr(source, "name") else str(source)
    score = SOURCE_SCORES.get(src, 10)
    if phone and email:
        score += 15
    if product_interest:
        score += 10
    if city:
        score += 5
    return min(score, 100)


def _call_summary_fields(call) -> dict:
    if not call:
        return {"last_call_outcome": None, "last_call_logged_by": None}
    outcome = call.outcome.name if hasattr(call.outcome, "name") else str(call.outcome)
    user = getattr(call, "user", None)
    logged_by = None
    if user:
        logged_by = (user.name.strip() if user.name else None) or user.email
    elif call.callSource == "AI_AUTO":
        logged_by = "AI Auto-Call"
    return {"last_call_outcome": outcome, "last_call_logged_by": logged_by}


async def _latest_calls_by_lead(organization_id: str, lead_ids: list[str]) -> dict:
    if not lead_ids:
        return {}
    calls = await prisma.telecallercalllog.find_many(
        where={"organizationId": organization_id, "leadId": {"in": lead_ids}},
        order={"createdAt": "desc"},
        include={"user": True},
    )
    latest: dict = {}
    for call in calls:
        if call.leadId not in latest:
            latest[call.leadId] = call
    return latest


def _serialize_lead(lead, *, with_last_call: bool = False, last_call=None) -> dict:
    data = {
        "id": lead.id,
        "organization_id": lead.organizationId,
        "source": lead.source.name if hasattr(lead.source, "name") else str(lead.source),
        "stage": lead.stage.name if hasattr(lead.stage, "name") else str(lead.stage),
        "lead_status": lead.leadStatus.name if hasattr(lead.leadStatus, "name") else str(lead.leadStatus),
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
        "next_follow_up_at": lead.nextFollowUpAt.isoformat() if lead.nextFollowUpAt else None,
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
    if with_last_call:
        data.update(_call_summary_fields(last_call))
    return data


class LeadCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    source: LeadSource = LeadSource.OTHER
    stage: LeadStage = LeadStage.NEW
    company: str | None = None
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    source_detail: str | None = None
    product_interest: str | None = None
    quantity_estimate: str | None = None
    tags: list[str] = []
    notes: str | None = None
    assignee_id: str | None = None
    next_follow_up_at: datetime | None = None
    estimated_value: float | None = None


class LeadUpdate(BaseModel):
    title: str | None = None
    source: LeadSource | None = None
    stage: LeadStage | None = None
    lead_status: LeadStatus | None = None
    company: str | None = None
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    source_detail: str | None = None
    product_interest: str | None = None
    quantity_estimate: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    assignee_id: str | None = None
    next_follow_up_at: datetime | None = None
    estimated_value: float | None = None


class ActivityCreate(BaseModel):
    type: LeadActivityType = LeadActivityType.NOTE
    body: str = Field(min_length=1)
    metadata: dict | None = None


class LeadIngestPayload(BaseModel):
    source: str
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    product_interest: str | None = None
    quantity_estimate: str | None = None
    campaign: str | None = None
    ad_id: str | None = None
    notes: str | None = None


def _normalize_source(src: str) -> LeadSource:
    mapping = {
        "meta": LeadSource.META_ADS,
        "meta_ads": LeadSource.META_ADS,
        "facebook": LeadSource.META_ADS,
        "instagram": LeadSource.INSTAGRAM,
        "google": LeadSource.GOOGLE_ADS,
        "google_ads": LeadSource.GOOGLE_ADS,
        "indiamart": LeadSource.INDIAMART,
        "whatsapp": LeadSource.WHATSAPP,
        "website": LeadSource.WEBSITE,
        "web": LeadSource.WEB,
        "manual": LeadSource.MANUAL,
        "referral": LeadSource.REFERRAL,
        "telecaller": LeadSource.TELECALLER,
    }
    return mapping.get(src.lower().replace(" ", "_"), LeadSource.OTHER)


@router.get("/orgs/{org_id}/leads/meta-campaigns")
async def list_meta_campaigns(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    leads = await prisma.lead.find_many(
        where={"organizationId": ctx.organization_id, "source": LeadSource.META_ADS, "metaCampaignId": {"not": None}},
        order={"createdAt": "desc"},
    )
    campaigns: dict[str, dict] = {}
    for lead in leads:
        cid = lead.metaCampaignId or "unknown"
        if cid not in campaigns:
            campaigns[cid] = {
                "campaign_id": cid,
                "campaign_name": lead.metaCampaignName or cid,
                "leads_count": 0,
                "adsets": {},
            }
        campaigns[cid]["leads_count"] += 1
        adset_id = lead.metaAdsetId or "unknown"
        adsets = campaigns[cid]["adsets"]
        if adset_id not in adsets:
            adsets[adset_id] = {
                "adset_id": adset_id,
                "adset_name": lead.metaAdsetName or adset_id,
                "leads_count": 0,
            }
        adsets[adset_id]["leads_count"] += 1

    result = []
    for c in campaigns.values():
        result.append({**c, "adsets": list(c["adsets"].values())})
    return {"items": result}


@router.get("/orgs/{org_id}/leads")
async def list_leads(
    org_id: str,
    stage: LeadStage | None = Query(None),
    source: LeadSource | None = Query(None),
    assignee_id: str | None = Query(None),
    lead_status: LeadStatus | None = Query(None),
    score_min: int | None = Query(None),
    score_max: int | None = Query(None),
    search: str | None = Query(None),
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    campaign_id: str | None = Query(None, description="Filter by Meta campaign ID"),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    apply_created_at(where, day)
    if stage is not None:
        where["stage"] = stage
    if source is not None:
        where["source"] = source
    if assignee_id is not None:
        where["assigneeId"] = assignee_id
    if lead_status is not None:
        where["leadStatus"] = lead_status
    if score_min is not None:
        where["leadScore"] = {**(where.get("leadScore") or {}), "gte": score_min}
    if score_max is not None:
        where["leadScore"] = {**(where.get("leadScore") or {}), "lte": score_max}
    if search:
        where["OR"] = [
            {"title": {"contains": search, "mode": "insensitive"}},
            {"phone": {"contains": search, "mode": "insensitive"}},
            {"company": {"contains": search, "mode": "insensitive"}},
            {"email": {"contains": search, "mode": "insensitive"}},
        ]
    if campaign_id is not None:
        where["metaCampaignId"] = campaign_id
    leads = await prisma.lead.find_many(where=where, order={"updatedAt": "desc"})
    latest_calls = await _latest_calls_by_lead(ctx.organization_id, [lead.id for lead in leads])
    return {
        "items": [
            _serialize_lead(lead, with_last_call=True, last_call=latest_calls.get(lead.id))
            for lead in leads
        ]
    }


async def _delayed_auto_call(lead_id: str, org_id: str) -> None:
    await asyncio.sleep(300)
    try:
        from loomrun_api.workers import check_lead_call_needed
        await check_lead_call_needed({}, lead_id, org_id)
    except Exception:
        pass


@router.post("/orgs/{org_id}/leads", status_code=status.HTTP_201_CREATED)
async def create_lead(org_id: str, body: LeadCreate, ctx: OrgContext = Depends(get_org_context)) -> dict:
    score = _compute_lead_score(body.source, body.phone, body.email, body.product_interest, body.city)
    data: dict = {
        "organizationId": ctx.organization_id,
        "title": body.title,
        "source": body.source,
        "stage": body.stage,
        "company": body.company,
        "phone": body.phone,
        "email": body.email,
        "city": body.city,
        "sourceDetail": body.source_detail,
        "productInterest": body.product_interest,
        "quantityEstimate": body.quantity_estimate,
        "leadScore": score,
        "tags": body.tags,
        "notes": body.notes,
        "assigneeId": body.assignee_id,
        "nextFollowUpAt": body.next_follow_up_at,
        "lastActivityAt": datetime.utcnow(),
    }
    if body.estimated_value is not None:
        data["estimatedValue"] = body.estimated_value
    lead = await prisma.lead.create(data=data)
    await prisma.leadactivity.create(
        data={
            "leadId": lead.id,
            "userId": ctx.membership.userId,
            "type": LeadActivityType.SYSTEM,
            "body": "Lead created",
        }
    )

    asyncio.create_task(_delayed_auto_call(lead.id, ctx.organization_id))

    return _serialize_lead(lead)


@router.post("/orgs/{org_id}/leads/ingest", status_code=status.HTTP_201_CREATED)
async def ingest_lead(org_id: str, body: LeadIngestPayload, ctx: OrgContext = Depends(get_org_context)) -> dict:
    source = _normalize_source(body.source)

    # Deduplicate by phone then email
    existing = None
    if body.phone:
        existing = await prisma.lead.find_first(
            where={"organizationId": ctx.organization_id, "phone": body.phone}
        )
    if not existing and body.email:
        existing = await prisma.lead.find_first(
            where={"organizationId": ctx.organization_id, "email": body.email}
        )

    if existing:
        src_name = source.name if hasattr(source, "name") else str(source)
        note = f"New inquiry via {SOURCE_LABELS.get(src_name, body.source)}"
        if body.campaign:
            note += f" · Campaign: {body.campaign}"
        await prisma.leadactivity.create(
            data={
                "leadId": existing.id,
                "type": LeadActivityType.SYSTEM,
                "body": note,
                "metadata": json_meta({"source": src_name, "campaign": body.campaign, "ad_id": body.ad_id}),
            }
        )
        await prisma.lead.update(
            where={"id": existing.id},
            data={"lastActivityAt": datetime.utcnow()},
        )
        return {**_serialize_lead(existing), "duplicate": True}

    score = _compute_lead_score(source, body.phone, body.email, body.product_interest, body.city)
    parts = []
    if body.campaign:
        parts.append(f"campaign:{body.campaign}")
    if body.ad_id:
        parts.append(f"ad:{body.ad_id}")
    source_detail = ", ".join(parts) if parts else None

    lead = await prisma.lead.create(
        data={
            "organizationId": ctx.organization_id,
            "title": body.name or f"Lead via {SOURCE_LABELS.get(source.name if hasattr(source, 'name') else str(source), body.source)}",
            "source": source,
            "phone": body.phone,
            "email": body.email,
            "city": body.city,
            "productInterest": body.product_interest,
            "quantityEstimate": body.quantity_estimate,
            "leadScore": score,
            "sourceDetail": source_detail,
            "notes": body.notes,
            "tags": [],
            "lastActivityAt": datetime.utcnow(),
        }
    )
    await prisma.leadactivity.create(
        data={
            "leadId": lead.id,
            "type": LeadActivityType.SYSTEM,
            "body": "Lead ingested",
            "metadata": json_meta(
                {
                    "source": source.name if hasattr(source, "name") else str(source),
                    "campaign": body.campaign,
                    "ad_id": body.ad_id,
                }
            ),
        }
    )
    return {**_serialize_lead(lead), "duplicate": False}


@router.get("/orgs/{org_id}/leads/{lead_id}")
async def get_lead(org_id: str, lead_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    lead = await prisma.lead.find_first(
        where={"id": lead_id, "organizationId": ctx.organization_id},
        include={"activities": {"order_by": {"createdAt": "desc"}, "take": 100}, "assignee": True},
    )
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    activities = [
        {
            "id": a.id,
            "type": a.type.name if hasattr(a.type, "name") else str(a.type),
            "body": a.body,
            "user_id": a.userId,
            "metadata": a.metadata,
            "created_at": a.createdAt.isoformat(),
        }
        for a in (lead.activities or [])
    ]
    assignee = None
    if lead.assignee:
        assignee = {"id": lead.assignee.id, "name": lead.assignee.name, "email": lead.assignee.email}
    return {**_serialize_lead(lead), "activities": activities, "assignee": assignee}


@router.patch("/orgs/{org_id}/leads/{lead_id}")
async def update_lead(
    org_id: str, lead_id: str, body: LeadUpdate, ctx: OrgContext = Depends(get_org_context)
) -> dict:
    lead = await prisma.lead.find_first(where={"id": lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    update_data: dict = {"lastActivityAt": datetime.utcnow()}
    if body.title is not None:
        update_data["title"] = body.title
    if body.source is not None:
        update_data["source"] = body.source
    if body.stage is not None and body.stage != lead.stage:
        stage_name = body.stage.name if hasattr(body.stage, "name") else str(body.stage)
        update_data["stage"] = body.stage
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": ctx.membership.userId,
                "type": LeadActivityType.STAGE_CHANGE,
                "body": f"Stage changed to {stage_name}",
                "metadata": json_meta({"stage": stage_name}),
            }
        )
    if body.lead_status is not None:
        update_data["leadStatus"] = body.lead_status
    if body.company is not None:
        update_data["company"] = body.company
    if body.phone is not None:
        update_data["phone"] = body.phone
    if body.email is not None:
        update_data["email"] = body.email
    if body.city is not None:
        update_data["city"] = body.city
    if body.source_detail is not None:
        update_data["sourceDetail"] = body.source_detail
    if body.product_interest is not None:
        update_data["productInterest"] = body.product_interest
        # Recalculate score
        update_data["leadScore"] = _compute_lead_score(
            lead.source,
            body.phone or lead.phone,
            body.email or lead.email,
            body.product_interest,
            body.city or lead.city,
        )
    if body.quantity_estimate is not None:
        update_data["quantityEstimate"] = body.quantity_estimate
    if body.tags is not None:
        update_data["tags"] = body.tags
    if body.notes is not None:
        update_data["notes"] = body.notes
    if body.assignee_id is not None:
        update_data["assigneeId"] = body.assignee_id
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": ctx.membership.userId,
                "type": LeadActivityType.ASSIGNMENT,
                "body": "Assignee updated",
                "metadata": json_meta({"assignee_id": body.assignee_id}),
            }
        )
    if body.next_follow_up_at is not None:
        update_data["nextFollowUpAt"] = body.next_follow_up_at
    if body.estimated_value is not None:
        update_data["estimatedValue"] = body.estimated_value
    updated = await prisma.lead.update(where={"id": lead_id}, data=update_data)
    return _serialize_lead(updated)


@router.delete("/orgs/{org_id}/leads/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(org_id: str, lead_id: str, ctx: OrgContext = Depends(get_org_context)) -> None:
    lead = await prisma.lead.find_first(where={"id": lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await prisma.lead.delete(where={"id": lead_id})


@router.post("/orgs/{org_id}/leads/{lead_id}/activities", status_code=status.HTTP_201_CREATED)
async def add_activity(
    org_id: str, lead_id: str, body: ActivityCreate, ctx: OrgContext = Depends(get_org_context)
) -> dict:
    lead = await prisma.lead.find_first(where={"id": lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    activity_data: dict = {
        "leadId": lead_id,
        "userId": ctx.membership.userId,
        "type": body.type,
        "body": body.body,
    }
    if body.metadata is not None:
        activity_data["metadata"] = json_meta(body.metadata)
    act = await prisma.leadactivity.create(data=activity_data)
    await prisma.lead.update(
        where={"id": lead_id},
        data={"lastActivityAt": datetime.utcnow()},
    )
    return {
        "id": act.id,
        "type": act.type.name if hasattr(act.type, "name") else str(act.type),
        "body": act.body,
        "user_id": act.userId,
        "created_at": act.createdAt.isoformat(),
    }
