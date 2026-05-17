"""Telephony provider configuration and webhook handling."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from loomrun_api.telephony.registry import get_provider_by_name, get_providers_by_type
from loomrun_api.telephony.resolver import get_active_voice_adapter, get_active_ai_adapter

router = APIRouter()


# ── Types ────────────────────────────────────────────────────────────────────

class ProviderConfig(BaseModel):
    provider_type: str
    provider_name: str
    status: str
    is_active: bool
    credential_fields: list[str]
    cost_per_min: float
    docs_url: str


class ConnectProviderPayload(BaseModel):
    provider_name: str
    credentials: dict


class SetActiveProviderPayload(BaseModel):
    provider_name: str


# ── List Providers ────────────────────────────────────────────────────────────

@router.get("/orgs/{org_id}/telephony/providers")
async def list_providers(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    """List all available telephony providers and their status for this org."""
    providers = []

    for provider_def in get_providers_by_type("VOICE") + get_providers_by_type("AI_CALL"):
        config = await prisma.telephonyconfig.find_first(
            where={
                "organizationId": ctx.organization_id,
                "providerName": provider_def["provider_name"],
            }
        )

        providers.append({
            "provider_name": provider_def["provider_name"],
            "label": provider_def["label"],
            "provider_type": provider_def["provider_type"],
            "credential_fields": provider_def["credential_fields"],
            "cost_per_min": provider_def["cost_per_min"],
            "docs_url": provider_def["docs_url"],
            "status": config.status if config else "disconnected",
            "is_active": config.isActive if config else False,
        })

    return {"providers": providers}


# ── Connect Provider ──────────────────────────────────────────────────────────

@router.post("/orgs/{org_id}/telephony/providers/connect")
async def connect_provider(
    org_id: str,
    body: ConnectProviderPayload,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    """Connect a provider by saving credentials."""
    provider_def = get_provider_by_name(body.provider_name)
    if not provider_def:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown provider")

    existing = await prisma.telephonyconfig.find_first(
        where={
            "organizationId": ctx.organization_id,
            "providerName": body.provider_name,
        }
    )

    if existing:
        updated = await prisma.telephonyconfig.update(
            where={"id": existing.id},
            data={
                "status": "connected",
                "credentials": body.credentials,
            },
        )
    else:
        updated = await prisma.telephonyconfig.create(
            data={
                "organizationId": ctx.organization_id,
                "providerType": provider_def["provider_type"],
                "providerName": body.provider_name,
                "status": "connected",
                "credentials": body.credentials,
            }
        )

    return {
        "provider_name": updated.providerName,
        "status": updated.status,
    }


# ── Disconnect Provider ───────────────────────────────────────────────────────

@router.post("/orgs/{org_id}/telephony/providers/disconnect")
async def disconnect_provider(
    org_id: str,
    body: BaseModel,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    """Disconnect a provider by clearing credentials."""
    # Parse provider_name from body
    provider_name = getattr(body, "provider_name", None)
    if not provider_name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Missing provider_name")

    config = await prisma.telephonyconfig.find_first(
        where={
            "organizationId": ctx.organization_id,
            "providerName": provider_name,
        }
    )

    if not config:
        return {"status": "disconnected"}

    await prisma.telephonyconfig.update(
        where={"id": config.id},
        data={
            "status": "disconnected",
            "credentials": None,
            "isActive": False,
        },
    )

    return {"status": "disconnected"}


# ── Set Active Provider ───────────────────────────────────────────────────────

@router.post("/orgs/{org_id}/telephony/providers/set-active")
async def set_active_provider(
    org_id: str,
    body: SetActiveProviderPayload,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    """Set a connected provider as active (deactivates others of same type)."""
    config = await prisma.telephonyconfig.find_first(
        where={
            "organizationId": ctx.organization_id,
            "providerName": body.provider_name,
            "status": "connected",
        }
    )

    if not config:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Provider not connected")

    provider_def = get_provider_by_name(body.provider_name)
    if not provider_def:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown provider")

    # Deactivate all others of the same type
    await prisma.telephonyconfig.update_many(
        where={
            "organizationId": ctx.organization_id,
            "providerType": provider_def["provider_type"],
        },
        data={"isActive": False},
    )

    # Activate this one
    updated = await prisma.telephonyconfig.update(
        where={"id": config.id},
        data={"isActive": True},
    )

    return {
        "provider_name": updated.providerName,
        "is_active": updated.isActive,
    }


# ── Browser Token ─────────────────────────────────────────────────────────────

@router.get("/orgs/{org_id}/telephony/browser-token")
async def get_browser_token(
    org_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    """Get a browser token for the active voice provider."""
    try:
        adapter = await get_active_voice_adapter(ctx.organization_id)
        identity = ctx.membership.user.email
        token = await adapter.get_browser_token(identity)
        return {"token": token}
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e))


# ── Webhook Handlers (no auth) ────────────────────────────────────────────────

@router.post("/v1/telecaller/webhooks/twilio")
async def twilio_webhook(payload: dict) -> dict:
    """Handle Twilio call-completed webhook."""
    # TODO: Implement Twilio webhook parsing
    return {"status": "ok"}


@router.post("/v1/telecaller/webhooks/plivo")
async def plivo_webhook(payload: dict) -> dict:
    """Handle Plivo call-completed webhook."""
    return {"status": "ok"}


@router.post("/v1/telecaller/webhooks/exotel")
async def exotel_webhook(payload: dict) -> dict:
    """Handle Exotel call-completed webhook."""
    return {"status": "ok"}


@router.post("/v1/telecaller/webhooks/telnyx")
async def telnyx_webhook(payload: dict) -> dict:
    """Handle Telnyx call-completed webhook."""
    return {"status": "ok"}


@router.post("/v1/telecaller/webhooks/vonage")
async def vonage_webhook(payload: dict) -> dict:
    """Handle Vonage call-completed webhook."""
    return {"status": "ok"}


@router.post("/v1/telecaller/webhooks/vapi")
async def vapi_webhook(payload: dict) -> dict:
    """Handle VAPI call-ended webhook."""
    # TODO: Implement VAPI webhook parsing and TelecallerCallLog update
    return {"status": "ok"}


@router.post("/v1/telecaller/webhooks/retell")
async def retell_webhook(payload: dict) -> dict:
    """Handle Retell AI call-ended webhook."""
    return {"status": "ok"}


@router.post("/v1/telecaller/webhooks/bland")
async def bland_webhook(payload: dict) -> dict:
    """Handle Bland.ai call-ended webhook."""
    return {"status": "ok"}
