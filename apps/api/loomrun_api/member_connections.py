"""Org vs membership-scoped WhatsApp / Google connection helpers.

Org-level rows have ``membershipId IS NULL`` (CEO Settings connectors).
Personal rows are keyed by membership and use Baileys session id ``m_{membershipId}``.
"""

from __future__ import annotations

from datetime import datetime, timezone

from loomrun_api.prisma_client import prisma


def whatsapp_session_id(*, org_id: str, membership_id: str | None = None) -> str:
    """Baileys sidecar session key — org id for shared, ``m_*`` for personal."""
    if membership_id:
        return f"m_{membership_id}"
    return org_id


async def get_org_whatsapp(org_id: str):
    return await prisma.whatsappconnection.find_first(
        where={"organizationId": org_id, "membershipId": None},
    )


async def get_member_whatsapp(membership_id: str):
    return await prisma.whatsappconnection.find_first(
        where={"membershipId": membership_id},
    )


async def upsert_whatsapp_status(
    *,
    org_id: str,
    membership_id: str | None,
    status: str,
    phone_number: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    existing = (
        await get_member_whatsapp(membership_id)
        if membership_id
        else await get_org_whatsapp(org_id)
    )
    data: dict = {"status": status}
    if phone_number is not None:
        data["phoneNumber"] = phone_number
    if status == "connected":
        data["lastConnectedAt"] = now
    if existing:
        await prisma.whatsappconnection.update(where={"id": existing.id}, data=data)
        return
    create: dict = {
        "organizationId": org_id,
        "status": status,
        **({"membershipId": membership_id} if membership_id else {}),
    }
    if phone_number is not None:
        create["phoneNumber"] = phone_number
    if status == "connected":
        create["lastConnectedAt"] = now
    await prisma.whatsappconnection.create(data=create)


async def get_org_automation(org_id: str, service_name: str):
    return await prisma.automationconnection.find_first(
        where={
            "organizationId": org_id,
            "serviceName": service_name,
            "membershipId": None,
        },
    )


async def get_member_automation(membership_id: str, service_name: str):
    return await prisma.automationconnection.find_first(
        where={"membershipId": membership_id, "serviceName": service_name},
    )


async def membership_id_for_user(org_id: str, user_id: str | None) -> str | None:
    if not user_id:
        return None
    m = await prisma.membership.find_first(
        where={"organizationId": org_id, "userId": user_id},
    )
    return m.id if m else None


async def resolve_whatsapp_session_for_actor(
    *,
    organization_id: str,
    user_id: str | None,
) -> str:
    """Prefer the actor's personal connected WhatsApp; else org shared session."""
    from loomrun_api import baileys_client

    mid = await membership_id_for_user(organization_id, user_id)
    if mid:
        personal = await get_member_whatsapp(mid)
        if personal and personal.status == "connected":
            sid = whatsapp_session_id(org_id=organization_id, membership_id=mid)
            live = await baileys_client.get_status(sid)
            if live.get("connected"):
                return sid
            # DB says connected but sidecar is not — still try personal session id
            # so connect UX and send stay consistent for this member.
            if personal.status == "connected":
                return sid
    return whatsapp_session_id(org_id=organization_id, membership_id=None)
