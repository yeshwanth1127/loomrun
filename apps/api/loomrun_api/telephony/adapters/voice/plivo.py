"""Plivo voice provider adapter."""

from typing import Any

from loomrun_api.telephony.adapters.base import CallResult, VoiceAdapter


class PlivoAdapter(VoiceAdapter):
    """Plivo voice provider implementation (stub)."""

    async def get_browser_token(self, identity: str) -> str:
        """Generate Plivo browser token (stub)."""
        raise NotImplementedError("Plivo adapter not yet implemented")

    async def build_twiml(self, to_number: str) -> str:
        """Build Plivo XML response (stub)."""
        raise NotImplementedError("Plivo adapter not yet implemented")

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """Parse Plivo webhook (stub)."""
        raise NotImplementedError("Plivo adapter not yet implemented")
