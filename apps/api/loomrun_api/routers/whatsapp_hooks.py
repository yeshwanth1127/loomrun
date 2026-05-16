import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from loomrun_api.config import settings
from loomrun_api.prisma_client import prisma
from prisma.enums import LeadSource

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/hooks/whatsapp/{org_id}")
async def whatsapp_verify_public(
    org_id: str,
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
):
    org = await prisma.organization.find_unique(where={"id": org_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Unknown organization")
    if hub_mode == "subscribe" and hub_verify_token and settings.whatsapp_verify_token:
        if hub_verify_token == settings.whatsapp_verify_token:
            return int(hub_challenge) if hub_challenge and hub_challenge.isdigit() else hub_challenge
    raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Verification failed")


@router.post("/hooks/whatsapp/{org_id}")
async def whatsapp_inbound_public(org_id: str, request: Request) -> dict[str, str]:
    org = await prisma.organization.find_unique(where={"id": org_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Unknown organization")
    payload: dict[str, Any] = await request.json()
    logger.info("whatsapp inbound org=%s keys=%s", org_id, list(payload.keys()) if isinstance(payload, dict) else None)
    entries = payload.get("entry") or []
    for entry in entries:
        changes = entry.get("changes") or []
        for change in changes:
            value = change.get("value") or {}
            messages = value.get("messages") or []
            for msg in messages:
                from_wa = msg.get("from")
                text_body = (msg.get("text") or {}).get("body") or ""
                if not from_wa:
                    continue
                lead = await prisma.lead.find_first(
                    where={"organizationId": org_id, "phone": {"contains": from_wa[-10:]}},
                )
                if not lead:
                    lead = await prisma.lead.create(
                        data={
                            "organizationId": org_id,
                            "title": f"WhatsApp {from_wa}",
                            "phone": from_wa,
                            "source": LeadSource.WHATSAPP,
                        }
                    )
                thread = await prisma.whatsappthread.find_first(
                    where={"organizationId": org_id, "externalWaId": from_wa},
                )
                if not thread:
                    thread = await prisma.whatsappthread.create(
                        data={
                            "organizationId": org_id,
                            "leadId": lead.id,
                            "externalWaId": from_wa,
                        }
                    )
                await prisma.whatsappmessage.create(
                    data={
                        "threadId": thread.id,
                        "direction": "inbound",
                        "body": text_body or "(no text)",
                        "raw": msg,
                    }
                )
    return {"status": "ok"}
