import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from loomrun_api.date_filter import apply_created_at
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api import org_events
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.services import leads as lead_svc
from prisma.enums import CallOutcome, LeadActivityType, LeadSource, LeadStage, LeadStatus


def _outcome_name(val) -> str:
    return val.name if hasattr(val, "name") else str(val)

router = APIRouter()

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


def _emit_n8n(org_id: str, event: str, data: dict) -> None:
    from loomrun_api.n8n_events import emit_automation_event

    asyncio.create_task(emit_automation_event(org_id, event, data))


def _compute_lead_score(source, phone: str | None, email: str | None, product_interest: str | None, city: str | None) -> int:
    return lead_svc.compute_lead_score(source, phone, email, product_interest, city)


def _call_summary_fields(call) -> dict:
    return lead_svc.call_summary_fields(call)


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
    return lead_svc.serialize_lead(lead, with_last_call=with_last_call, last_call=last_call)


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
    region: str | None = None
    sector: str | None = None
    campaign_id: str | None = None
    campaign_name: str | None = None
    pipeline_id: str | None = None
    pipeline_stage_id: str | None = None


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
    region: str | None = None
    sector: str | None = None
    campaign_id: str | None = None
    campaign_name: str | None = None
    pipeline_id: str | None = None
    pipeline_stage_id: str | None = None
    reroute: bool = False


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
    campaign_id: str | None = None
    ad_id: str | None = None
    notes: str | None = None
    region: str | None = None
    sector: str | None = None
    pipeline_id: str | None = None


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


@router.get("/orgs/{org_id}/lead-attribution/campaigns")
async def list_attribution_campaigns(
    org_id: str,
    source: str | None = Query(
        None,
        description="LeadSource enum (e.g. META_ADS, GOOGLE_ADS) or short alias META/GOOGLE",
    ),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    """Distinct normalized campaigns seen on org leads (for routing-rule pickers)."""
    return await lead_svc.list_attribution_campaigns(
        organization_id=ctx.organization_id,
        source=source,
    )


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
    campaign_id: str | None = Query(None, description="Filter by campaign ID (normalized or Meta)"),
    pipeline_id: str | None = Query(None, description="Filter by pipeline workspace"),
    pipeline_stage_id: str | None = Query(None, description="Filter by pipeline stage"),
    has_follow_up: bool | None = Query(None, description="Only leads with a scheduled follow-up"),
    last_call_outcome: str | None = Query(
        None,
        description="Only leads whose latest call had this outcome (comma-separated for multiple)",
    ),
    limit: int | None = Query(None, ge=1, le=100, description="Max rows (for pickers/search)"),
    include_last_call: bool = Query(True, description="Include last call summary per lead"),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    apply_created_at(where, day)
    if has_follow_up:
        where["nextFollowUpAt"] = {"not": None}
    if stage is not None:
        where["stage"] = stage
    if source is not None:
        where["source"] = source
    if assignee_id is not None:
        where["assigneeId"] = assignee_id
    if lead_status is not None:
        where["leadStatus"] = lead_status
    if pipeline_id is not None:
        where["pipelineId"] = pipeline_id
    if pipeline_stage_id is not None:
        where["pipelineStageId"] = pipeline_stage_id
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
        campaign_clause = [{"campaignId": campaign_id}, {"metaCampaignId": campaign_id}]
        if "OR" in where:
            where["AND"] = [{"OR": where.pop("OR")}, {"OR": campaign_clause}]
        else:
            where["OR"] = campaign_clause
    order = {"nextFollowUpAt": "asc"} if has_follow_up else {"updatedAt": "desc"}
    find_args: dict = {
        "where": where,
        "order": order,
        "include": {"pipeline": True, "pipelineStage": True},
    }
    # When filtering by latest call outcome we must inspect every matching lead's
    # last call, so the row limit is applied after that filter (below) instead.
    if limit is not None and last_call_outcome is None:
        find_args["take"] = limit
    leads = await prisma.lead.find_many(**find_args)
    with_last_call = include_last_call or last_call_outcome is not None
    latest_calls: dict = {}
    if with_last_call and leads:
        latest_calls = await _latest_calls_by_lead(ctx.organization_id, [lead.id for lead in leads])
    if last_call_outcome is not None:
        wanted = {p.strip().upper() for p in last_call_outcome.split(",") if p.strip()}
        leads = [
            lead
            for lead in leads
            if latest_calls.get(lead.id)
            and _outcome_name(latest_calls[lead.id].outcome) in wanted
        ]
        if limit is not None:
            leads = leads[:limit]
    return {
        "items": [
            _serialize_lead(
                lead,
                with_last_call=with_last_call,
                last_call=latest_calls.get(lead.id),
            )
            for lead in leads
        ]
    }


@router.post("/orgs/{org_id}/leads", status_code=status.HTTP_201_CREATED)
async def create_lead(org_id: str, body: LeadCreate, ctx: OrgContext = Depends(get_org_context)) -> dict:
    return await lead_svc.create_lead(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        title=body.title,
        source=body.source,
        stage=body.stage,
        company=body.company,
        phone=body.phone,
        email=body.email,
        city=body.city,
        source_detail=body.source_detail,
        product_interest=body.product_interest,
        quantity_estimate=body.quantity_estimate,
        tags=body.tags,
        notes=body.notes,
        assignee_id=body.assignee_id,
        next_follow_up_at=body.next_follow_up_at,
        estimated_value=body.estimated_value,
        region=body.region,
        sector=body.sector,
        campaign_id=body.campaign_id,
        campaign_name=body.campaign_name,
        pipeline_id=body.pipeline_id,
        pipeline_stage_id=body.pipeline_stage_id,
        organization=ctx.organization,
    )


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

    campaign_name = (body.campaign or "").strip() or None
    campaign_id = (body.campaign_id or "").strip() or None
    created = await lead_svc.create_lead(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        title=body.name
        or f"Lead via {SOURCE_LABELS.get(source.name if hasattr(source, 'name') else str(source), body.source)}",
        source=source,
        phone=body.phone,
        email=body.email,
        city=body.city,
        product_interest=body.product_interest,
        quantity_estimate=body.quantity_estimate,
        notes=body.notes,
        region=body.region,
        sector=body.sector,
        campaign_id=campaign_id,
        campaign_name=campaign_name,
        pipeline_id=body.pipeline_id,
        source_detail=(
            ", ".join(
                p
                for p in [
                    f"campaign:{body.campaign}" if body.campaign else None,
                    f"ad:{body.ad_id}" if body.ad_id else None,
                ]
                if p
            )
            or None
        ),
        organization=ctx.organization,
        activity_body="Lead ingested",
        activity_metadata={
            "source": source.name if hasattr(source, "name") else str(source),
            "campaign": body.campaign,
            "ad_id": body.ad_id,
        },
    )
    return {**created, "duplicate": False}


_MAX_CSV_BYTES = 8 * 1024 * 1024
_MAX_CSV_ROWS = 5000


@router.post("/orgs/{org_id}/leads/upload-csv")
async def upload_leads_csv(
    org_id: str,
    file: UploadFile = File(...),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    from loomrun_api.leads_csv import parse_lead_rows

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="File must be a CSV file")

    content = await file.read()
    if len(content) > _MAX_CSV_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="CSV is larger than 8 MB")
    if not content.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="CSV file is empty")

    parsed, column_mapping, warnings, errors = parse_lead_rows(content)
    if not parsed and errors:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=errors[0] if len(errors) == 1 else "; ".join(errors[:5]),
        )
    if len(parsed) > _MAX_CSV_ROWS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"CSV has {len(parsed)} leads; maximum is {_MAX_CSV_ROWS} per upload",
        )

    result = await lead_svc.import_parsed_leads(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        parsed=parsed,
        organization=ctx.organization,
    )
    return {
        "created": result["created"],
        "skipped": result["skipped"],
        "errors": errors + result["errors"],
        "warnings": warnings,
        "column_mapping": column_mapping,
    }


@router.get("/orgs/{org_id}/leads/{lead_id}")
async def get_lead(org_id: str, lead_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    return await lead_svc.get_lead(organization_id=ctx.organization_id, lead_id=lead_id)


@router.get("/orgs/{org_id}/follow-ups/due")
async def list_due_follow_ups(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    from loomrun_api.follow_up_reminders import list_due_follow_ups_for_user

    return await list_due_follow_ups_for_user(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
    )


class AckFollowUpsBody(BaseModel):
    lead_ids: list[str] = Field(default_factory=list, max_length=100)


@router.post("/orgs/{org_id}/follow-ups/ack")
async def ack_follow_ups(
    org_id: str,
    body: AckFollowUpsBody,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    from loomrun_api.follow_up_reminders import ack_follow_up_reminders

    return await ack_follow_up_reminders(
        organization_id=ctx.organization_id,
        lead_ids=body.lead_ids,
        user_id=ctx.membership.userId,
    )


@router.patch("/orgs/{org_id}/leads/{lead_id}")
async def update_lead(
    org_id: str, lead_id: str, body: LeadUpdate, ctx: OrgContext = Depends(get_org_context)
) -> dict:
    return await lead_svc.update_lead(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        lead_id=lead_id,
        title=body.title,
        source=body.source,
        stage=body.stage,
        lead_status=body.lead_status,
        company=body.company,
        phone=body.phone,
        email=body.email,
        city=body.city,
        source_detail=body.source_detail,
        product_interest=body.product_interest,
        quantity_estimate=body.quantity_estimate,
        tags=body.tags,
        notes=body.notes,
        assignee_id=body.assignee_id,
        next_follow_up_at=body.next_follow_up_at,
        estimated_value=body.estimated_value,
        region=body.region,
        sector=body.sector,
        campaign_id=body.campaign_id,
        campaign_name=body.campaign_name,
        pipeline_id=body.pipeline_id,
        pipeline_stage_id=body.pipeline_stage_id,
        reroute=body.reroute,
    )


@router.delete("/orgs/{org_id}/leads/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(org_id: str, lead_id: str, ctx: OrgContext = Depends(get_org_context)) -> None:
    lead = await prisma.lead.find_first(where={"id": lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await prisma.lead.delete(where={"id": lead_id})
    # Remove the lead from the org's AI Brain too, so the agent stops citing a
    # record the user has deleted.
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_LEAD,
        entity_id=lead_id,
        deleted=True,
    )


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
