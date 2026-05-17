"""Bland.ai call provider adapter."""

from typing import Any

from loomrun_api.telephony.adapters.base import CallResult, AICallAdapter


class BlandAdapter(AICallAdapter):
    """Bland.ai call provider implementation (stub)."""

    async def initiate_call(self, lead_phone: str, lead_name: str, metadata: dict[str, Any]) -> str:
        """Initiate an outbound call via Bland.ai (stub)."""
        raise NotImplementedError("Bland.ai adapter not yet implemented")

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """Parse Bland.ai webhook (stub)."""
        raise NotImplementedError("Bland.ai adapter not yet implemented")
