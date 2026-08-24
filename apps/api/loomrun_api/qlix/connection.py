"""Per-org Qlix connection record and its encrypted API key.

Credentials are stored Fernet-encrypted using the same helper the telephony
integration uses, so there is no second key-management story: the key is
derived from ``settings.secret_key``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from prisma import fields

from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.telephony.crypto import decrypt_credentials, encrypt_credentials

logger = logging.getLogger(__name__)

STATUS_DISCONNECTED = "disconnected"
STATUS_PROVISIONING = "provisioning"
STATUS_CONNECTED = "connected"
STATUS_ERROR = "error"

# What the org's key must be able to do, for reference when diagnosing an
# `insufficient_scope` error. Qlix decides the scopes at Activate — we do not
# request them — so this is documentation, not configuration.
EXPECTED_KEY_SCOPES = (
    "agents:read/write (create the agent), runs:write (chat and streaming), "
    "brain:read/write (knowledge), mcp:read/write (tool binding), "
    "jit:decide (approve writes), usage:read and audit:read (status panels)"
)


async def get_connection(organization_id: str):
    return await prisma.qlixconnection.find_unique(
        where={"organizationId": organization_id}
    )


async def ensure_row(organization_id: str):
    row = await get_connection(organization_id)
    if row:
        return row
    return await prisma.qlixconnection.create(
        data={"organizationId": organization_id, "status": STATUS_DISCONNECTED}
    )


def read_api_key(row) -> str:
    """Decrypt the org's qlix_live_* key. Empty string when there isn't one."""
    if not row or not row.credentials:
        return ""
    creds = row.credentials
    if not isinstance(creds, dict):
        return ""
    blob = creds.get("enc")
    if not blob:
        return ""
    try:
        return str(decrypt_credentials(str(blob)).get("api_key") or "")
    except Exception:
        # A key we cannot decrypt is a key we cannot use — surface it as
        # "not connected" so the org is prompted to reconnect rather than
        # every call failing with an opaque crypto error.
        logger.exception(
            "Could not decrypt Qlix credentials for org %s", row.organizationId
        )
        return ""


def write_api_key(api_key: str) -> dict[str, Any]:
    return json_meta({"enc": encrypt_credentials({"api_key": api_key})})


async def require_api_key(organization_id: str) -> tuple[Any, str]:
    """Return (connection, api_key) or raise if the org is not usable yet."""
    row = await get_connection(organization_id)
    api_key = read_api_key(row)
    if not row or row.status != STATUS_CONNECTED or not api_key:
        raise NotConnectedError(organization_id)
    return row, api_key


class NotConnectedError(Exception):
    """The org has not activated its Qlix agent (or the key is unusable)."""

    def __init__(self, organization_id: str) -> None:
        super().__init__(f"Organization {organization_id} is not connected to Qlix")
        self.organization_id = organization_id


_JSON_FIELDS = frozenset({"credentials", "backfillState"})


def _json_field(value: Any) -> Any:
    """prisma-client-py only accepts ``fields.Json`` for Json columns.

    A plain dict is sent as a nested input object and the engine rejects it
    with ``backfillState should be Json | NullableJsonNullValueInput``.
    """
    if value is None or isinstance(value, fields.Json):
        return value
    if isinstance(value, dict):
        return json_meta(value)
    return value


async def update_connection(organization_id: str, **patch: Any):
    data = {
        key: _json_field(value) if key in _JSON_FIELDS else value
        for key, value in patch.items()
    }
    return await prisma.qlixconnection.update(
        where={"organizationId": organization_id}, data=data
    )


async def mark_error(organization_id: str, message: str) -> None:
    try:
        await prisma.qlixconnection.update(
            where={"organizationId": organization_id},
            data={"status": STATUS_ERROR, "lastError": message[:2000]},
        )
    except Exception:
        logger.exception("Could not record Qlix error for org %s", organization_id)


async def mark_synced(organization_id: str) -> None:
    await prisma.qlixconnection.update(
        where={"organizationId": organization_id},
        data={"lastSyncedAt": datetime.now(timezone.utc)},
    )


def public_state(row) -> dict[str, Any]:
    """Connection state safe to hand to the frontend — never the key itself."""
    if not row:
        return {"connected": False, "status": STATUS_DISCONNECTED}
    return {
        "connected": row.status == STATUS_CONNECTED,
        "status": row.status,
        "agent_id": row.agentId,
        "collection_id": row.collectionId,
        "backfill_done": row.backfillDoneAt is not None,
        "backfill": row.backfillState if isinstance(row.backfillState, dict) else None,
        "last_synced_at": row.lastSyncedAt.isoformat() if row.lastSyncedAt else None,
        "last_error": row.lastError,
    }
