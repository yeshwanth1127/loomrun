"""Telnyx voice provider adapter."""

from typing import Any

from loomrun_api.telephony.adapters.base import CallResult, VoiceAdapter


class TelnyxAdapter(VoiceAdapter):
    """Telnyx voice provider implementation (stub)."""

    async def get_browser_token(self, identity: str) -> str:
        """Generate Telnyx browser token (stub)."""
        raise NotImplementedError("Telnyx adapter not yet implemented")

    async def build_twiml(self, to_number: str) -> str:
        """Build Telnyx XML response (stub)."""
        raise NotImplementedError("Telnyx adapter not yet implemented")

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """Parse Telnyx webhook (stub)."""
        raise NotImplementedError("Telnyx adapter not yet implemented")
