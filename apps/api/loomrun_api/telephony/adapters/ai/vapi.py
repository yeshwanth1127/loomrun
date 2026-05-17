"""VAPI AI call provider adapter."""

import httpx
from typing import Any

from loomrun_api.telephony.adapters.base import CallResult, AICallAdapter


class VAPIAdapter(AICallAdapter):
    """VAPI AI call provider implementation."""

    VAPI_API_URL = "https://api.vapi.ai"

    async def initiate_call(self, lead_phone: str, lead_name: str, metadata: dict[str, Any]) -> str:
        """Initiate an outbound call via VAPI."""
        api_key = self.credentials.get("api_key")
        phone_number_id = self.credentials.get("phone_number_id")
        assistant_id = self.credentials.get("assistant_id")

        if not all([api_key, phone_number_id, assistant_id]):
            raise ValueError("Missing VAPI credentials: api_key, phone_number_id, or assistant_id")

        payload = {
            "assistantId": assistant_id,
            "phoneNumberId": phone_number_id,
            "customer": {
                "number": lead_phone,
                "name": lead_name,
            },
            "assistantOverrides": {
                "variableValues": {
                    "lead_name": lead_name,
                }
            },
            "metadata": metadata,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.VAPI_API_URL}/call/phone",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()

        data = response.json()
        return data.get("id", "")

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """Parse VAPI call-ended webhook."""
        # TODO: Parse VAPI webhook payload
        return CallResult(
            call_id=payload.get("id", ""),
            duration_seconds=payload.get("durationSeconds"),
            transcript=payload.get("transcript"),
            summary=payload.get("summary"),
        )
