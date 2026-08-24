"""Dispatch Loomrun events to per-org n8n webhook workflows."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from loomrun_api.n8n_client import N8nApiError, build_webhook_url
from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)

N8N_SERVICE = "N8N"
REQUEST_TIMEOUT = 10.0


def _sign_payload(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _webhook_targets(creds: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    workflows = creds.get("workflows")
    if isinstance(workflows, list):
        for wf in workflows:
            if not isinstance(wf, dict):
                continue
            url: str | None = None
            path = wf.get("webhook_path")
            if path:
                try:
                    url = build_webhook_url(str(path))
                except N8nApiError:
                    logger.warning("Skipping webhook path %s — N8N_WEBHOOK_URL not configured", path)
            elif wf.get("webhook_url"):
                url = str(wf["webhook_url"])
            if url and url not in seen:
                seen.add(url)
                urls.append(url)
    return urls


async def emit_automation_event(
    organization_id: str,
    event: str,
    data: dict[str, Any],
) -> bool:
    """POST an event to all of the org's n8n webhook workflows (each clone filters via IF nodes)."""
    connection = await prisma.automationconnection.find_first(
        where={
            "organizationId": organization_id,
            "serviceName": N8N_SERVICE,
            "status": "connected",
        }
    )
    if not connection or not connection.credentials:
        return False

    creds = connection.credentials if isinstance(connection.credentials, dict) else {}
    targets = _webhook_targets(creds)
    if not targets:
        return False

    org = await prisma.organization.find_unique(where={"id": organization_id})
    sender_email = connection.connectedEmail or (org.brandEmail if org else None)
    payload = {
        "event": event,
        "organization_id": organization_id,
        "organization_slug": org.slug if org else None,
        "organization_name": org.name if org else None,
        "sender_email": sender_email,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    body = json.dumps(payload, default=str).encode()
    headers = {"Content-Type": "application/json"}
    secret = creds.get("webhook_secret")
    if secret:
        headers["X-Loomrun-Signature"] = _sign_payload(secret, body)

    ok = False
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        for url in targets:
            try:
                resp = await client.post(url, content=body, headers=headers)
                resp.raise_for_status()
                ok = True
            except Exception:
                logger.exception("n8n webhook failed for org %s event %s url %s", organization_id, event, url)

    if ok:
        await prisma.automationconnection.update(
            where={"id": connection.id},
            data={"lastUsed": datetime.now(timezone.utc)},
        )
    return ok
