"""Dual-window Loomrun AI credits: 5-hour session + weekly pools.

Credits are token-weighted so multi-tool / long turns cost more than a short
reply. Both pools must have remaining balance; either empty → hard stop.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import HTTPException, status

from loomrun_api.entitlements import Entitlements, utcnow
from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)

WINDOW_SESSION_5H = "session_5h"
WINDOW_WEEKLY = "weekly"
WindowType = Literal["session_5h", "weekly"]

AiUsageSource = Literal["chat", "memory", "automation", "qlix"]

SESSION_HOURS = 5
WEEK_SECONDS = 7 * 24 * 3600

# When Qlix (or another path) does not return token usage, charge a mid-light turn.
DEFAULT_ESTIMATED_CREDITS = 5


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def credits_from_tokens(prompt_tokens: int, completion_tokens: int) -> int:
    """~1 credit ≈ 1k effective tokens; completion weighted 3×."""
    prompt = max(0, int(prompt_tokens or 0))
    completion = max(0, int(completion_tokens or 0))
    if prompt == 0 and completion == 0:
        return DEFAULT_ESTIMATED_CREDITS
    return max(1, math.ceil((prompt + 3 * completion) / 1000))


def parse_usage_dict(usage: dict[str, Any] | None) -> tuple[int, int]:
    if not isinstance(usage, dict):
        return 0, 0
    prompt = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    completion = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    return max(0, prompt), max(0, completion)


def accumulate_usage(
    totals: dict[str, int],
    usage: dict[str, Any] | None,
) -> None:
    prompt, completion = parse_usage_dict(usage)
    totals["prompt_tokens"] = totals.get("prompt_tokens", 0) + prompt
    totals["completion_tokens"] = totals.get("completion_tokens", 0) + completion


def weekly_period_bounds(anchor: datetime, now: datetime | None = None) -> tuple[datetime, datetime]:
    """Fixed weekly reset aligned to org createdAt weekday/time (UTC)."""
    anchor_u = _as_utc(anchor) or utcnow()
    now_u = _as_utc(now) or utcnow()
    elapsed = (now_u - anchor_u).total_seconds()
    if elapsed < 0:
        return now_u, now_u + timedelta(seconds=WEEK_SECONDS)
    n = int(elapsed // WEEK_SECONDS)
    start = anchor_u + timedelta(seconds=n * WEEK_SECONDS)
    end = start + timedelta(seconds=WEEK_SECONDS)
    return start, end


def _window_payload(row: Any) -> dict[str, Any]:
    used = int(row.usedCredits)
    limit = int(row.limitCredits)
    remaining = max(0, limit - used) if limit > 0 else 0
    resets_at = _as_utc(row.periodEnd)
    return {
        "used": used,
        "limit": limit,
        "remaining": remaining,
        "resetsAt": resets_at.isoformat() if resets_at else None,
        "periodStart": (_as_utc(row.periodStart) or utcnow()).isoformat(),
    }


async def _get_org_created_at(organization_id: str) -> datetime:
    org = await prisma.organization.find_unique(where={"id": organization_id})
    if not org:
        return utcnow()
    return _as_utc(org.createdAt) or utcnow()


async def ensure_window(
    organization_id: str,
    window_type: WindowType,
    *,
    limit_credits: int,
    org_created_at: datetime | None = None,
    create_if_missing: bool = True,
) -> Any | None:
    """Return the active window row, creating or rolling when expired.

    Session windows are created lazily on first debit (`create_if_missing`).
    Weekly windows are always materialised (calendar-aligned to org createdAt).
    """
    now = utcnow()
    limit = max(0, int(limit_credits))
    existing = await prisma.aiusagewindow.find_unique(
        where={
            "organizationId_windowType": {
                "organizationId": organization_id,
                "windowType": window_type,
            }
        }
    )
    period_end = _as_utc(existing.periodEnd) if existing else None
    if existing and period_end and period_end > now:
        if int(existing.limitCredits) != limit:
            return await prisma.aiusagewindow.update(
                where={"id": existing.id},
                data={"limitCredits": limit},
            )
        return existing

    if not create_if_missing and window_type == WINDOW_SESSION_5H:
        return None

    if window_type == WINDOW_WEEKLY:
        anchor = _as_utc(org_created_at) or await _get_org_created_at(organization_id)
        start, end = weekly_period_bounds(anchor, now)
    else:
        start = now
        end = now + timedelta(hours=SESSION_HOURS)

    data = {
        "periodStart": start,
        "periodEnd": end,
        "limitCredits": limit,
        "usedCredits": 0,
    }
    if existing:
        return await prisma.aiusagewindow.update(where={"id": existing.id}, data=data)
    return await prisma.aiusagewindow.create(
        data={
            "organizationId": organization_id,
            "windowType": window_type,
            **data,
        }
    )


def _empty_session_payload(limit: int | None) -> dict[str, Any]:
    return {
        "used": 0,
        "limit": limit,
        "remaining": limit if limit is not None else None,
        "resetsAt": None,
        "periodStart": None,
    }


async def get_ai_windows(
    organization_id: str,
    ents: Entitlements,
    *,
    org_created_at: datetime | None = None,
) -> dict[str, Any]:
    session_limit = ents.ai_credits_per_5h
    weekly_limit = ents.ai_credits_per_week
    if session_limit is None and weekly_limit is None:
        return {
            "session5h": {"used": 0, "limit": None, "remaining": None, "resetsAt": None},
            "weekly": {"used": 0, "limit": None, "remaining": None, "resetsAt": None},
        }

    # Do not start the 5h clock just by viewing status / subscription.
    session = await ensure_window(
        organization_id,
        WINDOW_SESSION_5H,
        limit_credits=session_limit or 0,
        org_created_at=org_created_at,
        create_if_missing=False,
    )
    weekly = await ensure_window(
        organization_id,
        WINDOW_WEEKLY,
        limit_credits=weekly_limit or 0,
        org_created_at=org_created_at,
        create_if_missing=True,
    )
    return {
        "session5h": (
            _window_payload(session)
            if session
            else _empty_session_payload(session_limit)
        ),
        "weekly": _window_payload(weekly),
    }


async def require_ai_capacity(
    organization_id: str,
    *,
    ents: Entitlements,
    org_created_at: datetime | None = None,
) -> dict[str, Any]:
    """Hard-stop when either pool is empty. Returns current window snapshot."""
    session_limit = ents.ai_credits_per_5h
    weekly_limit = ents.ai_credits_per_week

    if session_limit is not None and session_limit <= 0:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="AI chat is not available on your current plan. Please upgrade.",
        )
    if weekly_limit is not None and weekly_limit <= 0:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="AI chat is not available on your current plan. Please upgrade.",
        )

    windows = await get_ai_windows(
        organization_id, ents, org_created_at=org_created_at
    )

    session = windows["session5h"]
    weekly = windows["weekly"]

    # No active session row yet → full session budget available.
    session_remaining = (
        session["remaining"]
        if session.get("resetsAt") is not None
        else (session_limit if session_limit is not None else None)
    )
    if session_limit is not None and session_remaining is not None and session_remaining <= 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "AI_SESSION_LIMIT",
                "message": (
                    f"5-hour AI usage limit reached ({session['limit']} credits). "
                    f"Resets at {session['resetsAt']}."
                ),
                "resetsAt": session["resetsAt"],
                "window": "session5h",
                "usage": windows,
            },
        )
    if weekly_limit is not None and weekly["remaining"] <= 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "AI_WEEKLY_LIMIT",
                "message": (
                    f"Weekly AI usage limit reached ({weekly['limit']} credits). "
                    f"Resets at {weekly['resetsAt']}."
                ),
                "resetsAt": weekly["resetsAt"],
                "window": "weekly",
                "usage": windows,
            },
        )
    return windows


async def has_ai_capacity(
    organization_id: str,
    *,
    ents: Entitlements,
) -> bool:
    """Non-raising capacity probe (e.g. skip background memory when empty)."""
    try:
        await require_ai_capacity(organization_id, ents=ents)
        return True
    except HTTPException:
        return False


async def debit_ai_usage(
    organization_id: str,
    *,
    ents: Entitlements,
    source: AiUsageSource,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    credits: int | None = None,
    model: str | None = None,
    conversation_id: str | None = None,
    org_created_at: datetime | None = None,
) -> dict[str, Any]:
    """Record an AiUsageEvent and debit both active windows."""
    charged = (
        int(credits)
        if credits is not None
        else credits_from_tokens(prompt_tokens, completion_tokens)
    )
    charged = max(1, charged)

    session_limit = ents.ai_credits_per_5h or 0
    weekly_limit = ents.ai_credits_per_week or 0

    # First debit starts the 5h session clock.
    session = await ensure_window(
        organization_id,
        WINDOW_SESSION_5H,
        limit_credits=session_limit,
        org_created_at=org_created_at,
        create_if_missing=True,
    )
    weekly = await ensure_window(
        organization_id,
        WINDOW_WEEKLY,
        limit_credits=weekly_limit,
        org_created_at=org_created_at,
        create_if_missing=True,
    )
    assert session is not None and weekly is not None

    await prisma.aiusagewindow.update(
        where={"id": session.id},
        data={"usedCredits": int(session.usedCredits) + charged},
    )
    await prisma.aiusagewindow.update(
        where={"id": weekly.id},
        data={"usedCredits": int(weekly.usedCredits) + charged},
    )

    try:
        await prisma.aiusageevent.create(
            data={
                "organizationId": organization_id,
                "conversationId": conversation_id,
                "source": source,
                "promptTokens": max(0, int(prompt_tokens)),
                "completionTokens": max(0, int(completion_tokens)),
                "credits": charged,
                "model": (model or "")[:200] or None,
            }
        )
    except Exception:
        logger.exception(
            "Failed to persist AiUsageEvent for org %s source=%s",
            organization_id,
            source,
        )

    return await get_ai_windows(
        organization_id, ents, org_created_at=org_created_at
    )


async def ai_usage_snapshot(
    organization_id: str,
    ents: Entitlements,
    *,
    org_created_at: datetime | None = None,
) -> dict[str, Any]:
    return await get_ai_windows(
        organization_id, ents, org_created_at=org_created_at
    )


async def average_event_stats(
    organization_id: str | None = None,
    *,
    days: int = 14,
) -> dict[str, Any]:
    """Ops helper: summarize AiUsageEvent volume for recalibrating plan caps.

    Run after 1–2 weeks of production traffic. If average tokens/credit drift,
    adjust ``credits_from_tokens`` weight or ``ai_credits_per_*`` entitlements.
    Starting caps (margin-safe for gpt-4o-mini): Free 80/400, Growth 120/700,
    Scale 400/2500.
    """
    since = utcnow() - timedelta(days=max(1, days))
    where: dict[str, Any] = {"createdAt": {"gte": since}}
    if organization_id:
        where["organizationId"] = organization_id
    rows = await prisma.aiusageevent.find_many(where=where, take=50_000)
    if not rows:
        return {
            "events": 0,
            "days": days,
            "total_credits": 0,
            "avg_credits_per_event": 0,
            "avg_prompt_tokens": 0,
            "avg_completion_tokens": 0,
            "by_source": {},
        }
    total_credits = sum(int(r.credits) for r in rows)
    total_prompt = sum(int(r.promptTokens) for r in rows)
    total_completion = sum(int(r.completionTokens) for r in rows)
    by_source: dict[str, dict[str, float]] = {}
    for r in rows:
        bucket = by_source.setdefault(
            r.source,
            {"events": 0, "credits": 0, "prompt_tokens": 0, "completion_tokens": 0},
        )
        bucket["events"] += 1
        bucket["credits"] += int(r.credits)
        bucket["prompt_tokens"] += int(r.promptTokens)
        bucket["completion_tokens"] += int(r.completionTokens)
    n = len(rows)
    return {
        "events": n,
        "days": days,
        "total_credits": total_credits,
        "avg_credits_per_event": round(total_credits / n, 2),
        "avg_prompt_tokens": round(total_prompt / n, 1),
        "avg_completion_tokens": round(total_completion / n, 1),
        "by_source": by_source,
    }
