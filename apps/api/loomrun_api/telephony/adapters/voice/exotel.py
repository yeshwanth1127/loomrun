"""Exotel voice provider adapter."""

from typing import Any

from loomrun_api.telephony.adapters.base import CallResult, VoiceAdapter


class ExotelAdapter(VoiceAdapter):
    """Exotel voice provider implementation (stub)."""

    async def get_browser_token(self, identity: str) -> str:
        """Generate Exotel browser token (stub)."""
        raise NotImplementedError("Exotel adapter not yet implemented")

    async def build_twiml(self, to_number: str) -> str:
        """Build Exotel XML response (stub)."""
        raise NotImplementedError("Exotel adapter not yet implemented")

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """Parse Exotel webhook (stub)."""
        raise NotImplementedError("Exotel adapter not yet implemented")
