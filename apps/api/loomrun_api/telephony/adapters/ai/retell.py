"""Retell AI call provider adapter."""

from typing import Any

from loomrun_api.telephony.adapters.base import CallResult, AICallAdapter


class RetellAdapter(AICallAdapter):
    """Retell AI call provider implementation (stub)."""

    async def initiate_call(self, lead_phone: str, lead_name: str, metadata: dict[str, Any]) -> str:
        """Initiate an outbound call via Retell AI (stub)."""
        raise NotImplementedError("Retell AI adapter not yet implemented")

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """Parse Retell AI webhook (stub)."""
        raise NotImplementedError("Retell AI adapter not yet implemented")
