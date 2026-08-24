"""Twilio voice provider adapter."""

from typing import Any

from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant

from loomrun_api.telephony.adapters.base import CallResult, VoiceAdapter


class TwilioAdapter(VoiceAdapter):

    async def get_browser_token(self, identity: str) -> str:
        """Generate a Twilio Access Token for the browser Voice SDK."""
        account_sid = self.credentials.get("account_sid")
        api_key_sid = self.credentials.get("api_key_sid")
        api_key_secret = self.credentials.get("api_key_secret")
        twiml_app_sid = self.credentials.get("twiml_app_sid")

        if not all([account_sid, api_key_sid, api_key_secret]):
            raise ValueError("Missing Twilio credentials: account_sid, api_key_sid, api_key_secret")

        token = AccessToken(account_sid, api_key_sid, api_key_secret, identity=identity, ttl=3600)
        grant = VoiceGrant(outgoing_application_sid=twiml_app_sid, incoming_allow=True)
        token.add_grant(grant)
        jwt = token.to_jwt()
        return jwt.decode("utf-8") if isinstance(jwt, bytes) else jwt

    async def build_twiml(self, to_number: str) -> str:
        phone_number = self.credentials.get("phone_number", "")
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="{phone_number}" record="record-from-answer-dual">
    {to_number}
  </Dial>
</Response>"""

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        status_map = {
            "completed": "CONNECTED",
            "no-answer": "NO_ANSWER",
            "busy": "BUSY",
            "failed": "NO_ANSWER",
        }
        return CallResult(
            call_id=payload.get("CallSid", ""),
            duration_seconds=int(payload.get("CallDuration", 0) or 0),
            outcome=status_map.get(payload.get("CallStatus", ""), "CONNECTED"),
        )
