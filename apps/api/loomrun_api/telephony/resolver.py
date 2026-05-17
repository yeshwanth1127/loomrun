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


async def get_active_voice_adapter(org_id: str) -> VoiceAdapter:
    """
    Get the active voice provider adapter for an organization.

    Args:
        org_id: Organization ID

    Returns:
        Instantiated VoiceAdapter

    Raises:
        ValueError: If no active voice provider is configured
    """
    config = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerType": "VOICE", "isActive": True}
    )

    if not config:
        raise ValueError(f"No active voice provider configured for org {org_id}")

    adapter_class = VOICE_ADAPTERS.get(config.providerName)
    if not adapter_class:
        raise ValueError(f"Unknown voice provider: {config.providerName}")

    credentials = config.credentials or {}
    return adapter_class(credentials)


async def get_active_ai_adapter(org_id: str) -> AICallAdapter:
    """
    Get the active AI call provider adapter for an organization.

    Args:
        org_id: Organization ID

    Returns:
        Instantiated AICallAdapter

    Raises:
        ValueError: If no active AI call provider is configured
    """
    config = await prisma.telephonyconfig.find_first(
        where={"organizationId": org_id, "providerType": "AI_CALL", "isActive": True}
    )

    if not config:
        raise ValueError(f"No active AI call provider configured for org {org_id}")

    adapter_class = AI_ADAPTERS.get(config.providerName)
    if not adapter_class:
        raise ValueError(f"Unknown AI call provider: {config.providerName}")

    credentials = config.credentials or {}
    return adapter_class(credentials)
