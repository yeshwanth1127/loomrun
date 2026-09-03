import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from loomrun_api import baileys_client
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)
router = APIRouter()


async def _record(org_id: str):
    return await prisma.whatsappconnection.find_unique(where={"organizationId": org_id})


async def _upsert_status(org_id: str, status: str, phone_number: str | None = None) -> None:
    now = datetime.now(timezone.utc)
    update: dict = {"status": status}
    create: dict = {"organizationId": org_id, "status": status}
    if phone_number is not None:
        update["phoneNumber"] = phone_number
        create["phoneNumber"] = phone_number
    if status == "connected":
        update["lastConnectedAt"] = now
        create["lastConnectedAt"] = now
    await prisma.whatsappconnection.upsert(
        where={"organizationId": org_id},
        data={"create": create, "update": update},
    )


@router.get("/orgs/{org_id}/connectors/whatsapp")
async def whatsapp_status(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Live WhatsApp connector status for the org (merges sidecar + stored record)."""
    live = await baileys_client.get_status(org_id)
    connected = bool(live.get("connected"))
    phone = live.get("phone_number")

    # Keep the stored record in step with the live session.
    if connected:
        await _upsert_status(org_id, "connected", phone)

    record = await _record(org_id)
    # Prefer the sidecar's live session state over the stored one — the record only
    # says what was last written, not whether the session is dialling right now.
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
        "last_connected_at": record.lastConnectedAt.isoformat() if record and record.lastConnectedAt else None,
    }


@router.post("/orgs/{org_id}/connectors/whatsapp/connect")
async def whatsapp_connect(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Start the org's Baileys session so a QR code can be scanned."""
    # Force a clean session: the button only shows when the org is unlinked, so a
    # leftover half-linked session must not suppress the QR.
    started = await baileys_client.start_session(org_id, force=True)
    await _upsert_status(org_id, "connecting" if started else "disconnected")
    return {"ok": started, "status": "connecting" if started else "disconnected"}


@router.post("/orgs/{org_id}/connectors/whatsapp/disconnect")
async def whatsapp_disconnect(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Log out and wipe the org's WhatsApp session."""
    await baileys_client.disconnect(org_id)
    await _upsert_status(org_id, "disconnected", phone_number=None)
    await prisma.whatsappconnection.update_many(
        where={"organizationId": org_id},
        data={"phoneNumber": None},
    )
    return {"ok": True, "status": "disconnected"}
