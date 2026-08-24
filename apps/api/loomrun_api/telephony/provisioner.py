"""
Platform-managed telephony provisioner.

Each org gets its own isolated Twilio subaccount + API key + phone number + TwiML App,
and a VAPI assistant with the Twilio number imported. Credentials are stored encrypted.
"""
from __future__ import annotations

import logging

import httpx
from twilio.rest import Client as TwilioClient

from prisma._fields import Json as PrismaJson

from loomrun_api.config import settings
from loomrun_api.prisma_client import prisma
from loomrun_api.telephony.crypto import encrypt_credentials

logger = logging.getLogger(__name__)


def _master_client() -> TwilioClient:
    if not settings.twilio_master_account_sid or not settings.twilio_master_auth_token:
        raise RuntimeError("Twilio master credentials not configured (TWILIO_MASTER_ACCOUNT_SID / TWILIO_MASTER_AUTH_TOKEN)")
    return TwilioClient(settings.twilio_master_account_sid, settings.twilio_master_auth_token)


def _vapi_headers() -> dict:
    if not settings.vapi_master_api_key:
        raise RuntimeError("VAPI_MASTER_API_KEY not configured")
    return {"Authorization": f"Bearer {settings.vapi_master_api_key}", "Content-Type": "application/json"}


def _wrap(creds_str: str) -> PrismaJson:
    """Wrap an encrypted credential string for Prisma Json? storage."""
    return PrismaJson({"blob": creds_str})


def _unwrap(raw) -> str | None:
    """Extract the encrypted blob from storage. Handles both wrapped and legacy formats."""
    if isinstance(raw, dict):
        return raw.get("blob")
    if isinstance(raw, str):
        return raw  # legacy
    return None


# ---------------------------------------------------------------------------
# Twilio provisioner
# ---------------------------------------------------------------------------

async def provision_twilio(org_id: str) -> dict:
    """
    Create a Twilio subaccount, API key, TwiML App, and phone number for one org.
    Credentials are stored encrypted in TelephonyConfig.
    Returns the plain config dict (without secrets for API response).
    """
    org = await prisma.organization.find_unique(where={"id": org_id})
    if not org:
        raise ValueError(f"Org {org_id} not found")

    existing = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerName": "TWILIO", "provisioned": True}
    )
    if existing:
        return {"status": "already_provisioned", "phone_number": existing.phoneNumber}

    master = _master_client()
    public_url = settings.public_api_url.rstrip("/")

    logger.info("Provisioning Twilio for org=%s (%s)", org_id, org.name)
    subaccount = master.api.v2010.accounts.create(friendly_name=f"Loomrun – {org.name}")
    sub_sid = subaccount.sid
    sub_client = TwilioClient(sub_sid, subaccount.auth_token)

    try:
        api_key = sub_client.new_keys.create(friendly_name="Loomrun browser SDK")
        twiml_app = sub_client.applications.create(
            friendly_name="Loomrun Voice",
            voice_url=f"{public_url}/v1/telephony/twiml/voice",
            voice_method="POST",
            status_callback=f"{public_url}/v1/telephony/webhooks/twilio",
            status_callback_method="POST",
        )
        available = sub_client.available_phone_numbers(settings.twilio_number_country).local.list(
            voice_enabled=True, limit=1,
        )
        if not available:
            raise RuntimeError(f"No available phone numbers in country {settings.twilio_number_country}")
        number = sub_client.incoming_phone_numbers.create(
            phone_number=available[0].phone_number,
            voice_application_sid=twiml_app.sid,
            status_callback=f"{public_url}/v1/telephony/webhooks/twilio",
            status_callback_method="POST",
        )
    except Exception:
        try:
            master.api.v2010.accounts(sub_sid).update(status="closed")
        except Exception:
            pass
        raise

    creds = _wrap(encrypt_credentials({
        "account_sid": sub_sid,
        "auth_token": subaccount.auth_token,
        "api_key_sid": api_key.sid,
        "api_key_secret": api_key.secret,
        "twiml_app_sid": twiml_app.sid,
        "phone_number": number.phone_number,
        "phone_number_sid": number.sid,
    }))
    refs = {
        "twiml_app_sid": twiml_app.sid,
        "api_key_sid": api_key.sid,
        "phone_number_sid": number.sid,
    }

    # Use explicit find + create/update to avoid Prisma upsert type-matching issues
    row = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerType": "VOICE", "providerName": "TWILIO"}
    )
    if row:
        config = await prisma.telephonyconfig.update(
            where={"id": row.id},
            data={
                "status": "connected", "isActive": True, "provisioned": True,
                "phoneNumber": number.phone_number, "subaccountSid": sub_sid,
                "externalRefs": refs, "credentials": creds,
            },
        )
    else:
        config = await prisma.telephonyconfig.create(
            data={
                "organization": {"connect": {"id": org_id}},
                "providerType": "VOICE", "providerName": "TWILIO",
                "status": "connected", "isActive": True, "provisioned": True,
                "phoneNumber": number.phone_number, "subaccountSid": sub_sid,
                "externalRefs": refs, "credentials": creds,
            },
        )

    logger.info("Twilio provisioned org=%s number=%s subaccount=%s", org_id, number.phone_number, sub_sid)
    return {"status": "provisioned", "phone_number": config.phoneNumber, "subaccount_sid": config.subaccountSid}


async def teardown_twilio(org_id: str) -> None:
    """Release all Twilio resources for an org. Call on org suspend/delete."""
    config = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerName": "TWILIO", "provisioned": True}
    )
    if not config or not config.subaccountSid:
        return
    try:
        master = _master_client()
        master.api.v2010.accounts(config.subaccountSid).update(status="closed")
        logger.info("Twilio subaccount closed org=%s sid=%s", org_id, config.subaccountSid)
    except Exception as exc:
        logger.warning("Failed to close Twilio subaccount org=%s: %s", org_id, exc)
    await prisma.telephonyconfig.update(
        where={"id": config.id},
        data={"status": "disconnected", "provisioned": False, "isActive": False, "credentials": None},
    )


# ---------------------------------------------------------------------------
# VAPI provisioner
# ---------------------------------------------------------------------------

async def provision_vapi(org_id: str) -> dict:
    """
    Create a VAPI assistant and import the org's Twilio number into VAPI.
    Requires Twilio to be provisioned first.
    """
    org = await prisma.organization.find_unique(where={"id": org_id})
    if not org:
        raise ValueError(f"Org {org_id} not found")

    existing = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerName": "VAPI", "provisioned": True}
    )
    if existing:
        return {"status": "already_provisioned"}

    twilio_cfg = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerName": "TWILIO", "provisioned": True}
    )
    if not twilio_cfg:
        raise ValueError("Twilio must be provisioned before VAPI")

    from loomrun_api.telephony.crypto import decrypt_credentials
    raw_blob = _unwrap(twilio_cfg.credentials)
    if not raw_blob:
        raise ValueError("Twilio credentials missing")
    twilio_creds = decrypt_credentials(raw_blob)

    headers = _vapi_headers()
    base = "https://api.vapi.ai"

    async with httpx.AsyncClient(timeout=30) as client:
        assistant_resp = await client.post(
            f"{base}/assistant",
            headers=headers,
            json={
                "name": f"Loomrun – {org.name}",
                "model": {
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "messages": [{
                        "role": "system",
                        "content": (
                            f"You are a friendly sales assistant for {org.name}. "
                            "Introduce yourself, ask about the prospect's requirements, "
                            "and let them know a sales representative will follow up shortly. "
                            "Keep the call under 2 minutes."
                        ),
                    }],
                },
                "voice": {"provider": "11labs", "voiceId": "rachel"},
                "endCallFunctionEnabled": True,
                "endCallPhrases": ["goodbye", "bye", "talk later"],
            },
        )
        assistant_resp.raise_for_status()
        assistant_id = assistant_resp.json()["id"]

        number_resp = await client.post(
            f"{base}/phone-number",
            headers=headers,
            json={
                "provider": "twilio",
                "number": twilio_creds["phone_number"],
                "twilioAccountSid": twilio_creds["account_sid"],
                "twilioAuthToken": twilio_creds["auth_token"],
                "assistantId": assistant_id,
                "serverUrl": f"{settings.public_api_url.rstrip('/')}/v1/telephony/webhooks/vapi",
                "serverUrlSecret": settings.vapi_webhook_secret or "",
            },
        )
        number_resp.raise_for_status()
        phone_number_id = number_resp.json()["id"]

    creds = _wrap(encrypt_credentials({
        "assistant_id": assistant_id,
        "phone_number_id": phone_number_id,
    }))
    refs = {"assistant_id": assistant_id, "phone_number_id": phone_number_id}

    row = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerType": "AI_CALL", "providerName": "VAPI"}
    )
    if row:
        await prisma.telephonyconfig.update(
            where={"id": row.id},
            data={
                "status": "connected", "isActive": True, "provisioned": True,
                "phoneNumber": twilio_creds["phone_number"],
                "externalRefs": refs, "credentials": creds,
            },
        )
    else:
        await prisma.telephonyconfig.create(
            data={
                "organization": {"connect": {"id": org_id}},
                "providerType": "AI_CALL", "providerName": "VAPI",
                "status": "connected", "isActive": True, "provisioned": True,
                "phoneNumber": twilio_creds["phone_number"],
                "externalRefs": refs, "credentials": creds,
            },
        )

    logger.info("VAPI provisioned org=%s assistant=%s", org_id, assistant_id)
    return {"status": "provisioned", "assistant_id": assistant_id}


async def teardown_vapi(org_id: str) -> None:
    """Delete VAPI assistant and imported number on org teardown."""
    config = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerName": "VAPI", "provisioned": True}
    )
    if not config:
        return

    refs = config.externalRefs or {}
    headers = _vapi_headers()
    base = "https://api.vapi.ai"
    async with httpx.AsyncClient(timeout=30) as client:
        for resource, path in [
            (refs.get("phone_number_id"), "phone-number"),
            (refs.get("assistant_id"), "assistant"),
        ]:
            if resource:
                try:
                    await client.delete(f"{base}/{path}/{resource}", headers=headers)
                except Exception as exc:
                    logger.warning("VAPI teardown %s %s org=%s: %s", path, resource, org_id, exc)

    await prisma.telephonyconfig.update(
        where={"id": config.id},
        data={"status": "disconnected", "provisioned": False, "isActive": False, "credentials": None},
    )


# ---------------------------------------------------------------------------
# Exotel provisioner
# ---------------------------------------------------------------------------

async def provision_exotel(org_id: str) -> dict:
    """
    Enable Exotel click-to-call for an org using the platform master account.
    No sub-account is created — all orgs share the master Exotel account and ExoPhone.
    """
    if not all([settings.exotel_master_sid, settings.exotel_master_api_key,
                settings.exotel_master_api_token, settings.exotel_master_phone_number]):
        raise RuntimeError(
            "Exotel master credentials not configured "
            "(EXOTEL_MASTER_SID / EXOTEL_MASTER_API_KEY / EXOTEL_MASTER_API_TOKEN / EXOTEL_MASTER_PHONE_NUMBER)"
        )

    existing = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerName": "EXOTEL", "provisioned": True}
    )
    if existing:
        return {"status": "already_provisioned", "phone_number": existing.phoneNumber}

    creds = _wrap(encrypt_credentials({
        "sid": settings.exotel_master_sid,
        "api_key": settings.exotel_master_api_key,
        "api_token": settings.exotel_master_api_token,
        "phone_number": settings.exotel_master_phone_number,
    }))

    row = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerType": "VOICE", "providerName": "EXOTEL"}
    )
    if row:
        config = await prisma.telephonyconfig.update(
            where={"id": row.id},
            data={
                "status": "connected", "isActive": True, "provisioned": True,
                "phoneNumber": settings.exotel_master_phone_number,
                "credentials": creds,
            },
        )
    else:
        config = await prisma.telephonyconfig.create(
            data={
                "organization": {"connect": {"id": org_id}},
                "providerType": "VOICE", "providerName": "EXOTEL",
                "status": "connected", "isActive": True, "provisioned": True,
                "phoneNumber": settings.exotel_master_phone_number,
                "credentials": creds,
            },
        )

    logger.info("Exotel provisioned org=%s number=%s", org_id, config.phoneNumber)
    return {"status": "provisioned", "phone_number": config.phoneNumber}


async def teardown_exotel(org_id: str) -> None:
    """Mark Exotel config disconnected (shared master account — no remote resource to delete)."""
    config = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerName": "EXOTEL", "provisioned": True}
    )
    if not config:
        return
    await prisma.telephonyconfig.update(
        where={"id": config.id},
        data={"status": "disconnected", "provisioned": False, "isActive": False, "credentials": None},
    )
