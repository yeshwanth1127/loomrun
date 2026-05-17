import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma

router = APIRouter()

ALL_SOURCES = [
    {"source_name": "META_ADS",   "label": "Meta Ads (FB/IG)",       "method": "oauth"},
    {"source_name": "GOOGLE_ADS", "label": "Google Ads",              "method": "oauth"},
    {"source_name": "INDIAMART",  "label": "IndiaMART",               "method": "api_key"},
    {"source_name": "WHATSAPP",   "label": "WhatsApp Business",       "method": "api_key"},
    {"source_name": "WEBSITE",    "label": "Website / Landing Page",  "method": "webhook"},
    {"source_name": "MANUAL",     "label": "Manual / Referral",       "method": "built_in"},
]


def _serialize_connection(conn) -> dict:
    return {
        "id": conn.id,
        "organization_id": conn.organizationId,
        "source_name": conn.sourceName,
        "status": conn.status,
        "webhook_secret": conn.webhookSecret,
        "last_sync": conn.lastSync.isoformat() if conn.lastSync else None,
        "leads_count": conn.leadsCount,
        "created_at": conn.createdAt.isoformat(),
        "updated_at": conn.updatedAt.isoformat(),
    }


class ConnectPayload(BaseModel):
    source_name: str
    api_key: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None


class DisconnectPayload(BaseModel):
    source_name: str


@router.get("/orgs/{org_id}/lead-connections")
async def list_connections(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    existing = await prisma.leadconnection.find_many(
        where={"organizationId": ctx.organization_id}
    )
    by_source = {c.sourceName: c for c in existing}

    apiBase = "http://localhost:8000"
    items = []
    for meta in ALL_SOURCES:
        sn = meta["source_name"]
        conn = by_source.get(sn)
        item = {
            **meta,
            "status": conn.status if conn else "disconnected",
            "leads_count": conn.leadsCount if conn else 0,
            "last_sync": conn.lastSync.isoformat() if conn and conn.lastSync else None,
            "webhook_url": f"{apiBase}/v1/hooks/leads/{org_id}/{sn.lower()}" if meta["method"] in ("webhook", "api_key") else None,
            "connection_id": conn.id if conn else None,
        }
        items.append(item)
    return {"items": items}


@router.post("/orgs/{org_id}/lead-connections/connect", status_code=status.HTTP_200_OK)
async def connect_source(org_id: str, body: ConnectPayload, ctx: OrgContext = Depends(get_org_context)) -> dict:
    valid_sources = {s["source_name"] for s in ALL_SOURCES}
    if body.source_name not in valid_sources:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown source")

    # MANUAL is always connected
    if body.source_name == "MANUAL":
        creds = None
    else:
        creds = {}
        if body.api_key:
            creds["api_key"] = body.api_key
        if body.access_token:
            creds["access_token"] = body.access_token
        if body.refresh_token:
            creds["refresh_token"] = body.refresh_token

    webhook_secret = secrets.token_urlsafe(24)

    existing = await prisma.leadconnection.find_first(
        where={"organizationId": ctx.organization_id, "sourceName": body.source_name}
    )
    if existing:
        updated = await prisma.leadconnection.update(
            where={"id": existing.id},
            data={
                "status": "connected",
                "credentials": creds,
                "webhookSecret": existing.webhookSecret or webhook_secret,
            },
        )
        return _serialize_connection(updated)

    created = await prisma.leadconnection.create(
        data={
            "organizationId": ctx.organization_id,
            "sourceName": body.source_name,
            "status": "connected",
            "credentials": creds,
            "webhookSecret": webhook_secret,
            "leadsCount": 0,
        }
    )
    return _serialize_connection(created)


@router.post("/orgs/{org_id}/lead-connections/disconnect", status_code=status.HTTP_200_OK)
async def disconnect_source(org_id: str, body: DisconnectPayload, ctx: OrgContext = Depends(get_org_context)) -> dict:
    existing = await prisma.leadconnection.find_first(
        where={"organizationId": ctx.organization_id, "sourceName": body.source_name}
    )
    if not existing:
        return {"status": "disconnected"}
    updated = await prisma.leadconnection.update(
        where={"id": existing.id},
        data={"status": "disconnected", "credentials": None},
    )
    return _serialize_connection(updated)
