"""Runtime resolver for active provider adapters."""

from typing import Any

from loomrun_api.prisma_client import prisma
from loomrun_api.telephony.adapters.base import AICallAdapter, VoiceAdapter

# Import all adapters
from loomrun_api.telephony.adapters.voice.twilio import TwilioAdapter
from loomrun_api.telephony.adapters.voice.plivo import PlivoAdapter
from loomrun_api.telephony.adapters.voice.exotel import ExotelAdapter
from loomrun_api.telephony.adapters.voice.telnyx import TelnyxAdapter
from loomrun_api.telephony.adapters.voice.vonage import VonageAdapter
from loomrun_api.telephony.adapters.ai.vapi import VAPIAdapter
from loomrun_api.telephony.adapters.ai.retell import RetellAdapter
from loomrun_api.telephony.adapters.ai.bland import BlandAdapter

VOICE_ADAPTERS = {
    "TWILIO": TwilioAdapter,
    "PLIVO": PlivoAdapter,
    "EXOTEL": ExotelAdapter,
    "TELNYX": TelnyxAdapter,
    "VONAGE": VonageAdapter,
}

AI_ADAPTERS = {
    "VAPI": VAPIAdapter,
    "RETELL": RetellAdapter,
    "BLAND": BlandAdapter,
}


def _resolve_credentials(config) -> dict:
    """
    Return usable credentials dict from a TelephonyConfig row.
    Provisioned configs store an encrypted blob; BYO configs store a plain dict.
    """
    raw = config.credentials
    if not raw:
        return {}
    from loomrun_api.telephony.crypto import decrypt_credentials
    if isinstance(raw, dict) and "blob" in raw:
        try:
            creds = decrypt_credentials(raw["blob"])
        except Exception:
            return {}
    elif isinstance(raw, str):
        try:
            creds = decrypt_credentials(raw)
        except Exception:
            return {}
    else:
        creds = dict(raw)

    # Provisioned VAPI configs don't store the API key — inject master key
    if config.providerName == "VAPI" and config.provisioned and not creds.get("api_key"):
        from loomrun_api.config import settings
        creds["api_key"] = settings.vapi_master_api_key

    return creds


async def get_active_voice_adapter(org_id: str) -> VoiceAdapter:
    config = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerType": "VOICE", "isActive": True}
    )
    if not config:
        raise ValueError(f"No active voice provider configured for org {org_id}")

    adapter_class = VOICE_ADAPTERS.get(config.providerName)
    if not adapter_class:
        raise ValueError(f"Unknown voice provider: {config.providerName}")

    return adapter_class(_resolve_credentials(config))


async def get_active_ai_adapter(org_id: str) -> AICallAdapter:
    config = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerType": "AI_CALL", "isActive": True}
    )
    if not config:
        raise ValueError(f"No active AI call provider configured for org {org_id}")

    adapter_class = AI_ADAPTERS.get(config.providerName)
    if not adapter_class:
        raise ValueError(f"Unknown AI call provider: {config.providerName}")

    return adapter_class(_resolve_credentials(config))
