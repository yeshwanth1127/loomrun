import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.n8n_client import N8nApiError
from loomrun_api.n8n_events import N8N_SERVICE
from loomrun_api.n8n_provisioner import provision_org_workflows, teardown_org_workflows
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta

router = APIRouter()

N8N_CAPABILITIES = [
    {"service_name": "GMAIL", "label": "Gmail", "description": "Send, read, and reply to emails"},
    {"service_name": "GOOGLE_CALENDAR", "label": "Google Calendar", "description": "Create and manage calendar events"},
]

# All Google OAuth-backed automation services (used by google_oauth router for validation)
ALL_AUTOMATIONS = N8N_CAPABILITIES

LOOMRUN_EVENTS = [
    "lead.created",
    "lead.stage_changed",
    "quotation.sent",
    "production.stage_changed",
]


class ProvisionAutomationPayload(BaseModel):
    sender_email: str

    @field_validator("sender_email")
    @classmethod
    def validate_sender_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or "." not in email.split("@")[-1]:
            raise ValueError("Enter the Gmail address this org sends from")
        return email


class DisconnectAutomationPayload(BaseModel):
    service_name: str = N8N_SERVICE


def _connection_item(org, connection) -> dict:
    creds = connection.credentials if connection and isinstance(connection.credentials, dict) else {}
    workflows = creds.get("workflows") if isinstance(creds.get("workflows"), list) else []
    provisioned = bool(workflows)
    return {
        "service_name": N8N_SERVICE,
        "label": "Automations (n8n)",
        "method": "provisioned" if provisioned else "webhook",
        "provider": "n8n",
        "description": "Loomrun clones four n8n workflows per org. Connect Gmail on each clone using your org inbox.",
        "capabilities": [c["label"] for c in N8N_CAPABILITIES],
        "capability_details": N8N_CAPABILITIES,
        "loomrun_events": LOOMRUN_EVENTS,
        "status": connection.status if connection else "disconnected",
        "connected_email": connection.connectedEmail if connection else None,
        "last_used": connection.lastUsed.isoformat() if connection and connection.lastUsed else None,
        "connection_id": connection.id if connection else None,
        "organization_slug": org.slug if org else None,
        "organization_name": org.name if org else None,
        "suggested_sender_email": org.brandEmail if org and org.brandEmail else None,
        "workflows": workflows,
        "needs_gmail_setup": provisioned and connection and connection.status == "connected",
        "automation_ready": settings.n8n_automation_ready,
    }


@router.get("/orgs/{org_id}/automation-connections")
async def list_automation_connections(org_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    connection = await prisma.automationconnection.find_first(
        where={"organizationId": ctx.organization_id, "serviceName": N8N_SERVICE}
    )
    return {
        "items": [_connection_item(org, connection)],
        "n8n_url": settings.n8n_public_url.rstrip("/") if settings.n8n_public_url else None,
    }


@router.post("/orgs/{org_id}/automation-connections/provision", status_code=status.HTTP_200_OK)
async def provision_automation(
    org_id: str,
    body: ProvisionAutomationPayload,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    """Clone all Loomrun workflow templates in n8n for this organization."""
    from loomrun_api.entitlements import FEATURE_UPGRADE_HINTS, get_org_entitlements

    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    if not get_org_entitlements(org).event_automations:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"FEATURE_LOCKED: {FEATURE_UPGRADE_HINTS['event_automations']}",
        )

    existing = await prisma.automationconnection.find_first(
        where={"organizationId": ctx.organization_id, "serviceName": N8N_SERVICE}
    )
    if existing and existing.status == "connected":
        old_creds = existing.credentials if isinstance(existing.credentials, dict) else {}
        old_workflows = old_creds.get("workflows") if isinstance(old_creds.get("workflows"), list) else []
        if old_workflows:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="Workflows already provisioned for this org. Disconnect first to re-provision.",
            )

    try:
        provisioned = await provision_org_workflows(
            organization_id=ctx.organization_id,
            organization_slug=org.slug,
            organization_name=org.name,
            sender_email=body.sender_email,
        )
    except N8nApiError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE if exc.status_code is None else status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    webhook_secret = secrets.token_urlsafe(24)
    credentials = json_meta({
        "webhook_secret": webhook_secret,
        "webhook_path": provisioned["webhook_path"],
        "workflows": provisioned["workflows"],
        "organization_slug": provisioned["organization_slug"],
    })

    if existing:
        updated = await prisma.automationconnection.update(
            where={"id": existing.id},
            data={
                "status": "connected",
                "credentials": credentials,
                "connectedEmail": body.sender_email,
            },
        )
    else:
        updated = await prisma.automationconnection.create(
            data={
                "organizationId": ctx.organization_id,
                "serviceName": N8N_SERVICE,
                "status": "connected",
                "credentials": credentials,
                "connectedEmail": body.sender_email,
            }
        )

    item = _connection_item(org, updated)
    return {
        "service_name": updated.serviceName,
        "status": updated.status,
        "connected_email": updated.connectedEmail,
        "workflows": provisioned["workflows"],
        "needs_gmail_setup": True,
        "item": item,
    }


@router.post("/orgs/{org_id}/automation-connections/disconnect", status_code=status.HTTP_200_OK)
async def disconnect_automation(
    org_id: str,
    body: DisconnectAutomationPayload,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    if body.service_name != N8N_SERVICE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown automation service")

    existing = await prisma.automationconnection.find_first(
        where={"organizationId": ctx.organization_id, "serviceName": N8N_SERVICE}
    )
    if not existing:
        return {"status": "disconnected", "service_name": N8N_SERVICE}

    creds = existing.credentials if isinstance(existing.credentials, dict) else {}
    workflows = creds.get("workflows") if isinstance(creds.get("workflows"), list) else []
    await teardown_org_workflows(workflows)

    updated = await prisma.automationconnection.update(
        where={"id": existing.id},
        data={"status": "disconnected", "credentials": None, "connectedEmail": None},
    )
    return {"service_name": updated.serviceName, "status": updated.status}
