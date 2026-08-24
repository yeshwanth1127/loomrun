"""HTTP client for the self-hosted Baileys WhatsApp sidecar.

The sidecar runs as a separate Node process (apps/whatsapp-baileys) on the same
host. Each organization maps to one Baileys session keyed by its org id. All
requests carry the shared ``X-Service-Secret`` header.
"""
from __future__ import annotations

import logging
from typing import NamedTuple

import httpx

from loomrun_api.config import settings

logger = logging.getLogger(__name__)


class SendResult(NamedTuple):
    """Outcome of a Baileys send. Truthy when ``ok`` so existing ``if sent`` checks keep working."""

    ok: bool
    error: str | None = None

    def __bool__(self) -> bool:
        return self.ok


def _headers() -> dict[str, str]:
    return {"X-Service-Secret": settings.baileys_service_secret}


def _base() -> str:
    return settings.baileys_service_url.rstrip("/")


def _error_from_response(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        if isinstance(data, dict) and data.get("error"):
            return str(data["error"])
    except Exception:
        pass
    text = (resp.text or "").strip()
    return text[:300] if text else f"WhatsApp sidecar returned HTTP {resp.status_code}"


async def get_status(org_id: str) -> dict:
    """Return the live session status: {connected, qr, phone_number, owner_jid}.

    Returns a disconnected stub if the sidecar is unreachable or unconfigured.
    """
    if not settings.baileys_service_secret:
        return {"connected": False, "qr": None, "phone_number": None, "owner_jid": None, "state": "unconfigured"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{_base()}/sessions/{org_id}/status",
                headers=_headers(),
            )
        if resp.status_code == 200:
            return resp.json()
        logger.warning("Baileys status %s: %s", resp.status_code, resp.text[:300])
    except Exception as exc:
        logger.warning("Baileys status error org=%s: %s", org_id, exc)
    return {"connected": False, "qr": None, "phone_number": None, "owner_jid": None}


async def start_session(org_id: str, force: bool = False) -> bool:
    """Start (or resume) the org's Baileys session so a QR can be generated.

    ``force`` discards any stale session and saved auth first, so an explicit
    "Connect" from the UI always yields a scannable QR.
    """
    if not settings.baileys_service_secret:
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{_base()}/sessions/{org_id}/start",
                json={"force": force},
                headers=_headers(),
            )
        return resp.status_code == 200
    except Exception as exc:
        logger.warning("Baileys start error org=%s: %s", org_id, exc)
        return False


async def disconnect(org_id: str) -> bool:
    """Log out and wipe the org's Baileys auth state."""
    if not settings.baileys_service_secret:
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.delete(
                f"{_base()}/sessions/{org_id}",
                headers=_headers(),
            )
        return resp.status_code == 200
    except Exception as exc:
        logger.warning("Baileys disconnect error org=%s: %s", org_id, exc)
        return False


async def is_connected(org_id: str) -> bool:
    status = await get_status(org_id)
    return bool(status.get("connected"))


async def send_text(org_id: str, phone: str, text: str) -> SendResult:
    """Send a plain-text WhatsApp message to a lead's number."""
    if not settings.baileys_service_secret:
        return SendResult(False, "WhatsApp sidecar is not configured")
    if not phone or not text:
        return SendResult(False, "Phone and message are required")
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(
                f"{_base()}/send",
                json={"org_id": org_id, "to_phone": phone, "message": text},
                headers=_headers(),
            )
        if resp.status_code == 200:
            logger.info("Baileys text sent org=%s to=%s", org_id, phone)
            return SendResult(True)
        error = _error_from_response(resp)
        logger.warning("Baileys send %s: %s", resp.status_code, error)
        return SendResult(False, error)
    except Exception as exc:
        logger.error("Baileys send error org=%s: %s", org_id, exc)
        return SendResult(False, f"WhatsApp sidecar unreachable: {exc}")


async def send_document(
    org_id: str,
    phone: str,
    file_path: str,
    file_name: str,
    mimetype: str = "application/pdf",
) -> SendResult:
    """Send a document (e.g. quotation/invoice PDF) to a lead's number.

    ``file_path`` is an absolute path the sidecar reads directly off the shared
    filesystem.
    """
    if not settings.baileys_service_secret:
        return SendResult(False, "WhatsApp sidecar is not configured")
    if not phone or not file_path:
        return SendResult(False, "Phone and file path are required")
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(
                f"{_base()}/send-document",
                json={
                    "org_id": org_id,
                    "to_phone": phone,
                    "file_path": file_path,
                    "file_name": file_name,
                    "mimetype": mimetype,
                },
                headers=_headers(),
            )
        if resp.status_code == 200:
            logger.info("Baileys document sent org=%s to=%s file=%s", org_id, phone, file_name)
            return SendResult(True)
        error = _error_from_response(resp)
        logger.warning("Baileys send-document %s: %s", resp.status_code, error)
        return SendResult(False, error)
    except Exception as exc:
        logger.error("Baileys send-document error org=%s: %s", org_id, exc)
        return SendResult(False, f"WhatsApp sidecar unreachable: {exc}")
