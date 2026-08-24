"""Telephony provider configuration, provisioning, and webhook handling."""

import logging
from calendar import monthrange
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel
from twilio.request_validator import RequestValidator

from prisma._fields import Json as PrismaJson
from prisma.enums import CallOutcome

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, get_org_context, require_feature, require_roles
from loomrun_api.entitlements import FEATURE_UPGRADE_HINTS, get_org_entitlements
from loomrun_api.prisma_client import prisma
from loomrun_api.telephony.crypto import decrypt_credentials
from loomrun_api.telephony.resolver import get_active_ai_adapter, get_active_voice_adapter

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_creds(config) -> dict:
    """Decrypt a config's credentials blob. Returns {} if empty or on error."""
    raw = config.credentials
    if not raw:
        return {}
    if isinstance(raw, dict) and "blob" in raw:
        try:
            return decrypt_credentials(raw["blob"])
        except Exception:
            return {}
    if isinstance(raw, str):
        try:
            return decrypt_credentials(raw)
        except Exception:
            return {}
    return dict(raw)  # BYO plaintext dict


# ── Provision ─────────────────────────────────────────────────────────────────

class ProvisionPayload(BaseModel):
    provider: str = "all"  # "TWILIO" | "VAPI" | "all"


@router.get("/orgs/{org_id}/telephony/capabilities")
async def get_capabilities(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    """
    Returns the calling mode for the active voice provider.
    voice_mode: 'browser' (Twilio JS SDK) | 'click_to_call' (Exotel/Plivo) | 'none'
    """
    _CLICK_TO_CALL_PROVIDERS = {"EXOTEL", "PLIVO"}
    config = await prisma.telephonyconfig.find_first(
        where={"organizationId": ctx.organization_id, "providerType": "VOICE", "isActive": True}
    )
    if not config:
        return {"voice_mode": "none", "provider": None, "phone_number": None}
    mode = "click_to_call" if config.providerName in _CLICK_TO_CALL_PROVIDERS else "browser"
    return {"voice_mode": mode, "provider": config.providerName, "phone_number": config.phoneNumber}


class BYOConnectPayload(BaseModel):
    provider_name: str
    provider_type: str = "VOICE"
    credentials: dict
    phone_number: str | None = None


@router.put("/orgs/{org_id}/telephony/byo")
async def connect_byo_provider(
    org_id: str,
    body: BYOConnectPayload,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Save BYO credentials for a voice provider (e.g. Exotel). OWNER only."""
    from loomrun_api.telephony.crypto import encrypt_credentials

    org = ctx.organization or await prisma.organization.find_unique(where={"id": ctx.organization_id})
    if org and not get_org_entitlements(org).outbound_telephony_providers:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"FEATURE_LOCKED: {FEATURE_UPGRADE_HINTS['outbound_telephony_providers']}",
        )

    creds = PrismaJson({"blob": encrypt_credentials(body.credentials)})
    await prisma.telephonyconfig.upsert(
        where={"organizationId_providerType_providerName": {
            "organizationId": org_id,
            "providerType": body.provider_type,
            "providerName": body.provider_name.upper(),
        }},
        data={
            "create": {
                "organizationId": org_id,
                "providerType": body.provider_type,
                "providerName": body.provider_name.upper(),
                "status": "connected",
                "isActive": True,
                "provisioned": False,
                "phoneNumber": body.phone_number,
                "credentials": creds,
            },
            "update": {
                "status": "connected",
                "isActive": True,
                "phoneNumber": body.phone_number,
                "credentials": creds,
            },
        },
    )
    return {"status": "connected", "provider_name": body.provider_name.upper()}


class ClickToCallPayload(BaseModel):
    lead_id: str
    agent_phone: str  # telecaller's own phone — Exotel calls this first


@router.post("/orgs/{org_id}/telephony/click-to-call", status_code=status.HTTP_201_CREATED)
async def click_to_call(
    org_id: str,
    body: ClickToCallPayload,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    """Initiate a server-side click-to-call via Exotel (or compatible provider)."""
    lead = await prisma.lead.find_first(
        where={"id": body.lead_id, "organizationId": ctx.organization_id}
    )
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if not lead.phone:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Lead has no phone number")

    try:
        adapter = await get_active_voice_adapter(ctx.organization_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))

    attempt = await prisma.telecallercalllog.count(where={"leadId": body.lead_id}) + 1
    call_log = await prisma.telecallercalllog.create(
        data={
            "organizationId": ctx.organization_id,
            "leadId": body.lead_id,
            "userId": ctx.membership.userId,
            "attemptNumber": attempt,
            "outcome": CallOutcome.CONNECTED,
            "callSource": "HUMAN",
        }
    )

    public_url = settings.public_api_url.rstrip("/")
    status_callback = (
        f"{public_url}/v1/telephony/webhooks/exotel"
        f"?lead_id={body.lead_id}&call_log_id={call_log.id}&org_id={ctx.organization_id}"
    )

    try:
        call_sid = await adapter.initiate_click_to_call(
            agent_phone=body.agent_phone,
            customer_phone=lead.phone,
            status_callback=status_callback,
        )
    except Exception as exc:
        await prisma.telecallercalllog.delete(where={"id": call_log.id})
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"Call initiation failed: {exc}")

    await prisma.telecallercalllog.update(
        where={"id": call_log.id},
        data={"callSid": call_sid},
    )
    return {"call_log_id": call_log.id, "call_sid": call_sid}


@router.post("/orgs/{org_id}/telephony/provision")
async def provision_org(
    org_id: str,
    body: ProvisionPayload,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """
    Auto-provision Twilio subaccount+number and/or VAPI assistant for this org.
    OWNER role only. Idempotent.
    """
    from loomrun_api.telephony.provisioner import provision_twilio, provision_vapi, provision_exotel

    org = ctx.organization or await prisma.organization.find_unique(where={"id": ctx.organization_id})
    ents = get_org_entitlements(org) if org else None
    target = body.provider.upper()

    if target in ("TWILIO", "ALL", "EXOTEL") and (not ents or not ents.outbound_telephony_providers):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"FEATURE_LOCKED: {FEATURE_UPGRADE_HINTS['outbound_telephony_providers']}",
        )
    if target in ("VAPI", "ALL") and (not ents or not ents.ai_voice_agents):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"FEATURE_LOCKED: {FEATURE_UPGRADE_HINTS['ai_voice_agents']}",
        )

    results: dict[str, Any] = {}

    if target in ("TWILIO", "ALL"):
        results["twilio"] = await provision_twilio(org_id)
    if target in ("VAPI", "ALL"):
        results["vapi"] = await provision_vapi(org_id)
    if target == "EXOTEL":
        results["exotel"] = await provision_exotel(org_id)

    return results


# ── Providers listing ─────────────────────────────────────────────────────────

@router.get("/orgs/{org_id}/telephony/providers")
async def list_providers(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    """Return provisioning status + assigned phone number for every provider."""
    from loomrun_api.telephony.registry import ALL_PROVIDERS

    configs = await prisma.telephonyconfig.find_many(
        where={"organizationId": ctx.organization_id}
    )
    by_name = {c.providerName: c for c in configs}

    providers = []
    for p in ALL_PROVIDERS:
        cfg = by_name.get(p["provider_name"])
        providers.append({
            "provider_name": p["provider_name"],
            "label": p["label"],
            "provider_type": p["provider_type"],
            "cost_per_min": p["cost_per_min"],
            "docs_url": p["docs_url"],
            "status": cfg.status if cfg else "disconnected",
            "is_active": cfg.isActive if cfg else False,
            "provisioned": cfg.provisioned if cfg else False,
            "phone_number": cfg.phoneNumber if cfg else None,
        })
    return {"providers": providers}


# ── Browser token (Twilio JS SDK) ─────────────────────────────────────────────

@router.get("/orgs/{org_id}/telephony/browser-token")
async def get_browser_token(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    """Issue a Twilio Access Token for the browser Voice SDK."""
    try:
        adapter = await get_active_voice_adapter(ctx.organization_id)
        token = await adapter.get_browser_token(ctx.membership.userId)
        return {"token": token}
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))


# ── TwiML voice endpoint (called by Twilio, no JWT auth) ─────────────────────

@router.post("/telephony/twiml/voice")
async def twiml_voice(request: Request) -> Response:
    """
    Twilio calls this when the browser SDK places a call.
    Returns TwiML to dial the lead's number with recording.
    """
    form = await request.form()
    to_number = form.get("To") or ""
    lead_id = form.get("leadId") or ""
    org_id = form.get("orgId") or ""
    account_sid = form.get("AccountSid") or ""

    # Find config by subaccount SID (preferred) or by org_id
    if account_sid:
        config = await prisma.telephonyconfig.find_first(
            where={"subaccountSid": account_sid, "providerName": "TWILIO"}
        )
    else:
        config = await prisma.telephonyconfig.find_first(
            where={"organizationId": org_id, "providerName": "TWILIO"}
        )

    # Verify Twilio signature
    if config:
        creds = _safe_creds(config)
        auth_token = creds.get("auth_token", "")
        if auth_token:
            url = str(request.url)
            sig = request.headers.get("X-Twilio-Signature", "")
            if not RequestValidator(auth_token).validate(url, dict(form), sig):
                logger.warning("Invalid Twilio signature on /twiml/voice")
                return Response("Forbidden", status_code=403)

    phone_number = (config.phoneNumber if config else "") or ""
    public_url = settings.public_api_url.rstrip("/")
    status_cb = f"{public_url}/v1/telephony/webhooks/twilio/status?leadId={lead_id}&orgId={org_id}"
    rec_cb = f"{public_url}/v1/telephony/webhooks/twilio/recording"

    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial
    callerId="{phone_number}"
    record="record-from-answer-dual"
    recordingStatusCallback="{rec_cb}"
    recordingStatusCallbackMethod="POST"
  >
    <Number
      statusCallback="{status_cb}"
      statusCallbackMethod="POST"
      statusCallbackEvent="completed"
    >{to_number}</Number>
  </Dial>
</Response>"""
    return Response(content=twiml, media_type="application/xml")


# ── AI auto-call ──────────────────────────────────────────────────────────────

class AICallPayload(BaseModel):
    lead_id: str


@router.post("/orgs/{org_id}/telecaller/ai-call", status_code=status.HTTP_201_CREATED)
async def initiate_ai_call(
    org_id: str,
    body: AICallPayload,
    ctx: OrgContext = Depends(require_feature("ai_voice_agents")),
) -> dict:
    """Trigger an immediate VAPI AI call to a lead."""
    lead = await prisma.lead.find_first(
        where={"id": body.lead_id, "organizationId": ctx.organization_id}
    )
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if not lead.phone:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Lead has no phone number")

    try:
        adapter = await get_active_ai_adapter(ctx.organization_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))

    attempt = await prisma.telecallercalllog.count(where={"leadId": body.lead_id}) + 1
    call_log = await prisma.telecallercalllog.create(
        data={
            "organizationId": ctx.organization_id,
            "leadId": body.lead_id,
            "userId": None,
            "attemptNumber": attempt,
            "outcome": CallOutcome.CONNECTED,
            "callSource": "AI_AUTO",
        }
    )

    call_sid = await adapter.initiate_call(
        lead_phone=lead.phone,
        lead_name=lead.title,
        metadata={
            "org_id": ctx.organization_id,
            "lead_id": body.lead_id,
            "call_log_id": call_log.id,
        },
    )
    await prisma.telecallercalllog.update(
        where={"id": call_log.id},
        data={"callSid": call_sid},
    )
    return {"call_log_id": call_log.id, "call_sid": call_sid}


# ── Usage ─────────────────────────────────────────────────────────────────────

@router.get("/orgs/{org_id}/telephony/usage")
async def get_usage(
    org_id: str,
    month: str | None = None,  # YYYY-MM; defaults to current month
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    now = datetime.now(timezone.utc)
    if month:
        try:
            year, mon = int(month[:4]), int(month[5:7])
            last_day = monthrange(year, mon)[1]
            start = datetime(year, mon, 1, tzinfo=timezone.utc)
            end = datetime(year, mon, last_day, 23, 59, 59, tzinfo=timezone.utc)
            where = {"organizationId": ctx.organization_id, "createdAt": {"gte": start, "lte": end}}
        except (ValueError, IndexError):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="month must be YYYY-MM")
    else:
        start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        where = {"organizationId": ctx.organization_id, "createdAt": {"gte": start}}

    records = await prisma.telephonyusage.find_many(where=where)
    total_seconds = sum(r.durationSeconds for r in records)
    total_provider = sum(float(r.providerCost) for r in records)
    total_billed = sum(float(r.billedCost) for r in records)

    by_provider: dict[str, dict] = {}
    for r in records:
        p = r.provider
        if p not in by_provider:
            by_provider[p] = {"calls": 0, "duration_seconds": 0, "billed_cost": 0.0}
        by_provider[p]["calls"] += 1
        by_provider[p]["duration_seconds"] += r.durationSeconds
        by_provider[p]["billed_cost"] += float(r.billedCost)

    return {
        "month": month or now.strftime("%Y-%m"),
        "total_calls": len(records),
        "total_duration_seconds": total_seconds,
        "total_duration_minutes": round(total_seconds / 60, 2),
        "total_provider_cost": round(total_provider, 4),
        "total_billed_cost": round(total_billed, 4),
        "by_provider": by_provider,
    }


# ── Twilio webhooks ───────────────────────────────────────────────────────────

@router.post("/telephony/webhooks/twilio/status")
async def twilio_status_webhook(request: Request) -> dict:
    """
    Twilio calls this when a call completes (via statusCallback on the TwiML Dial).
    Routes to the correct org by subaccount AccountSid.
    """
    form = dict(await request.form())
    account_sid = form.get("AccountSid", "")
    call_sid = form.get("CallSid", "")
    call_status = form.get("CallStatus", "")
    duration_str = form.get("CallDuration", "0")
    lead_id = request.query_params.get("leadId", "")
    org_id = request.query_params.get("orgId", "")

    config = await prisma.telephonyconfig.find_first(
        where={"subaccountSid": account_sid, "providerName": "TWILIO"} if account_sid else
              {"organizationId": org_id, "providerName": "TWILIO"}
    )
    if not config:
        logger.warning("Twilio status webhook: no org for AccountSid=%s orgId=%s", account_sid, org_id)
        return {"status": "ignored"}

    # Signature verification
    creds = _safe_creds(config)
    auth_token = creds.get("auth_token", "")
    if auth_token:
        sig = request.headers.get("X-Twilio-Signature", "")
        if not RequestValidator(auth_token).validate(str(request.url), form, sig):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Invalid Twilio signature")

    status_to_outcome = {
        "completed": CallOutcome.CONNECTED,
        "no-answer": CallOutcome.NO_ANSWER,
        "busy": CallOutcome.BUSY,
        "failed": CallOutcome.NO_ANSWER,
        "canceled": CallOutcome.NO_ANSWER,
    }
    outcome = status_to_outcome.get(call_status, CallOutcome.CONNECTED)
    duration = int(duration_str) if duration_str.isdigit() else 0

    call_log = await prisma.telecallercalllog.find_first(
        where={"callSid": call_sid, "organizationId": config.organizationId}
    )
    if not call_log and lead_id:
        # Fallback: find the most recent pending log for this lead
        call_log = await prisma.telecallercalllog.find_first(
            where={"leadId": lead_id, "organizationId": config.organizationId},
            order={"createdAt": "desc"},
        )

    if call_log:
        await prisma.telecallercalllog.update(
            where={"id": call_log.id},
            data={"outcome": outcome, "durationSeconds": duration, "callSid": call_sid},
        )

    provider_cost = (duration / 60) * 0.022
    billed_cost = provider_cost * settings.telephony_markup_multiplier
    await prisma.telephonyusage.create(
        data={
            "organizationId": config.organizationId,
            "configId": config.id,
            "callLogId": call_log.id if call_log else None,
            "provider": "TWILIO",
            "direction": "outbound",
            "callSid": call_sid,
            "durationSeconds": duration,
            "providerCost": str(round(provider_cost, 4)),
            "billedCost": str(round(billed_cost, 4)),
        }
    )
    logger.info("Twilio webhook org=%s sid=%s status=%s dur=%ds", config.organizationId, call_sid, call_status, duration)
    return {"status": "ok"}


@router.post("/telephony/webhooks/twilio/recording")
async def twilio_recording_webhook(request: Request) -> dict:
    """Updates recording URL once Twilio recording is processed."""
    form = dict(await request.form())
    call_sid = form.get("CallSid", "")
    recording_url = form.get("RecordingUrl", "")
    if recording_url and call_sid:
        await prisma.telecallercalllog.update_many(
            where={"callSid": call_sid},
            data={"recordingUrl": f"{recording_url}.mp3"},
        )
    return {"status": "ok"}


# ── VAPI webhook ──────────────────────────────────────────────────────────────

@router.post("/telephony/webhooks/vapi")
async def vapi_webhook(request: Request) -> dict:
    """
    Handles VAPI end-of-call-report.
    Routes to org via metadata.org_id set at call creation.
    """
    import hmac
    import json

    body_bytes = await request.body()

    expected_secret = settings.vapi_webhook_secret
    if expected_secret:
        provided = request.headers.get("x-vapi-secret", "")
        if not hmac.compare_digest(provided, expected_secret):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Invalid VAPI secret")

    payload = json.loads(body_bytes)
    msg = payload.get("message", payload)
    event_type = msg.get("type", "")

    if event_type != "end-of-call-report":
        return {"status": "ignored"}

    call = msg.get("call", {})
    metadata = call.get("metadata", {})
    org_id = metadata.get("org_id", "")
    call_log_id = metadata.get("call_log_id", "")
    call_sid = call.get("id", "")

    analysis = msg.get("analysis", {})
    transcript = msg.get("transcript")
    summary = analysis.get("summary")
    duration = int(msg.get("durationSeconds") or 0)
    cost = float(msg.get("cost") or 0.0)

    ended_reason = msg.get("endedReason", "")
    outcome_map = {
        "customer-ended-call": CallOutcome.CONNECTED,
        "assistant-ended-call": CallOutcome.CONNECTED,
        "customer-did-not-answer": CallOutcome.NO_ANSWER,
        "customer-busy": CallOutcome.BUSY,
    }
    outcome = outcome_map.get(ended_reason, CallOutcome.CONNECTED)

    if call_log_id:
        await prisma.telecallercalllog.update(
            where={"id": call_log_id},
            data={
                "outcome": outcome,
                "durationSeconds": duration,
                "transcriptRaw": transcript,
                "aiSummary": summary,
            },
        )

    if org_id:
        config = await prisma.telephonyconfig.find_first(
            where={"organizationId": org_id, "providerName": "VAPI"}
        )
        billed = cost * settings.telephony_markup_multiplier
        await prisma.telephonyusage.create(
            data={
                "organizationId": org_id,
                "configId": config.id if config else None,
                "callLogId": call_log_id or None,
                "provider": "VAPI",
                "direction": "outbound",
                "callSid": call_sid,
                "durationSeconds": duration,
                "providerCost": str(round(cost, 4)),
                "billedCost": str(round(billed, 4)),
            }
        )

    logger.info("VAPI webhook org=%s log=%s dur=%ds outcome=%s", org_id, call_log_id, duration, outcome)
    return {"status": "ok"}


# ── Legacy stub webhooks (other providers) ────────────────────────────────────

@router.post("/telephony/webhooks/plivo")
async def plivo_webhook() -> dict:
    return {"status": "ok"}

@router.post("/telephony/webhooks/exotel")
async def exotel_webhook(request: Request) -> dict:
    """
    Exotel calls this when a click-to-call completes.
    org_id, lead_id, call_log_id are passed as query params set at call creation.
    """
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
    else:
        form = await request.form()
        payload = dict(form)

    lead_id = request.query_params.get("lead_id", "")
    call_log_id = request.query_params.get("call_log_id", "")
    org_id = request.query_params.get("org_id", "")

    call_sid = payload.get("CallSid", "")
    raw_status = payload.get("Status", payload.get("CallStatus", "")).lower()
    duration_raw = payload.get("Duration", "0")
    recording_url = payload.get("RecordingUrl", "")

    status_to_outcome = {
        "completed": CallOutcome.CONNECTED,
        "no-answer": CallOutcome.NO_ANSWER,
        "busy": CallOutcome.BUSY,
        "failed": CallOutcome.NO_ANSWER,
        "canceled": CallOutcome.NO_ANSWER,
    }
    outcome = status_to_outcome.get(raw_status, CallOutcome.CONNECTED)
    duration = int(duration_raw) if str(duration_raw).isdigit() else 0

    # Locate the call log
    call_log = None
    if call_log_id:
        call_log = await prisma.telecallercalllog.find_unique(where={"id": call_log_id})
    if not call_log and call_sid:
        call_log = await prisma.telecallercalllog.find_first(where={"callSid": call_sid})
    if not call_log and lead_id:
        call_log = await prisma.telecallercalllog.find_first(
            where={"leadId": lead_id}, order={"createdAt": "desc"}
        )

    if call_log:
        await prisma.telecallercalllog.update(
            where={"id": call_log.id},
            data={
                "outcome": outcome,
                "durationSeconds": duration,
                "callSid": call_sid or call_log.callSid,
                "recordingUrl": recording_url or None,
            },
        )
        org_id = org_id or call_log.organizationId

    if org_id:
        config = await prisma.telephonyconfig.find_first(
            where={"organizationId": org_id, "providerName": "EXOTEL"}
        )
        provider_cost = (duration / 60) * 0.007  # ~₹0.58/min ≈ $0.007
        billed_cost = provider_cost * settings.telephony_markup_multiplier
        await prisma.telephonyusage.create(
            data={
                "organizationId": org_id,
                "configId": config.id if config else None,
                "callLogId": call_log.id if call_log else None,
                "provider": "EXOTEL",
                "direction": "outbound",
                "callSid": call_sid or "",
                "durationSeconds": duration,
                "providerCost": str(round(provider_cost, 4)),
                "billedCost": str(round(billed_cost, 4)),
            }
        )

    logger.info("Exotel webhook org=%s sid=%s status=%s dur=%ds", org_id, call_sid, raw_status, duration)
    return {"status": "ok"}

@router.post("/telephony/webhooks/telnyx")
async def telnyx_webhook() -> dict:
    return {"status": "ok"}

@router.post("/telephony/webhooks/vonage")
async def vonage_webhook() -> dict:
    return {"status": "ok"}

@router.post("/telephony/webhooks/retell")
async def retell_webhook() -> dict:
    return {"status": "ok"}

@router.post("/telephony/webhooks/bland")
async def bland_webhook() -> dict:
    return {"status": "ok"}
