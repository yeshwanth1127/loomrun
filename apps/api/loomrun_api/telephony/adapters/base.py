"""Base adapter classes for telephony providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class CallResult:
    """Result of parsing a webhook call event."""
    call_id: str
    duration_seconds: int | None = None
    transcript: str | None = None
    summary: str | None = None
    outcome: str | None = None
    notes: str | None = None


class VoiceAdapter(ABC):
    """Abstract base class for voice providers (human browser calls)."""

    def __init__(self, credentials: dict[str, Any]):
        """Initialize adapter with provider credentials."""
        self.credentials = credentials

    @abstractmethod
    async def get_browser_token(self, identity: str) -> str:
        """
        Generate a browser SDK token for WebRTC calls.

        Args:
            identity: User email or ID for the call

        Returns:
            JWT token for browser SDK
        """
        pass

    @abstractmethod
    async def build_twiml(self, to_number: str) -> str:
        """
        Build TwiML/equivalent response to dial a phone number.

        Args:
            to_number: Lead's phone number to dial

        Returns:
            TwiML XML string (for Twilio) or provider-specific response
        """
        pass

    @abstractmethod
    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """
        Parse provider webhook payload (call completed).

        Args:
            payload: Raw webhook POST body from provider

        Returns:
            CallResult with extracted data
        """
        pass


class AICallAdapter(ABC):
    """Abstract base class for AI call providers (automated fallback)."""

    def __init__(self, credentials: dict[str, Any]):
        """Initialize adapter with provider credentials."""
        self.credentials = credentials

    @abstractmethod
    async def initiate_call(self, lead_phone: str, lead_name: str, metadata: dict[str, Any]) -> str:
        """
        Initiate an outbound AI call to a lead.

        Args:
            lead_phone: Lead's phone number
            lead_name: Lead's name
            metadata: Dict with lead_id, org_id for webhook tracking

        Returns:
            Call ID from the provider (used for webhook routing)
        """
        pass

    @abstractmethod
    async def parse_webhook(self, payload: dict[str, Any]) -> CallResult:
        """
        Parse provider webhook payload (AI call completed).

        Args:
            payload: Raw webhook POST body from provider

        Returns:
            CallResult with transcript, summary, outcome
        """
        pass
