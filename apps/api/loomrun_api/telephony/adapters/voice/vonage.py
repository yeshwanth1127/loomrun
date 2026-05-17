"""Vonage (Nexmo) voice provider adapter."""

from typing import Any

from loomrun_api.telephony.adapters.base import CallResult, VoiceAdapter


class VonageAdapter(VoiceAdapter):
    """Vonage (Nexmo) voice provider implementation (stub)."""

    async def get_browser_token(self, identity: str) -> str:
        """Generate Vonage browser token (stub)."""
        raise NotImplementedError("Vonage adapter not yet implemented")

    async def build_twiml(self, to_number: str) -> str:
        """Build Vonage XML response (stub)."""
        raise NotImplementedError("Vonage adapter not yet implemented")

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """Parse Vonage webhook (stub)."""
        raise NotImplementedError("Vonage adapter not yet implemented")
