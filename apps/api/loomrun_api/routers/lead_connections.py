import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.prisma_client import prisma

router = APIRouter()

ALL_SOURCES = [
    {"source_name": "META_ADS",   "label": "Meta Ads (FB/IG)",       "method": "oauth"},
    {"source_name": "GOOGLE_ADS", "label": "Google Ads",              "method": "oauth"},
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
async def list_connections(org_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    from loomrun_api.entitlements import get_org_entitlements

    existing = await prisma.leadconnection.find_many(
        where={"organizationId": ctx.organization_id}
    )
    org = ctx.organization or await prisma.organization.find_unique(where={"id": ctx.organization_id})
    ents = get_org_entitlements(org) if org else None
    by_source = {c.sourceName: c for c in existing}

    api_base = settings.public_api_url.rstrip("/")
    items = []
    for meta in ALL_SOURCES:
        sn = meta["source_name"]
        conn = by_source.get(sn)
        if sn == "META_ADS":
            webhook_url = f"{api_base}/v1/hooks/meta"
        elif meta["method"] in ("webhook", "api_key"):
            webhook_url = f"{api_base}/v1/hooks/leads/{org_id}/{sn.lower()}"
        else:
            webhook_url = None
        locked = False
        required_plan = None
        if sn == "GOOGLE_ADS":
            locked = not bool(ents and ents.google_ads)
            required_plan = "scale"
        elif sn == "META_ADS":
            locked = not bool(ents and ents.meta_lead_ads)
            required_plan = "growth"
        item = {
            **meta,
            "status": conn.status if conn else "disconnected",
            "leads_count": conn.leadsCount if conn else 0,
            "last_sync": conn.lastSync.isoformat() if conn and conn.lastSync else None,
            "webhook_url": webhook_url,
            "connection_id": conn.id if conn else None,
            "plan_locked": locked,
            "required_plan": required_plan,
        }
        if sn == "META_ADS" and conn and isinstance(conn.credentials, dict):
            stats = conn.credentials.get("sync_stats")
            if isinstance(stats, dict):
                item["meta_available"] = stats.get("meta_available")
                item["sync_note"] = stats.get("retention_note")
        items.append(item)
    return {"items": items}


@router.post("/orgs/{org_id}/lead-connections/connect", status_code=status.HTTP_200_OK)
async def connect_source(org_id: str, body: ConnectPayload, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    from loomrun_api.entitlements import FEATURE_UPGRADE_HINTS, get_org_entitlements

    valid_sources = {s["source_name"] for s in ALL_SOURCES}
    if body.source_name not in valid_sources:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown source")

    org = ctx.organization or await prisma.organization.find_unique(where={"id": ctx.organization_id})
    if org:
        ents = get_org_entitlements(org)
        if body.source_name == "GOOGLE_ADS" and not ents.google_ads:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail=f"FEATURE_LOCKED: {FEATURE_UPGRADE_HINTS['google_ads']}",
            )
        if body.source_name == "META_ADS" and not ents.meta_lead_ads:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail=f"FEATURE_LOCKED: {FEATURE_UPGRADE_HINTS['meta_lead_ads']}",
            )

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
        update_data = {
            "status": "connected",
            "webhookSecret": existing.webhookSecret or webhook_secret,
        }
        if creds is not None:
            update_data["credentials"] = creds
        updated = await prisma.leadconnection.update(
            where={"id": existing.id},
            data=update_data,
        )
        return _serialize_connection(updated)

    create_data = {
        "organizationId": ctx.organization_id,
        "sourceName": body.source_name,
        "status": "connected",
        "webhookSecret": webhook_secret,
        "leadsCount": 0,
    }
    if creds is not None:
        create_data["credentials"] = creds
    created = await prisma.leadconnection.create(data=create_data)
    return _serialize_connection(created)


@router.post("/orgs/{org_id}/lead-connections/disconnect", status_code=status.HTTP_200_OK)
async def disconnect_source(org_id: str, body: DisconnectPayload, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
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
