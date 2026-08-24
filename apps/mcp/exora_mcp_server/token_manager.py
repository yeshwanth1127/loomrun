from datetime import datetime, timedelta, timezone

import httpx

from exora_mcp_server.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
from exora_mcp_server.db import get_org_tokens, update_org_tokens

_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_BUFFER_SECONDS = 300  # refresh 5 min before actual expiry


async def get_valid_access_token(org_id: str, service_name: str) -> str:
    creds = await get_org_tokens(org_id, service_name)
    if not creds:
        raise ValueError(
            f"No {service_name} connection found for org '{org_id}'. "
            "The organisation owner must connect Google via Settings → Integrations."
        )

    access_token: str | None = creds.get("access_token")
    refresh_token: str | None = creds.get("refresh_token")
    expires_at: str | None = creds.get("expires_at")

    # Determine if token is still valid
    token_valid = False
    if access_token and expires_at:
        try:
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            token_valid = (exp - timedelta(seconds=_BUFFER_SECONDS)) > datetime.now(timezone.utc)
        except Exception:
            pass

    if token_valid:
        return access_token  # type: ignore[return-value]

    if not refresh_token:
        raise ValueError(
            f"No refresh token for {service_name} on org '{org_id}'. "
            "Please reconnect Google via Settings → Integrations."
        )

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    new_access_token: str = data["access_token"]
    new_expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
    ).isoformat()

    updated = {**creds, "access_token": new_access_token, "expires_at": new_expires_at}
    await update_org_tokens(org_id, service_name, updated)

    return new_access_token
