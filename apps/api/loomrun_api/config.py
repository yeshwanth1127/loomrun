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
    meta_app_id: str = ""
    meta_app_secret: str = ""
    meta_webhook_verify_token: str = "[REDACTED]"
    # Public API base URL for webhook URLs shown in the UI (use ngrok URL when testing locally)
    public_api_url: str = "http://localhost:8000"
    # Comma-separated emails (case-insensitive) granted is_super_admin on register/login
    super_admin_emails: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def super_admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.super_admin_emails.split(",") if e.strip()}


settings = Settings()
