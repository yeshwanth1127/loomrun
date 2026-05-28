import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.meta_client import (
    build_oauth_url,
    exchange_code_for_token,
    get_long_lived_token,
    get_pages,
    subscribe_page_to_leadgen,
)
from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)
router = APIRouter()

REDIRECT_URI_TEMPLATE = "{base}/v1/meta/oauth/callback"
DEFAULT_RETURN_PATH = "/app/leads/connections"


def _redirect_uri(base_url: str) -> str:
    return REDIRECT_URI_TEMPLATE.format(base=base_url.rstrip("/"))


def _return_with_status(return_url: str, meta: str, pages: int | None = None) -> str:
    sep = "&" if "?" in return_url else "?"
    qs = f"meta={meta}"
    if pages is not None:
        qs += f"&pages={pages}"
    return f"{return_url}{sep}{qs}"


def _parse_state(state: str) -> tuple[str, str, str] | None:
    parts = state.split("|", 2)
    if len(parts) != 3:
        return None
    org_id, api_base, return_url = parts
    if not org_id or not api_base or not return_url:
        return None
    return org_id, api_base, return_url


@router.get("/orgs/{org_id}/meta/oauth-url")
async def get_meta_oauth_url(
    org_id: str,
    base_url: str = Query(..., description="Public base URL of this API, e.g. https://34b2-....ngrok-free.app"),
    return_url: str = Query(..., description="Frontend URL to return to after OAuth"),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    if not settings.meta_app_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Meta integration not configured")
    redirect_uri = _redirect_uri(base_url)
    url = build_oauth_url(
        redirect_uri=redirect_uri,
        state=f"{org_id}|{base_url.rstrip('/')}|{return_url.rstrip('/')}",
    )
    return {"url": url}


@router.get("/meta/oauth/callback")
async def meta_oauth_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
) -> RedirectResponse:
    fallback = _return_with_status(
        f"{settings.cors_origin_list[0] if settings.cors_origin_list else 'http://localhost:5173'}{DEFAULT_RETURN_PATH}",
        "error",
    )

    if error or not code or not state:
        logger.warning("Meta OAuth error: %s — %s", error, error_description)
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
        short_token = await exchange_code_for_token(code, redirect_uri)
        long_token_data = await get_long_lived_token(short_token)
        user_token = long_token_data["access_token"]
        expires_in = long_token_data.get("expires_in", 5184000)  # default 60 days
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

        pages = await get_pages(user_token)
        page_records = []
        for page in pages:
            page_id = page["id"]
            page_token = page["access_token"]
            page_name = page["name"]
            subscribed = await subscribe_page_to_leadgen(page_id, page_token)
            page_records.append({
                "page_id": page_id,
                "page_name": page_name,
                "page_access_token": page_token,
                "subscribed": subscribed,
            })
            logger.info("Subscribed page %s (%s) to leadgen: %s", page_name, page_id, subscribed)

        credentials = {
            "user_access_token": user_token,
            "user_token_expires_at": expires_at,
            "pages": page_records,
        }

        existing = await prisma.leadconnection.find_first(
            where={"organizationId": org_id, "sourceName": "META_ADS"}
        )
        if existing:
            await prisma.leadconnection.update(
                where={"id": existing.id},
                data={"status": "connected", "credentials": credentials, "lastSync": datetime.now(timezone.utc)},
            )
        else:
            await prisma.leadconnection.create(
                data={
                    "organizationId": org_id,
                    "sourceName": "META_ADS",
                    "status": "connected",
                    "credentials": credentials,
                    "leadsCount": 0,
                }
            )

        page_count = len(page_records)
        return RedirectResponse(url=_return_with_status(return_url, "success", page_count))

    except Exception as exc:
        logger.exception("Meta OAuth callback failed: %s", exc)
        return RedirectResponse(url=_return_with_status(return_url, "error"))


@router.post("/orgs/{org_id}/meta/sync", status_code=status.HTTP_202_ACCEPTED)
async def trigger_meta_sync(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    connection = await prisma.leadconnection.find_first(
        where={"organizationId": ctx.organization_id, "sourceName": "META_ADS", "status": "connected"}
    )
    if not connection:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Meta Ads not connected")

    from loomrun_api.workers import sync_meta_leads_job
    asyncio.create_task(sync_meta_leads_job({}, ctx.organization_id))
    return {"status": "queued", "job_id": None}
