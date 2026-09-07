from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Set DATABASE_URL in the repository root `.env` (or the process environment).
    database_url: str
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7
    cors_origins: str = "http://localhost:5173"
    storage_dir: Path = _REPO_ROOT / "storage"
    whatsapp_verify_token: str = ""
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    # Self-hosted Baileys WhatsApp sidecar (per-org sessions, sends from the org's own number)
    baileys_service_url: str = "http://127.0.0.1:8090"
    baileys_service_secret: str = ""
    meta_app_id: str = ""
    meta_app_secret: str = ""
    # Facebook Login for Business configuration ID (from Meta → Configurations).
    # When set, OAuth uses config_id instead of scope (recommended for Lead Ads apps).
    meta_fb_login_config_id: str = ""
    meta_webhook_verify_token: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    google_ads_developer_token: str = ""
    google_ads_login_customer_id: str = ""
    # Public n8n UI URL (optional — links to workflow editor in Integrations)
    n8n_public_url: str = ""
    # Webhook base URL for Loomrun → n8n events (e.g. https://n8n.example.com/webhook)
    # Falls back to {N8N_PUBLIC_URL}/webhook when unset
    n8n_webhook_url: str = ""
    # n8n REST API (required for auto-cloning workflows per org)
    n8n_api_url: str = ""
    n8n_api_key: str = ""
    # OpenRouter for server-side LLM (n8n workflows call Loomrun, not OpenRouter directly)
    openrouter_api_key: str = ""
    openrouter_default_model: str = "openai/gpt-4o-mini"
    # Optional comma-separated allowlist for the AI chat model dropdown.
    # Entries: "provider/model" or "provider/model|Display Label"
    openrouter_chat_models: str = ""
    openrouter_http_referer: str = ""
    openrouter_app_title: str = "Loomrun"
    # Shared secret for n8n → Loomrun automation API (LLM proxy, future hooks)
    loomrun_automation_api_key: str = ""
    # ── Qlix (per-org AI: one Qlix workspace + agent + brain per Loomrun org) ──
    # Master switch. When false, Loomrun runs its own in-process agent for every
    # turn: no run is handed to Qlix, no org can be provisioned, and existing
    # connection rows are ignored rather than deleted, so this is reversible by
    # flipping the flag back. The two agents share one tool registry, so nothing
    # the agent can do depends on which one answers.
    qlix_enabled: bool = True
    qlix_base_url: str = "https://qlix.exora.solutions/api/v1"
    # Partner secret (qlix_partner_*) — used ONLY to provision per-org tenants.
    # Every other call uses the org's own qlix_live_* key.
    qlix_partner_key: str = ""
    qlix_default_model: str = "openrouter/openai/gpt-4o-mini"
    # Public URL Qlix calls for CRM tools (Loomrun's MCP server, streamable-http).
    qlix_mcp_url: str = ""
    # Signing key for the X-Loomrun-Context token Qlix forwards on each tool call.
    # Falls back to secret_key so there is no extra key to manage in dev.
    qlix_context_secret: str = ""
    # Context tokens are short-lived; a run should never outlive one.
    qlix_context_ttl_seconds: int = 900
    # Public API base URL for webhook URLs shown in the UI (use ngrok URL when testing locally)
    public_api_url: str = "http://localhost:8000"
    # Platform-managed telephony — master Twilio account (owns all subaccounts)
    twilio_master_account_sid: str = ""
    twilio_master_auth_token: str = ""
    twilio_master_api_key_sid: str = ""
    twilio_master_api_key_secret: str = ""
    # ISO country code used when buying phone numbers (e.g. "IN" for India)
    twilio_number_country: str = "IN"
    # VAPI master account key (shared across all provisioned orgs)
    vapi_master_api_key: str = ""
    # Billing markup: billed_cost = provider_cost × telephony_markup_multiplier
    telephony_markup_multiplier: float = 1.5
    # Shared secret for VAPI → Loomrun webhooks (set this in the VAPI dashboard)
    vapi_webhook_secret: str = ""
    # Platform-managed Exotel master account (India click-to-call)
    exotel_master_sid: str = ""
    exotel_master_api_key: str = ""
    exotel_master_api_token: str = ""
    exotel_master_phone_number: str = ""   # ExoPhone number, e.g. +914066XXXXXX
    # Comma-separated emails (case-insensitive) granted is_super_admin on register/login
    super_admin_emails: str = ""
    # Support inbox for subscription upgrade requests (admin-assigned plans for now)
    subscription_support_email: str = "support@loomrun.com"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def super_admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.super_admin_emails.split(",") if e.strip()}

    @property
    def n8n_webhook_base(self) -> str:
        if self.n8n_webhook_url.strip():
            return self.n8n_webhook_url.rstrip("/")
        if self.n8n_public_url.strip():
            return f"{self.n8n_public_url.rstrip('/')}/webhook"
        return ""

    @property
    def n8n_automation_ready(self) -> bool:
        return bool(self.n8n_api_url.strip() and self.n8n_api_key.strip() and self.n8n_webhook_base)

    @property
    def llm_ready(self) -> bool:
        return bool(self.openrouter_api_key.strip() and self.loomrun_automation_api_key.strip())

    @property
    def qlix_context_signing_key(self) -> str:
        return self.qlix_context_secret.strip() or self.secret_key

    @property
    def qlix_ready(self) -> bool:
        """True when an org can actually be provisioned end to end.

        The MCP URL is required: without it Qlix has no way to reach Loomrun's
        CRM tools, and the agent would answer questions but be unable to act.
        """
        return bool(
            self.qlix_enabled
            and self.qlix_partner_key.strip()
            and self.qlix_mcp_url.strip()
        )


settings = Settings()
