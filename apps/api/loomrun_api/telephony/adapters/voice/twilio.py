"""Twilio voice provider adapter."""

from typing import Any
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant

from loomrun_api.telephony.adapters.base import CallResult, VoiceAdapter


class TwilioAdapter(VoiceAdapter):
    """Twilio voice provider implementation."""

    async def get_browser_token(self, identity: str) -> str:
        """Generate Twilio access token for browser WebRTC SDK."""
        account_sid = self.credentials.get("account_sid")
        auth_token = self.credentials.get("auth_token")

        if not account_sid or not auth_token:
            raise ValueError("Missing Twilio account_sid or auth_token")

        token = AccessToken(account_sid, account_sid, identity)
        token.add_grant(VoiceGrant())
        return token.to_jwt().decode("utf-8")

    async def build_twiml(self, to_number: str) -> str:
        """Build TwiML for dialing a number with recording enabled."""
        phone_number = self.credentials.get("phone_number")

        if not phone_number:
            raise ValueError("Missing Twilio phone_number")

        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial record="record-from-answer" recordingStatusCallback="/v1/telecaller/webhooks/twilio">
        {to_number}
    </Dial>
</Response>"""
        return twiml

    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """Parse Twilio call-completed webhook."""
        # TODO: Parse Twilio webhook payload
        return CallResult(
            call_id=payload.get("CallSid", ""),
            duration_seconds=int(payload.get("RecordingDuration", 0)),
            transcript=None,  # Will be fetched from Twilio Transcriptions API
        )
