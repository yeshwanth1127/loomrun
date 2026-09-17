import logging

from fastapi import APIRouter, Depends

from loomrun_api import baileys_client
from loomrun_api.deps import OrgContext, get_org_context, require_roles
from loomrun_api.member_connections import (
    get_member_whatsapp,
    get_org_whatsapp,
    upsert_whatsapp_status,
    whatsapp_session_id,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_ME_ROLES = require_roles("OWNER", "SALES", "TELECALLER")


async def _status_payload(*, org_id: str, membership_id: str | None) -> dict:
    session_id = whatsapp_session_id(org_id=org_id, membership_id=membership_id)
    live = await baileys_client.get_status(session_id)
    connected = bool(live.get("connected"))
    phone = live.get("phone_number")

    if connected:
        await upsert_whatsapp_status(
            org_id=org_id,
            membership_id=membership_id,
            status="connected",
            phone_number=phone,
        )

    record = (
        await get_member_whatsapp(membership_id)
        if membership_id
        else await get_org_whatsapp(org_id)
    )
    live_state = live.get("state")
    if connected:
        status = "connected"
    elif live_state in ("awaiting_scan", "connecting"):
        status = "connecting"
    else:
        status = record.status if record else "disconnected"
    return {
        "connected": connected,
        "qr": live.get("qr"),
        "phone_number": phone or (record.phoneNumber if record else None),
        "status": status,
        "error": live.get("error"),
        "scope": "membership" if membership_id else "organization",
        "membership_id": membership_id,
        "last_connected_at": record.lastConnectedAt.isoformat()
        if record and record.lastConnectedAt
        else None,
    }


@router.get("/orgs/{org_id}/connectors/whatsapp")
async def whatsapp_status(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Live WhatsApp connector status for the org (CEO shared session)."""
    return await _status_payload(org_id=ctx.organization_id, membership_id=None)


@router.post("/orgs/{org_id}/connectors/whatsapp/connect")
async def whatsapp_connect(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Start the org's Baileys session so a QR code can be scanned."""
    sid = whatsapp_session_id(org_id=ctx.organization_id, membership_id=None)
    started = await baileys_client.start_session(sid, force=True)
    await upsert_whatsapp_status(
        org_id=ctx.organization_id,
        membership_id=None,
        status="connecting" if started else "disconnected",
    )
    return {"ok": started, "status": "connecting" if started else "disconnected", "scope": "organization"}


@router.post("/orgs/{org_id}/connectors/whatsapp/disconnect")
async def whatsapp_disconnect(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Log out and wipe the org's WhatsApp session (does not touch personal)."""
    sid = whatsapp_session_id(org_id=ctx.organization_id, membership_id=None)
    await baileys_client.disconnect(sid)
    await upsert_whatsapp_status(
        org_id=ctx.organization_id,
        membership_id=None,
        status="disconnected",
        phone_number=None,
    )
    return {"ok": True, "status": "disconnected", "scope": "organization"}


@router.get("/orgs/{org_id}/me/connectors/whatsapp")
async def my_whatsapp_status(
    org_id: str,
    ctx: OrgContext = Depends(_ME_ROLES),
) -> dict:
    """Personal WhatsApp connector for the current membership."""
    return await _status_payload(
        org_id=ctx.organization_id,
        membership_id=ctx.membership.id,
    )


@router.post("/orgs/{org_id}/me/connectors/whatsapp/connect")
async def my_whatsapp_connect(
    org_id: str,
    ctx: OrgContext = Depends(_ME_ROLES),
) -> dict:
    mid = ctx.membership.id
    sid = whatsapp_session_id(org_id=ctx.organization_id, membership_id=mid)
    started = await baileys_client.start_session(sid, force=True)
    await upsert_whatsapp_status(
        org_id=ctx.organization_id,
        membership_id=mid,
        status="connecting" if started else "disconnected",
    )
    return {
        "ok": started,
        "status": "connecting" if started else "disconnected",
        "scope": "membership",
        "membership_id": mid,
    }


@router.post("/orgs/{org_id}/me/connectors/whatsapp/disconnect")
async def my_whatsapp_disconnect(
    org_id: str,
    ctx: OrgContext = Depends(_ME_ROLES),
) -> dict:
    mid = ctx.membership.id
    sid = whatsapp_session_id(org_id=ctx.organization_id, membership_id=mid)
    await baileys_client.disconnect(sid)
    await upsert_whatsapp_status(
        org_id=ctx.organization_id,
        membership_id=mid,
        status="disconnected",
        phone_number=None,
    )
    return {"ok": True, "status": "disconnected", "scope": "membership", "membership_id": mid}
