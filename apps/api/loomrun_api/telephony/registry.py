"""Provider registry - single source of truth for all telephony providers."""

VOICE_PROVIDERS = [
    {
        "provider_name": "TWILIO",
        "label": "Twilio",
        "provider_type": "VOICE",
        "credential_fields": ["account_sid", "auth_token", "phone_number", "twiml_app_sid"],
        "cost_per_min": 0.022,
        "docs_url": "https://www.twilio.com/docs/voice",
    },
    {
        "provider_name": "PLIVO",
        "label": "Plivo",
        "provider_type": "VOICE",
        "credential_fields": ["auth_id", "auth_token", "phone_number"],
        "cost_per_min": 0.015,
        "docs_url": "https://www.plivo.com/docs/voice/",
    },
    {
        "provider_name": "EXOTEL",
        "label": "Exotel",
        "provider_type": "VOICE",
        "credential_fields": ["api_key", "api_token", "sid", "phone_number"],
        "cost_per_min": 0.007,
        "docs_url": "https://exotel.com/api/",
    },
    {
        "provider_name": "TELNYX",
        "label": "Telnyx",
        "provider_type": "VOICE",
        "credential_fields": ["api_key", "phone_number"],
        "cost_per_min": 0.005,
        "docs_url": "https://developers.telnyx.com/docs/voice/call-control/",
    },
    {
        "provider_name": "VONAGE",
        "label": "Vonage (Nexmo)",
        "provider_type": "VOICE",
        "credential_fields": ["api_key", "api_secret", "phone_number"],
        "cost_per_min": 0.018,
        "docs_url": "https://developer.vonage.com/en/voice/voice-api/overview",
    },
]

AI_CALL_PROVIDERS = [
    {
        "provider_name": "VAPI",
        "label": "VAPI",
        "provider_type": "AI_CALL",
        "credential_fields": ["api_key", "phone_number_id", "assistant_id"],
        "cost_per_min": 0.05,
        "docs_url": "https://docs.vapi.ai/",
    },
    {
        "provider_name": "RETELL",
        "label": "Retell AI",
        "provider_type": "AI_CALL",
        "credential_fields": ["api_key", "phone_number"],
        "cost_per_min": 0.07,
        "docs_url": "https://docs.retellai.com/",
    },
    {
        "provider_name": "BLAND",
        "label": "Bland.ai",
        "provider_type": "AI_CALL",
        "credential_fields": ["api_key", "phone_number"],
        "cost_per_min": 0.09,
        "docs_url": "https://docs.bland.ai/",
    },
]

ALL_PROVIDERS = VOICE_PROVIDERS + AI_CALL_PROVIDERS


def get_provider_by_name(provider_name: str) -> dict | None:
    """Get provider definition by name."""
    for provider in ALL_PROVIDERS:
        if provider["provider_name"] == provider_name:
            return provider
    return None


def get_providers_by_type(provider_type: str) -> list[dict]:
    """Get all providers of a given type (VOICE or AI_CALL)."""
    return [p for p in ALL_PROVIDERS if p["provider_type"] == provider_type]
