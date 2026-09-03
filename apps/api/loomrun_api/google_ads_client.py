"""Google Ads API client — OAuth token helpers and REST queries."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

import httpx

from loomrun_api.config import settings
from loomrun_api.google_client import (
    GOOGLE_TOKEN_URL,
    build_oauth_url,
    exchange_code_for_tokens,
    get_user_email,
)
from loomrun_api.prisma_json import json_meta

logger = logging.getLogger(__name__)

API_VERSION = "v18"
API_BASE = f"https://googleads.googleapis.com/{API_VERSION}"
_HTTP_TIMEOUT = httpx.Timeout(60.0, connect=15.0)

_CUSTOMER_RE = re.compile(r"customers/(\d+)")


def normalize_customer_id(customer_id: str) -> str:
    return customer_id.replace("-", "").strip()


def customer_id_from_resource(resource_name: str | None) -> str | None:
    if not resource_name:
        return None
    match = _CUSTOMER_RE.search(resource_name)
    return match.group(1) if match else None


def google_ads_configured() -> bool:
    return bool(
        settings.google_client_id
        and settings.google_client_secret
        and settings.google_ads_developer_token
        and settings.google_ads_login_customer_id
    )


def build_google_ads_oauth_url(redirect_uri: str, state: str) -> str:
    return build_oauth_url(redirect_uri, state, "GOOGLE_ADS")


def _ads_headers(
    access_token: str,
    *,
    login_customer_id: str | None = None,
    use_mcc_header: bool = True,
) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": settings.google_ads_developer_token,
        "Content-Type": "application/json",
    }
    if use_mcc_header:
        mcc = normalize_customer_id(login_customer_id or settings.google_ads_login_customer_id)
        if mcc:
            headers["login-customer-id"] = mcc
    return headers


async def get_valid_google_ads_token(org_id: str) -> tuple[str, dict]:
    """Return a valid access token and credentials dict for the org's Google Ads connection."""
    from loomrun_api.prisma_client import prisma

    conn = await prisma.leadconnection.find_first(
        where={"organizationId": org_id, "sourceName": "GOOGLE_ADS", "status": "connected"}
    )
    if not conn:
        raise ValueError(f"No active Google Ads connection for org {org_id}")

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
        return access_token, creds

    if not refresh_token:
        raise ValueError(f"No refresh token for Google Ads on org {org_id}")

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
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
    await prisma.leadconnection.update(
        where={"id": conn.id},
        data={"credentials": json_meta(updated_creds)},
    )
    return new_token, updated_creds


async def list_accessible_customers(access_token: str) -> list[str]:
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.get(
            f"{API_BASE}/customers:listAccessibleCustomers",
            headers=_ads_headers(access_token, use_mcc_header=False),
        )
        resp.raise_for_status()
        payload = resp.json()

    ids: list[str] = []
    for resource_name in payload.get("resourceNames", []):
        cid = customer_id_from_resource(resource_name)
        if cid:
            ids.append(cid)
    return ids


async def list_mcc_client_customers(access_token: str, mcc_id: str | None = None) -> list[dict]:
    """Return enabled non-manager accounts under the configured MCC."""
    login_id = normalize_customer_id(mcc_id or settings.google_ads_login_customer_id)
    query = """
        SELECT
          customer_client.client_customer,
          customer_client.descriptive_name,
          customer_client.manager,
          customer_client.status
        FROM customer_client
        WHERE customer_client.level = 1
          AND customer_client.manager = FALSE
          AND customer_client.status = 'ENABLED'
    """
    rows = await search_google_ads(login_id, access_token, query, login_customer_id=login_id)
    clients: list[dict] = []
    for row in rows:
        cc = row.get("customerClient") or row.get("customer_client") or {}
        resource = cc.get("clientCustomer") or cc.get("client_customer")
        cid = customer_id_from_resource(resource)
        if not cid:
            continue
        clients.append({
            "customer_id": cid,
            "name": cc.get("descriptiveName") or cc.get("descriptive_name"),
        })
    return clients


async def search_google_ads(
    customer_id: str,
    access_token: str,
    query: str,
    *,
    login_customer_id: str | None = None,
) -> list[dict]:
    cid = normalize_customer_id(customer_id)
    login_id = normalize_customer_id(login_customer_id or settings.google_ads_login_customer_id)
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.post(
            f"{API_BASE}/customers/{cid}/googleAds:search",
            headers=_ads_headers(access_token, login_customer_id=login_id),
            json={"query": query.strip()},
        )
        if resp.status_code >= 400:
            logger.warning(
                "Google Ads search failed customer=%s status=%s body=%s",
                cid,
                resp.status_code,
                resp.text[:500],
            )
            resp.raise_for_status()
        payload = resp.json()
    return payload.get("results", [])


async def discover_customer_ids(access_token: str) -> list[str]:
    """Intersect accessible customers with enabled clients under the platform MCC."""
    mcc = normalize_customer_id(settings.google_ads_login_customer_id)
    accessible = set(await list_accessible_customers(access_token))
    if mcc in accessible:
        accessible.discard(mcc)

    try:
        mcc_clients = await list_mcc_client_customers(access_token, mcc)
    except httpx.HTTPStatusError as exc:
        logger.warning("Could not list MCC clients for %s: %s", mcc, exc.response.text[:300])
        mcc_clients = []

    client_ids = [c["customer_id"] for c in mcc_clients if c.get("customer_id")]
    if client_ids:
        if accessible:
            matched = [cid for cid in client_ids if cid in accessible]
            if matched:
                return matched
        return client_ids

    if accessible:
        return sorted(cid for cid in accessible if cid != mcc)
    return []


async def fetch_lead_form_submissions(customer_id: str, access_token: str) -> list[dict]:
    query = """
        SELECT
          lead_form_submission_data.id,
          lead_form_submission_data.asset,
          lead_form_submission_data.campaign,
          lead_form_submission_data.submission_date_time,
          lead_form_submission_data.lead_form_submission_fields,
          campaign.id,
          campaign.name
        FROM lead_form_submission_data
    """
    return await search_google_ads(customer_id, access_token, query)


def map_submission_fields(fields: list[dict] | None) -> dict[str, str | None]:
    out: dict[str, str | None] = {
        "title": None,
        "email": None,
        "phone": None,
        "city": None,
        "company": None,
        "first_name": None,
        "last_name": None,
    }
    if not fields:
        return out

    for field in fields:
        field_type = (field.get("fieldType") or field.get("field_type") or "").upper()
        value = (field.get("fieldValue") or field.get("field_value") or "").strip() or None
        if not value:
            continue
        if field_type == "FULL_NAME":
            out["title"] = value
        elif field_type == "FIRST_NAME":
            out["first_name"] = value
        elif field_type == "LAST_NAME":
            out["last_name"] = value
        elif field_type == "EMAIL":
            out["email"] = value
        elif field_type == "PHONE_NUMBER":
            out["phone"] = value
        elif field_type == "CITY":
            out["city"] = value
        elif field_type == "COMPANY_NAME":
            out["company"] = value

    if not out["title"]:
        parts = [p for p in (out["first_name"], out["last_name"]) if p]
        if parts:
            out["title"] = " ".join(parts)
    return out


async def complete_oauth(code: str, redirect_uri: str) -> dict:
    token_data = await exchange_code_for_tokens(code, redirect_uri)
    access_token = token_data["access_token"]
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    connected_email = await get_user_email(access_token)
    customer_ids = await discover_customer_ids(access_token)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "connected_email": connected_email,
        "login_customer_id": normalize_customer_id(settings.google_ads_login_customer_id),
        "customer_ids": customer_ids,
    }
