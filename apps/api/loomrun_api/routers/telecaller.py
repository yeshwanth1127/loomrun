import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from loomrun_api.call_outcomes import is_connected_outcome
from loomrun_api.config import settings
from loomrun_api.date_filter import apply_created_at, day_label
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.lead_call_sync import enum_str, sync_lead_after_call
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.routers.leads import _compute_lead_score
from loomrun_api.whatsapp_client import send_whatsapp_text
from prisma.enums import CallOutcome, LeadActivityType, LeadStage

logger = logging.getLogger(__name__)

router = APIRouter()


def _enum_str(val) -> str:
    return val.name if hasattr(val, "name") else str(val)


def _caller_fields(user) -> dict:
    if not user:
        return {"user_email": None, "user_name": None, "logged_by": None}
    name = user.name.strip() if user.name else None
    return {
        "user_email": user.email,
        "user_name": name,
        "logged_by": name or user.email,
    }


class CallLogCreate(BaseModel):
    lead_id: str
    outcome: CallOutcome
    notes: str | None = None
    duration_seconds: int | None = None
    next_call_at: datetime | None = None
    stage: LeadStage | None = None
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    company: str | None = None
    product_interest: str | None = None
    quantity_estimate: str | None = None
    estimated_value: float | None = None
    lead_notes: str | None = None
    send_catalog: bool = False
    send_quotation: bool = False


async def _apply_lead_updates_from_call(
    *,
    lead_id: str,
    user_id: str,
    lead,
    body: CallLogCreate,
) -> LeadStage:
    """Persist lead fields edited on the telecaller form."""
    now = datetime.now(timezone.utc)
    update_data: dict = {"lastActivityAt": now}
    current_stage = lead.stage

    if body.phone is not None:
        update_data["phone"] = body.phone or None
    if body.email is not None:
        update_data["email"] = body.email or None
    if body.city is not None:
        update_data["city"] = body.city or None
    if body.company is not None:
        update_data["company"] = body.company or None
    if body.product_interest is not None:
        update_data["productInterest"] = body.product_interest or None
    if body.quantity_estimate is not None:
        update_data["quantityEstimate"] = body.quantity_estimate or None
    if body.lead_notes is not None:
        update_data["notes"] = body.lead_notes or None
    if body.estimated_value is not None:
        update_data["estimatedValue"] = body.estimated_value
    follow_up = body.next_call_at
    outcome_name = body.outcome.name if hasattr(body.outcome, "name") else str(body.outcome)
    if follow_up is not None:
        update_data["nextFollowUpAt"] = follow_up
        # New schedule → allow reminders again
        update_data["followUpRemindedAt"] = None
        update_data["followUpWaRemindedAt"] = None
    elif outcome_name != "CALLBACK_SCHEDULED":
        # Non–Follow Up outcome clears the scheduled follow-up
        update_data["nextFollowUpAt"] = None
        update_data["followUpRemindedAt"] = None
        update_data["followUpWaRemindedAt"] = None

    if body.product_interest is not None or body.phone is not None or body.email is not None or body.city is not None:
        update_data["leadScore"] = _compute_lead_score(
            lead.source,
            body.phone if body.phone is not None else lead.phone,
            body.email if body.email is not None else lead.email,
            body.product_interest if body.product_interest is not None else lead.productInterest,
            body.city if body.city is not None else lead.city,
        )

    if body.stage is not None and body.stage != current_stage:
        stage_name = enum_str(body.stage)
        update_data["stage"] = body.stage
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.STAGE_CHANGE,
                "body": f"Stage changed to {stage_name}",
                "metadata": json_meta({"stage": stage_name, "source": "telecaller"}),
            }
        )
        current_stage = body.stage

    if len(update_data) > 1:
        await prisma.lead.update(where={"id": lead_id}, data=update_data)

    return current_stage


async def _build_catalog_message(org_id: str, lead_name: str, org_name: str) -> str | None:
    items = await prisma.catalogitem.find_many(
        where={"organizationId": org_id},
        order={"name": "asc"},
    )
    if not items:
        return None
    lines = [f"Hi {lead_name}! Thank you for your interest in {org_name}.\n\nHere's our product catalog:\n"]
    for i, item in enumerate(items, 1):
        price = f"₹{item.unitPrice:,.0f}"
        sku_part = f" ({item.sku})" if item.sku else ""
        desc_part = f"\n   {item.description}" if item.description else ""
        lines.append(f"{i}. *{item.name}*{sku_part} — {price}/unit{desc_part}")
    lines.append("\nReply to this message for a custom quotation or any queries.")
    return "\n".join(lines)


async def _build_quotation_message(org_id: str, lead_id: str, lead_name: str, org_name: str) -> str | None:
    quotation = await prisma.quotation.find_first(
        where={"organizationId": org_id, "leadId": lead_id},
        order={"createdAt": "desc"},
        include={"lines": True},
    )
    if not quotation:
        return None
    total = float(quotation.total)
    lines = [f"Hi {lead_name}! Here's your quotation from {org_name}.\n"]
    lines.append(f"*Quotation #{quotation.number}*")
    lines.append(f"Status: {quotation.status.name if hasattr(quotation.status, 'name') else quotation.status}\n")
    for ln in sorted(quotation.lines or [], key=lambda x: x.sortOrder):
        lines.append(f"• {ln.description} × {float(ln.quantity):.0f} = ₹{float(ln.lineTotal):,.0f}")
    lines.append(f"\n*Total: ₹{total:,.0f}*")
    if quotation.pdfUrl:
        public_url = settings.public_api_url.rstrip("/")
        lines.append(f"\nDownload PDF: {public_url}{quotation.pdfUrl}")
    lines.append("\nPlease reply if you have any questions or would like to proceed.")
    return "\n".join(lines)


@router.post("/orgs/{org_id}/telecaller/calls", status_code=status.HTTP_201_CREATED)
async def log_call(
    org_id: str,
    body: CallLogCreate,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    lead = await prisma.lead.find_first(where={"id": body.lead_id, "organizationId": ctx.organization_id})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    outcome_name = body.outcome.name if hasattr(body.outcome, "name") else str(body.outcome)
    if outcome_name == "CALLBACK_SCHEDULED" and body.next_call_at is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Follow-up date/time is required when logging Follow Up",
        )
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
            "durationSeconds": body.duration_seconds,
            "nextCallAt": body.next_call_at,
            "callSource": "HUMAN",
        },
        include={"user": True},
    )
    caller = _caller_fields(row.user)
    stage_after_edits = await _apply_lead_updates_from_call(
        lead_id=body.lead_id,
        user_id=ctx.membership.userId,
        lead=lead,
        body=body,
    )
    new_stage = await sync_lead_after_call(
        lead_id=body.lead_id,
        user_id=ctx.membership.userId,
        outcome=body.outcome,
        notes=body.notes,
        attempt=attempt,
        lead_stage=stage_after_edits,
        logged_by=caller["logged_by"],
    )

    wa_catalog_sent = False
    wa_quotation_sent = False

    if is_connected_outcome(body.outcome) and (body.send_catalog or body.send_quotation):
        effective_phone = body.phone or lead.phone
        org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
        org_name = org.name if org else ctx.organization_id
        lead_name = lead.title

        if effective_phone:
            if body.send_catalog:
                msg = await _build_catalog_message(ctx.organization_id, lead_name, org_name)
                if msg:
                    wa_catalog_sent = await send_whatsapp_text(effective_phone, msg)
                    if wa_catalog_sent:
                        await prisma.leadactivity.create(
                            data={
                                "leadId": body.lead_id,
                                "userId": ctx.membership.userId,
                                "type": LeadActivityType.WHATSAPP,
                                "body": "Catalog sent via WhatsApp",
                            }
                        )
                    else:
                        logger.warning("Catalog WhatsApp send failed for lead %s", body.lead_id)

            if body.send_quotation:
                msg = await _build_quotation_message(ctx.organization_id, body.lead_id, lead_name, org_name)
                if msg:
                    wa_quotation_sent = await send_whatsapp_text(effective_phone, msg)
                    if wa_quotation_sent:
                        await prisma.leadactivity.create(
                            data={
                                "leadId": body.lead_id,
                                "userId": ctx.membership.userId,
                                "type": LeadActivityType.WHATSAPP,
                                "body": "Quotation sent via WhatsApp",
                            }
                        )
                    else:
                        logger.warning("Quotation WhatsApp send failed for lead %s", body.lead_id)
        else:
            logger.warning("WhatsApp send skipped for lead %s — no phone number", body.lead_id)

    return {
        "id": row.id,
        "lead_id": body.lead_id,
        "attempt_number": row.attemptNumber,
        "outcome": _enum_str(row.outcome),
        "created_at": row.createdAt.isoformat(),
        "lead_stage": enum_str(new_stage),
        "stage_changed": new_stage != lead.stage,
        "wa_catalog_sent": wa_catalog_sent,
        "wa_quotation_sent": wa_quotation_sent,
        **caller,
    }


@router.get("/orgs/{org_id}/telecaller/calls/{call_id}")
async def get_call(
    org_id: str,
    call_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    call = await prisma.telecallercalllog.find_first(
        where={"id": call_id, "organizationId": ctx.organization_id},
        include={"user": True, "lead": True},
    )
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Call not found")
    return {
        "id": call.id,
        "lead_title": call.lead.title if call.lead else None,
        **_caller_fields(call.user),
        "outcome": _enum_str(call.outcome),
        "notes": call.notes,
        "duration_seconds": call.durationSeconds,
        "call_source": call.callSource,
        "attempt_number": call.attemptNumber,
        "recording_url": call.recordingUrl,
        "transcript_raw": call.transcriptRaw,
        "ai_summary": call.aiSummary,
        "created_at": call.createdAt.isoformat(),
        "next_call_at": call.nextCallAt.isoformat() if call.nextCallAt else None,
    }


@router.get("/orgs/{org_id}/telecaller/daily-summary")
async def telecaller_daily_summary(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD in UTC, or all for all time"),
    user_id: str | None = Query(None, description="Filter by user ID"),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    apply_created_at(where, day)
    if user_id:
        where["userId"] = user_id
    calls = await prisma.telecallercalllog.find_many(
        where=where,
        include={"user": True, "lead": True},
        order={"createdAt": "desc"},
    )
    by_outcome: dict[str, int] = {}
    for c in calls:
        name = _enum_str(c.outcome)
        by_outcome[name] = by_outcome.get(name, 0) + 1
    return {
        "date": day_label(day),
        "total_calls": len(calls),
        "by_outcome": by_outcome,
        "calls": [
            {
                "id": c.id,
                "lead_title": c.lead.title if c.lead else None,
                **_caller_fields(c.user),
                "outcome": _enum_str(c.outcome),
                "created_at": c.createdAt.isoformat(),
            }
            for c in calls
        ],
    }
