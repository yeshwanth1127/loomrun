"""Exotel voice provider adapter — click-to-call via API v2."""

from typing import Any

import httpx

from loomrun_api.telephony.adapters.base import CallResult, VoiceAdapter


class ExotelAdapter(VoiceAdapter):
    """
    Exotel click-to-call provider.

    Exotel does not have a browser WebRTC SDK like Twilio. Instead it uses a
    server-side click-to-call API: the platform calls the agent's phone first,
    waits for answer, then bridges to the customer.

    Credentials expected:
      sid          – Exotel Account SID (from dashboard)
      api_key      – API Key
      api_token    – API Token
      phone_number – ExoPhone virtual number used as caller ID
      api_subdomain – optional, defaults to api.in.exotel.com (India)
    """

    def _base_url(self) -> str:
        sid = self.credentials.get("sid", "")
        return f"https://api.exotel.com/v1/Accounts/{sid}"

    def _auth(self) -> tuple[str, str]:
        return (self.credentials.get("api_key", ""), self.credentials.get("api_token", ""))

    async def get_browser_token(self, identity: str) -> str:
        raise NotImplementedError("Exotel uses click-to-call, not browser WebRTC")

    async def build_twiml(self, to_number: str) -> str:
        raise NotImplementedError("Exotel does not use TwiML")

    @staticmethod
    def _normalize_phone(number: str) -> str:
        """Strip leading + to get bare E.164 digits Exotel accepts (e.g. 919876543210)."""
        return number.lstrip("+")

    async def initiate_click_to_call(
        self,
        agent_phone: str,
        customer_phone: str,
        status_callback: str,
    ) -> str:
        """
        Initiate a click-to-call via Exotel API v2.

        Exotel calls `agent_phone` first; once answered it bridges to
        `customer_phone` using `phone_number` (ExoPhone) as the caller ID
        visible to the customer.

        Returns the Exotel call SID.
        """
        caller_id = self.credentials.get("phone_number", "")
        if not caller_id:
            raise ValueError("Exotel phone_number (ExoPhone caller ID) not configured")

        # v1 API uses form-encoded data (Twilio-compatible)
        payload = {
            "From": self._normalize_phone(agent_phone),
            "To": self._normalize_phone(customer_phone),
            "CallerId": self._normalize_phone(caller_id),
            "Record": "true",
            "TimeLimit": "3600",
            "StatusCallback": status_callback,
            "StatusCallbackContentType": "application/json",
        }

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{self._base_url()}/Calls/connect.json",
                auth=self._auth(),
                data=payload,
            )
            if not resp.is_success:
                raise RuntimeError(
                    f"Exotel error {resp.status_code}: {resp.text[:400]}"
                )
            data = resp.json()
            return data.get("Call", {}).get("Sid", "")

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        status_map = {
            "completed": "CONNECTED",
            "no-answer": "NO_ANSWER",
            "busy": "BUSY",
            "failed": "NO_ANSWER",
            "canceled": "NO_ANSWER",
        }
        # v1 sends Status or CallStatus
        status = payload.get("Status", payload.get("CallStatus", "")).lower()
        duration = payload.get("Duration", payload.get("CallDuration", "0"))
        return CallResult(
            call_id=payload.get("CallSid", payload.get("Sid", "")),
            duration_seconds=int(duration or 0),
            outcome=status_map.get(status, "CONNECTED"),
        )
