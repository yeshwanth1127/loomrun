import hashlib
import hmac
import json
import logging
from datetime import datetime
from urllib.parse import urlencode

import httpx

from loomrun_api.config import settings

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.facebook.com/v19.0"
# Lead history pulls can paginate across many forms; keep requests alive.
_HTTP_TIMEOUT = httpx.Timeout(60.0, connect=15.0)


def build_oauth_url(redirect_uri: str, state: str) -> str:
    params: dict[str, str] = {
        "client_id": settings.meta_app_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "response_type": "code",
    }
    if settings.meta_fb_login_config_id:
        params["config_id"] = settings.meta_fb_login_config_id
    else:
        params["scope"] = (
            "leads_retrieval,pages_manage_metadata,pages_show_list,pages_read_engagement"
        )
    return f"https://www.facebook.com/v19.0/dialog/oauth?{urlencode(params)}"


async def exchange_code_for_token(code: str, redirect_uri: str) -> str:
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.get(
            f"{GRAPH_BASE}/oauth/access_token",
            params={
                "client_id": settings.meta_app_id,
                "client_secret": settings.meta_app_secret,
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


async def get_long_lived_token(short_token: str) -> dict:
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.get(
            f"{GRAPH_BASE}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": settings.meta_app_id,
                "client_secret": settings.meta_app_secret,
                "fb_exchange_token": short_token,
            },
        )
        resp.raise_for_status()
        return resp.json()  # {access_token, token_type, expires_in}


async def get_pages(user_token: str) -> list[dict]:
    """List Pages the user manages. Paginate — Graph defaults to 25."""
    pages: list[dict] = []
    url = f"{GRAPH_BASE}/me/accounts"
    params: dict[str, str | int] | None = {
        "access_token": user_token,
        "fields": "id,name,access_token",
        "limit": 100,
    }
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        while url:
            resp = await client.get(url, params=params or None)
            resp.raise_for_status()
            data = resp.json()
            pages.extend(data.get("data", []))
            url = data.get("paging", {}).get("next")
            params = None
    return pages


async def subscribe_page_to_leadgen(page_id: str, page_token: str) -> bool:
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/{page_id}/subscribed_apps",
            params={"access_token": page_token, "subscribed_fields": "leadgen"},
        )
        data = resp.json()
        return data.get("success", False)


async def fetch_leadgen(leadgen_id: str, page_token: str) -> dict:
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.get(
            f"{GRAPH_BASE}/{leadgen_id}",
            params={
                "access_token": page_token,
                "fields": "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,page_id",
            },
        )
        resp.raise_for_status()
        return resp.json()


def verify_webhook_signature(payload_bytes: bytes, signature_header: str | None) -> bool:
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(
        settings.meta_app_secret.encode(),
        payload_bytes,
        hashlib.sha256,
    ).hexdigest()
    received = signature_header[len("sha256="):]
    return hmac.compare_digest(expected, received)


def parse_field_data(field_data: list[dict]) -> dict:
    """Convert Meta's [{name, values}] list into a flat dict."""
    result = {}
    for field in field_data:
        name = field.get("name", "")
        values = field.get("values", [])
        result[name] = values[0] if values else None
    return result


async def fetch_lead_forms(page_id: str, page_token: str) -> list[dict]:
    forms = []
    url = f"{GRAPH_BASE}/{page_id}/leadgen_forms"
    params: dict[str, str | int] | None = {
        "access_token": page_token,
        "fields": "id,name,leads_count,status",
        "limit": 100,
    }
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        while url:
            # paging.next URLs already include query params; httpx drops them if params={}
            resp = await client.get(url, params=params or None)
            resp.raise_for_status()
            data = resp.json()
            forms.extend(data.get("data", []))
            url = data.get("paging", {}).get("next")
            params = None
    return forms


async def fetch_leads_from_form(
    form_id: str,
    page_token: str,
    since: datetime | None = None,
) -> list[dict]:
    """
    Fetch Instant Form leads for a form (cursor-paginated).

    When ``since`` is None, returns the full history Meta still exposes
    (typically ~90 days). Prefer full pulls for reconciliation — incremental
    ``time_created`` filters permanently skip any lead missed on an earlier run.
    """
    leads = []
    url = f"{GRAPH_BASE}/{form_id}/leads"
    params: dict[str, str | int] | None = {
        "access_token": page_token,
        "fields": "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,page_id",
        "limit": 100,
    }
    if since is not None:
        # Meta Lead Ads filtering on time_created (unix timestamp)
        ts = int(since.timestamp())
        params["filtering"] = json.dumps(
            [{"field": "time_created", "operator": "GREATER_THAN", "value": ts}]
        )
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        while url:
            # paging.next URLs already include query params; httpx drops them if params={}
            resp = await client.get(url, params=params or None)
            resp.raise_for_status()
            data = resp.json()
            leads.extend(data.get("data", []))
            url = data.get("paging", {}).get("next")
            params = None
    return leads


def map_lead_fields(flat: dict) -> dict:
    """Map Meta form field names to our Lead model fields."""
    name = (
        flat.get("full_name")
        or flat.get("name")
        or flat.get("first_name", "") + " " + flat.get("last_name", "")
    ).strip()
    return {
        "title": name or "Meta Lead",
        "phone": flat.get("phone_number") or flat.get("phone"),
        "email": flat.get("email"),
        "city": flat.get("city"),
        "company": flat.get("company_name") or flat.get("company"),
        "product_interest": flat.get("product_interest") or flat.get("what_are_you_interested_in"),
        "quantity_estimate": flat.get("quantity") or flat.get("quantity_estimate"),
    }
