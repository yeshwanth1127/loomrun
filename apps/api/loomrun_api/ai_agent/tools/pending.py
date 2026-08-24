"""Pending write-action store backed by AiPendingAction."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status

from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta

PENDING_TTL_MINUTES = 10
# Qlix expires an unanswered JIT approval in about two minutes and then treats
# the action as denied. Our own row must not outlive theirs, or the UI would
# offer a Confirm button that silently does nothing.
JIT_TTL_SECONDS = 110


async def create_pending_action(
    *,
    organization_id: str,
    user_id: str,
    tool: str,
    payload: dict[str, Any],
    summary: str,
    jit_request_id: str | None = None,
    qlix_run_id: str | None = None,
) -> dict[str, Any]:
    if jit_request_id:
        expires = datetime.now(timezone.utc) + timedelta(seconds=JIT_TTL_SECONDS)
    else:
        expires = datetime.now(timezone.utc) + timedelta(minutes=PENDING_TTL_MINUTES)
    row = await prisma.aipendingaction.create(
        data={
            "organizationId": organization_id,
            "userId": user_id,
            "tool": tool,
            "payload": json_meta(payload),
            "summary": summary[:500],
            "expiresAt": expires,
            "status": "pending",
            "jitRequestId": jit_request_id,
            "qlixRunId": qlix_run_id,
        }
    )
    return {
        "id": row.id,
        "tool": row.tool,
        "summary": row.summary,
        "args_preview": payload,
        "expires_at": row.expiresAt.isoformat(),
        "jit_request_id": jit_request_id,
    }


async def get_pending_for_user(
    *,
    action_id: str,
    organization_id: str,
    user_id: str,
) -> Any:
    row = await prisma.aipendingaction.find_first(
        where={
            "id": action_id,
            "organizationId": organization_id,
            "userId": user_id,
        }
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pending action not found")
    return row


async def mark_expired_if_needed(row) -> None:
    now = datetime.now(timezone.utc)
    expires = row.expiresAt
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if row.status == "pending" and expires < now:
        await prisma.aipendingaction.update(
            where={"id": row.id},
            data={"status": "expired"},
        )
        raise HTTPException(status.HTTP_410_GONE, detail="Pending action has expired")


async def confirm_pending(
    *,
    action_id: str,
    organization_id: str,
    user_id: str,
) -> tuple[str, dict[str, Any]]:
    row = await get_pending_for_user(
        action_id=action_id,
        organization_id=organization_id,
        user_id=user_id,
    )
    await mark_expired_if_needed(row)
    if row.status != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Pending action is already {row.status}",
        )
    payload = row.payload if isinstance(row.payload, dict) else {}
    await prisma.aipendingaction.update(
        where={"id": row.id},
        data={"status": "confirmed"},
    )
    return row.tool, payload


async def get_pending_row(
    *,
    action_id: str,
    organization_id: str,
    user_id: str,
):
    """Fetch a pending row without consuming it (Qlix-backed flows need the JIT id)."""
    row = await get_pending_for_user(
        action_id=action_id,
        organization_id=organization_id,
        user_id=user_id,
    )
    await mark_expired_if_needed(row)
    return row


async def set_status(action_id: str, status_value: str) -> None:
    await prisma.aipendingaction.update(
        where={"id": action_id}, data={"status": status_value}
    )


async def cancel_pending(
    *,
    action_id: str,
    organization_id: str,
    user_id: str,
) -> dict[str, Any]:
    row = await get_pending_for_user(
        action_id=action_id,
        organization_id=organization_id,
        user_id=user_id,
    )
    if row.status != "pending":
        return {"id": row.id, "status": row.status, "cancelled": False}
    await prisma.aipendingaction.update(
        where={"id": row.id},
        data={"status": "cancelled"},
    )
    return {"id": row.id, "status": "cancelled", "cancelled": True}
