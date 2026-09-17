import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from loomrun_api.oauth_state import encode_state, decode_state
from fastapi.responses import RedirectResponse

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, require_feature, require_roles
from loomrun_api.google_ads_client import (
    build_google_ads_oauth_url,
    complete_oauth,
    google_ads_configured,
)
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta

logger = logging.getLogger(__name__)
router = APIRouter()

REDIRECT_URI_TEMPLATE = "{base}/v1/google-ads/oauth/callback"
DEFAULT_RETURN_PATH = "/app/leads/connections"


def _api_base_url() -> str:
    return settings.public_api_url.rstrip("/")


def _redirect_uri(base_url: str) -> str:
    return REDIRECT_URI_TEMPLATE.format(base=base_url.rstrip("/"))


def _normalize_return_url(return_url: str) -> str:
    url = return_url.rstrip("/")
    allowed = settings.cors_origin_list
    if allowed and not any(
        url == origin.rstrip("/") or url.startswith(origin.rstrip("/") + "/") for origin in allowed
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="return_url must match a configured CORS origin",
        )
    return url


def _return_with_status(return_url: str, google_ads: str, customers: int | None = None) -> str:
    sep = "&" if "?" in return_url else "?"
    qs = f"google_ads={google_ads}"
    if customers is not None:
        qs += f"&customers={customers}"
    return f"{return_url}{sep}{qs}"


def _parse_state(state: str) -> tuple[str, str, str] | None:
    parts = state.split("|", 2)
    if len(parts) != 3:
        return None
    org_id, api_base, return_url = parts
    if not org_id or not api_base or not return_url:
        return None
    return org_id, api_base, return_url


@router.get("/orgs/{org_id}/google-ads/oauth-url")
async def get_google_ads_oauth_url(
    org_id: str,
    response: Response,
    return_url: str = Query(..., description="Frontend URL to return to after OAuth"),
    ctx: OrgContext = Depends(require_feature("google_ads")),
    _owner: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    if not google_ads_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Ads integration not configured",
        )

    api_base = _api_base_url()
    redirect_uri = _redirect_uri(api_base)
    safe_return = _normalize_return_url(return_url)
    url = build_google_ads_oauth_url(
        redirect_uri=redirect_uri,
        state=encode_state("google_ads", f"{org_id}|{api_base}|{safe_return}", response),
    )
    return {"url": url, "redirect_uri": redirect_uri}


@router.get("/google-ads/oauth/callback")
async def google_ads_oauth_callback(
    request: Request,
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
) -> RedirectResponse:
    state = decode_state("google_ads", state, request) if state else None
    fallback = _return_with_status(
        f"{settings.cors_origin_list[0] if settings.cors_origin_list else 'http://localhost:5173'}{DEFAULT_RETURN_PATH}",
        "error",
    )

    if error or not code or not state:
        logger.warning("Google Ads OAuth error: %s", error)
        parsed = _parse_state(state) if state else None
        if parsed:
            _, _, return_url = parsed
            return RedirectResponse(url=_return_with_status(return_url, "error"))
        return RedirectResponse(url=fallback)

    parsed = _parse_state(state)
    if not parsed:
        return RedirectResponse(url=fallback)

    org_id, base_url, return_url = parsed

    org = await prisma.organization.find_unique(where={"id": org_id})
    if not org:
        return RedirectResponse(url=_return_with_status(return_url, "error"))

    try:
        redirect_uri = _redirect_uri(base_url)
        credentials = await complete_oauth(code, redirect_uri)
        creds_json = json_meta(credentials)

        existing = await prisma.leadconnection.find_first(
            where={"organizationId": org_id, "sourceName": "GOOGLE_ADS"}
        )
        if existing:
            await prisma.leadconnection.update(
                where={"id": existing.id},
                data={
                    "status": "connected",
                    "credentials": creds_json,
                    "lastSync": None,
                },
            )
        else:
            await prisma.leadconnection.create(
                data={
                    "organizationId": org_id,
                    "sourceName": "GOOGLE_ADS",
                    "status": "connected",
                    "credentials": creds_json,
                    "leadsCount": 0,
                }
            )

        from loomrun_api.google_ads_sync import sync_org

        asyncio.create_task(sync_org(org_id))

        customer_count = len(credentials.get("customer_ids") or [])
        return RedirectResponse(url=_return_with_status(return_url, "success", customer_count))

    except Exception as exc:
        logger.exception("Google Ads OAuth callback failed: %s", exc)
        return RedirectResponse(url=_return_with_status(return_url, "error"))


@router.post("/orgs/{org_id}/google-ads/sync")
async def trigger_google_ads_sync(
    org_id: str,
    ctx: OrgContext = Depends(require_feature("google_ads")),
    _owner: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    connection = await prisma.leadconnection.find_first(
        where={
            "organizationId": ctx.organization_id,
            "sourceName": "GOOGLE_ADS",
            "status": "connected",
        }
    )
    if not connection:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Google Ads not connected")

    from loomrun_api.google_ads_sync import sync_org

    return await sync_org(ctx.organization_id)
