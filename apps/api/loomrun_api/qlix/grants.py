"""Standing approvals: approve a write tool once, then let it run for 24 hours.

Qlix already keeps some write scopes approved for the rest of a conversation
after a single yes. Loomrun extends that deliberately rather than fighting it:
approving ``create_lead`` once means the agent can create leads without asking
again until the grant expires, across conversations, for the whole org.

The trade is explicit. It removes a confirmation click from routine work, and
in exchange a single approval authorises more than one action. Three things
keep that honest:

* grants are per **tool**, not blanket — approving a quotation never authorises
  an invoice;
* every auto-approved action is still surfaced in the chat and counted here, so
  nobody has to guess what the standing approval did;
* any grant can be revoked immediately, and all of them expire on their own.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)

GRANT_TTL_HOURS = 24


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    """Postgres hands back naive datetimes; compare them in UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def find_active(*, organization_id: str, tool: str):
    """Return a live grant for this tool, or None. Expired rows are cleaned up."""
    row = await prisma.qlixtoolgrant.find_unique(
        where={"organizationId_tool": {"organizationId": organization_id, "tool": tool}}
    )
    if not row:
        return None

    expires = _aware(row.expiresAt)
    if expires is None or expires <= _now():
        # Delete rather than leave it lying around: a stale row would otherwise
        # keep showing in the UI as though the permission were still live.
        try:
            await prisma.qlixtoolgrant.delete(where={"id": row.id})
        except Exception:
            logger.debug("Could not remove expired grant %s", row.id)
        return None
    return row


async def grant(*, organization_id: str, tool: str, user_id: str | None):
    """Record (or extend) a standing approval for one tool."""
    expires = _now() + timedelta(hours=GRANT_TTL_HOURS)
    return await prisma.qlixtoolgrant.upsert(
        where={"organizationId_tool": {"organizationId": organization_id, "tool": tool}},
        data={
            "create": {
                "organizationId": organization_id,
                "tool": tool,
                "userId": user_id,
                "expiresAt": expires,
            },
            # A fresh approval restarts the clock rather than topping up an old one.
            "update": {"userId": user_id, "expiresAt": expires},
        },
    )


async def record_use(grant_id: str) -> None:
    """Count an auto-approved action against its grant."""
    try:
        await prisma.qlixtoolgrant.update(
            where={"id": grant_id},
            data={"useCount": {"increment": 1}, "lastUsedAt": _now()},
        )
    except Exception:
        logger.debug("Could not record use of grant %s", grant_id)


async def revoke(*, organization_id: str, grant_id: str) -> bool:
    row = await prisma.qlixtoolgrant.find_first(
        where={"id": grant_id, "organizationId": organization_id}
    )
    if not row:
        return False
    await prisma.qlixtoolgrant.delete(where={"id": row.id})
    return True


async def revoke_all(organization_id: str) -> int:
    result = await prisma.qlixtoolgrant.delete_many(
        where={"organizationId": organization_id}
    )
    return result or 0


def serialize(row) -> dict[str, Any]:
    expires = _aware(row.expiresAt)
    remaining = int((expires - _now()).total_seconds()) if expires else 0
    return {
        "id": row.id,
        "tool": row.tool,
        "label": row.tool.replace("_", " "),
        "user_id": row.userId,
        "expires_at": expires.isoformat() if expires else None,
        "expires_in_seconds": max(0, remaining),
        "use_count": row.useCount,
        "last_used_at": _aware(row.lastUsedAt).isoformat() if row.lastUsedAt else None,
    }


async def list_active(organization_id: str) -> list[dict[str, Any]]:
    rows = await prisma.qlixtoolgrant.find_many(
        where={"organizationId": organization_id, "expiresAt": {"gt": _now()}},
        order={"expiresAt": "desc"},
    )
    return [serialize(r) for r in rows]
