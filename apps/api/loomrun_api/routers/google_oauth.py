import logging
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, require_feature, require_roles
from loomrun_api.google_client import (
    SERVICE_SCOPES,
    build_oauth_url,
    exchange_code_for_tokens,
    get_user_email,
)
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.routers.automation_connections import ALL_AUTOMATIONS

logger = logging.getLogger(__name__)
router = APIRouter()

REDIRECT_URI_TEMPLATE = "{base}/v1/google/oauth/callback"
DEFAULT_RETURN_PATH = "/app/leads/connections"
VALID_SERVICES = {a["service_name"] for a in ALL_AUTOMATIONS}
TELECALLER_GOOGLE_SERVICES = {"GMAIL"}


def _role_name(ctx: OrgContext) -> str:
    return ctx.membership.role.name if hasattr(ctx.membership.role, "name") else str(ctx.membership.role)


def _assert_google_service_allowed(ctx: OrgContext, service_name: str) -> None:
    if _role_name(ctx) == "TELECALLER" and service_name not in TELECALLER_GOOGLE_SERVICES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Insufficient role")


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


def _return_with_status(return_url: str, google: str, service: str | None = None) -> str:
    sep = "&" if "?" in return_url else "?"
    qs = f"google={google}"
    if service:
        qs += f"&service={service}"
    return f"{return_url}{sep}{qs}"


def _parse_state(state: str) -> tuple[str, str, str, str] | None:
    parts = state.split("|", 3)
    if len(parts) != 4:
        return None
    org_id, api_base, return_url, service_name = parts
    if not org_id or not api_base or not return_url or service_name not in VALID_SERVICES:
        return None
    return org_id, api_base, return_url, service_name


@router.get("/orgs/{org_id}/google/oauth-url")
async def get_google_oauth_url(
    org_id: str,
    return_url: str = Query(..., description="Frontend URL to return to after OAuth"),
    service_name: str = Query(..., description="Automation service to connect (GMAIL, GOOGLE_CALENDAR)"),
    ctx: OrgContext = Depends(require_feature("gmail_calendar")),
    _member: OrgContext = Depends(require_roles("OWNER", "TELECALLER")),
) -> dict:
    if service_name not in VALID_SERVICES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown automation service")
    _assert_google_service_allowed(ctx, service_name)
    if not settings.google_client_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google integration not configured")

    api_base = _api_base_url()
    redirect_uri = _redirect_uri(api_base)
    safe_return = _normalize_return_url(return_url)
    url = build_oauth_url(
        redirect_uri=redirect_uri,
        state=f"{org_id}|{api_base}|{safe_return}|{service_name}",
        service_name=service_name,
    )
    return {"url": url, "redirect_uri": redirect_uri, "scopes": SERVICE_SCOPES.get(service_name, [])}


@router.get("/google/oauth/callback")
async def google_oauth_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
) -> RedirectResponse:
    fallback = _return_with_status(
        f"{settings.cors_origin_list[0] if settings.cors_origin_list else 'http://localhost:5173'}{DEFAULT_RETURN_PATH}",
        "error",
    )

    if error or not code or not state:
        logger.warning("Google OAuth error: %s", error)
        parsed = _parse_state(state) if state else None
        if parsed:
            _, _, return_url, service_name = parsed
            return RedirectResponse(url=_return_with_status(return_url, "error", service_name))
        return RedirectResponse(url=fallback)

    parsed = _parse_state(state)
    if not parsed:
        return RedirectResponse(url=fallback)

    org_id, base_url, return_url, service_name = parsed

    org = await prisma.organization.find_unique(where={"id": org_id})
    if not org:
        return RedirectResponse(url=_return_with_status(return_url, "error", service_name))

    try:
        redirect_uri = _redirect_uri(base_url)
        token_data = await exchange_code_for_tokens(code, redirect_uri)
        access_token = token_data["access_token"]
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

        connected_email = await get_user_email(access_token)

        credentials = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "scopes": SERVICE_SCOPES.get(service_name, []),
        }

        existing = await prisma.automationconnection.find_first(
            where={"organizationId": org_id, "serviceName": service_name}
        )
        creds_json = json_meta(credentials)
        if existing:
            await prisma.automationconnection.update(
                where={"id": existing.id},
                data={
                    "status": "connected",
                    "credentials": creds_json,
                    "connectedEmail": connected_email,
                },
            )
        else:
            await prisma.automationconnection.create(
                data={
                    "organizationId": org_id,
                    "serviceName": service_name,
                    "status": "connected",
                    "credentials": creds_json,
                    "connectedEmail": connected_email,
                }
            )

        return RedirectResponse(url=_return_with_status(return_url, "success", service_name))

    except Exception as exc:
        logger.exception("Google OAuth callback failed: %s", exc)
        return RedirectResponse(url=_return_with_status(return_url, "error", service_name))


# ── List connections ───────────────────────────────────────────────────────────

_GOOGLE_SERVICE_META = {
    "GMAIL": {"label": "Gmail", "description": "Send and read emails via the org's Gmail account"},
    "GOOGLE_CALENDAR": {"label": "Google Calendar", "description": "Create and list calendar events"},
}


@router.get("/orgs/{org_id}/google/connections")
async def list_google_connections(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER", "TELECALLER")),
) -> dict:
    rows = await prisma.automationconnection.find_many(
        where={"organizationId": ctx.organization_id, "serviceName": {"in": list(VALID_SERVICES)}}
    )
    connected = {r.serviceName: r for r in rows}
    items = []
    for svc in ("GMAIL", "GOOGLE_CALENDAR"):
        meta = _GOOGLE_SERVICE_META[svc]
        row = connected.get(svc)
        items.append({
            "service_name": svc,
            "label": meta["label"],
            "description": meta["description"],
            "status": row.status if row else "disconnected",
            "connected_email": row.connectedEmail if row else None,
        })
    return {"items": items, "google_configured": bool(settings.google_client_id)}


# ── Disconnect ─────────────────────────────────────────────────────────────────

class DisconnectGooglePayload(BaseModel):
    service_name: str


@router.post("/orgs/{org_id}/gmail/sync")
async def manual_gmail_sync(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Manually trigger a Gmail inbox sync for this org."""
    from loomrun_api.gmail_sync import sync_org_gmail
    count = await sync_org_gmail(ctx.organization_id)
    return {"activities_created": count}


# ── Gmail send / read ──────────────────────────────────────────────────────────

def _serialize_email(email) -> dict:
    return {
        "message_id": email.message_id,
        "thread_id": email.thread_id,
        "from": email.from_address,
        "to": email.to_address,
        "subject": email.subject,
        "snippet": email.snippet,
        "body": email.body,
        "date": email.date,
        "label_ids": email.label_ids,
    }


def _gmail_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if isinstance(exc, httpx.HTTPStatusError):
        detail = exc.response.text[:500] if exc.response is not None else str(exc)
        return HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"Gmail API error: {detail}")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc))


class GmailSendPayload(BaseModel):
    to: str = Field(min_length=3, max_length=320)
    subject: str = Field(min_length=1, max_length=998)
    body: str = Field(min_length=1, max_length=500_000)
    cc: str | None = Field(default=None, max_length=320)
    bcc: str | None = Field(default=None, max_length=320)
    html: bool = False
    reply_to_message_id: str | None = None
    thread_id: str | None = None


@router.post("/orgs/{org_id}/gmail/send", status_code=status.HTTP_201_CREATED)
async def gmail_send(
    org_id: str,
    body: GmailSendPayload,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Send an email from the org's connected Gmail account."""
    from loomrun_api.gmail_automation import send_email

    try:
        sent = await send_email(
            ctx.organization_id,
            to=body.to,
            subject=body.subject,
            body=body.body,
            cc=body.cc,
            bcc=body.bcc,
            html=body.html,
            reply_to_message_id=body.reply_to_message_id,
            thread_id=body.thread_id,
        )
    except Exception as exc:
        raise _gmail_http_error(exc) from exc

    return {
        "message_id": sent.message_id,
        "thread_id": sent.thread_id,
    }


@router.get("/orgs/{org_id}/gmail/messages")
async def gmail_list_messages(
    org_id: str,
    q: str | None = Query(None, description="Gmail search query (e.g. is:unread from:foo@bar.com)"),
    label_ids: str | None = Query(None, description="Comma-separated label IDs (default: INBOX)"),
    max_results: int = Query(20, ge=1, le=100),
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """List emails from the org's connected Gmail account."""
    from loomrun_api.gmail_automation import read_emails

    labels = [s.strip() for s in label_ids.split(",") if s.strip()] if label_ids else None
    try:
        emails = await read_emails(
            ctx.organization_id,
            query=q,
            label_ids=labels,
            max_results=max_results,
        )
    except Exception as exc:
        raise _gmail_http_error(exc) from exc

    return {"items": [_serialize_email(email) for email in emails]}


@router.get("/orgs/{org_id}/gmail/messages/{message_id}")
async def gmail_get_message(
    org_id: str,
    message_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Fetch a single Gmail message by id."""
    from loomrun_api.gmail_automation import get_email

    try:
        email = await get_email(ctx.organization_id, message_id)
    except Exception as exc:
        raise _gmail_http_error(exc) from exc

    if not email:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found")
    return _serialize_email(email)


@router.post("/orgs/{org_id}/google/connections/disconnect")
async def disconnect_google_service(
    org_id: str,
    body: DisconnectGooglePayload,
    ctx: OrgContext = Depends(require_roles("OWNER", "TELECALLER")),
) -> dict:
    if body.service_name not in VALID_SERVICES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown service")
    _assert_google_service_allowed(ctx, body.service_name)
    existing = await prisma.automationconnection.find_first(
        where={"organizationId": ctx.organization_id, "serviceName": body.service_name}
    )
    if not existing:
        return {"status": "disconnected", "service_name": body.service_name}
    await prisma.automationconnection.update(
        where={"id": existing.id},
        data={"status": "disconnected", "credentials": None, "connectedEmail": None},
    )
    return {"status": "disconnected", "service_name": body.service_name}
