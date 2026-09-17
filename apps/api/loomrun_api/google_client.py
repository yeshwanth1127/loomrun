import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from loomrun_api.config import settings

logger = logging.getLogger(__name__)

GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

SERVICE_SCOPES: dict[str, list[str]] = {
    "GMAIL": [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
    ],
    "GOOGLE_CALENDAR": [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
    ],
    "GOOGLE_ADS": [
        "https://www.googleapis.com/auth/adwords",
    ],
}


def build_oauth_url(redirect_uri: str, state: str, service_name: str) -> str:
    scopes = SERVICE_SCOPES.get(service_name, [])
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(scopes + ["openid", "email", "profile"]),
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{GOOGLE_AUTH_BASE}?{urlencode(params)}"


async def exchange_code_for_tokens(code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def get_valid_org_token(org_id: str, service_name: str) -> str:
    """Return a valid access token for an org's (CEO) Google connection."""
    return await get_valid_connection_token(org_id, service_name, membership_id=None)


async def get_valid_connection_token(
    org_id: str,
    service_name: str,
    *,
    membership_id: str | None = None,
) -> str:
    """Valid access token for org (membership_id=None) or personal Google connection."""
    from loomrun_api.member_connections import get_member_automation, get_org_automation
    from loomrun_api.prisma_client import prisma
    from loomrun_api.prisma_json import json_meta

    if membership_id:
        conn = await get_member_automation(membership_id, service_name)
        scope_label = f"membership {membership_id}"
    else:
        conn = await get_org_automation(org_id, service_name)
        scope_label = f"org {org_id}"

    if not conn or conn.status != "connected":
        raise ValueError(f"No active {service_name} connection for {scope_label}")

    creds: dict = conn.credentials if isinstance(conn.credentials, dict) else {}
    access_token: str | None = creds.get("access_token")
    refresh_token: str | None = creds.get("refresh_token")
    expires_at: str | None = creds.get("expires_at")

    token_valid = False
    if access_token and expires_at:
        try:
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            token_valid = (exp - timedelta(minutes=5)) > datetime.now(timezone.utc)
        except Exception:
            pass

    if token_valid and access_token:
        return access_token

    if not refresh_token:
        raise ValueError(f"No refresh token for {service_name} on {scope_label}")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    new_token: str = data["access_token"]
    new_expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
    ).isoformat()

    updated_creds = {**creds, "access_token": new_token, "expires_at": new_expires_at}
    await prisma.automationconnection.update(
        where={"id": conn.id},
        data={"credentials": json_meta(updated_creds)},
    )
    return new_token


async def resolve_gmail_token_for_actor(org_id: str, membership_id: str | None) -> str:
    """Prefer personal Gmail when connected; else fall back to org Gmail."""
    if membership_id:
        try:
            return await get_valid_connection_token(org_id, "GMAIL", membership_id=membership_id)
        except ValueError:
            pass
    return await get_valid_connection_token(org_id, "GMAIL", membership_id=None)


async def get_user_email(access_token: str) -> str | None:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            logger.warning("Google userinfo failed: %s", resp.text)
            return None
        return resp.json().get("email")
