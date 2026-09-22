"""Cross-tenant snapshot for the platform super-admin dashboard.

One overview query (orgs → members → AI usage) plus a paginated turns
list. Token counts live on ``AiUsageEvent`` (one row per AI turn), not
on individual chat messages.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from asyncio import gather

from loomrun_api.entitlements import get_entitlements
from loomrun_api.prisma_client import prisma


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    ready = _as_utc(dt)
    return ready.isoformat() if ready else None


def _role_name(role: Any) -> str:
    return role.name if hasattr(role, "name") else str(role)


def _row_int(row: dict[str, Any], *keys: str) -> int:
    for key in keys:
        if key in row and row[key] is not None:
            return int(row[key])
    return 0


def _row_str(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value:
            return str(value)
    return ""


def usage_bucket(
    turns: int,
    prompt_tokens: int,
    completion_tokens: int,
    credits: int,
) -> dict[str, int | float]:
    prompt = max(0, int(prompt_tokens or 0))
    completion = max(0, int(completion_tokens or 0))
    turns_n = max(0, int(turns or 0))
    credits_n = max(0, int(credits or 0))
    total = prompt + completion
    return {
        "turns": turns_n,
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
        "credits": credits_n,
        "avg_tokens_per_turn": round(total / turns_n, 1) if turns_n else 0,
    }


def empty_usage() -> dict[str, int | float]:
    return usage_bucket(0, 0, 0, 0)


def group_usage_bucket(row: dict[str, Any]) -> tuple[str, dict[str, int | float]]:
    """Turn a Prisma group_by row into (org_id, usage_bucket)."""
    org_id = _row_str(row, "organizationId", "organization_id")
    count = row.get("_count")
    if isinstance(count, dict):
        turns = int(count.get("_all") or 0)
    else:
        turns = int(count or 0)
    summed = row.get("_sum") if isinstance(row.get("_sum"), dict) else {}
    return org_id, usage_bucket(
        turns,
        int(summed.get("promptTokens") or summed.get("prompt_tokens") or 0),
        int(summed.get("completionTokens") or summed.get("completion_tokens") or 0),
        int(summed.get("credits") or 0),
    )


def merge_usage_groups(
    all_time_rows: list[dict[str, Any]],
    week_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Flatten all-time + 7d group_by results into parse_usage_row dicts."""
    week_by_org = dict(group_usage_bucket(row) for row in week_rows)
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in all_time_rows:
        org_id, all_time = group_usage_bucket(row)
        if not org_id:
            continue
        seen.add(org_id)
        week = week_by_org.get(org_id, empty_usage())
        merged.append(_combined_usage_row(org_id, all_time, week))
    for org_id, week in week_by_org.items():
        if org_id in seen:
            continue
        merged.append(_combined_usage_row(org_id, empty_usage(), week))
    return merged


def _combined_usage_row(
    org_id: str,
    all_time: dict[str, int | float],
    week: dict[str, int | float],
) -> dict[str, Any]:
    return {
        "organization_id": org_id,
        "turns": all_time["turns"],
        "prompt_tokens": all_time["prompt_tokens"],
        "completion_tokens": all_time["completion_tokens"],
        "credits": all_time["credits"],
        "turns_7d": week["turns"],
        "prompt_tokens_7d": week["prompt_tokens"],
        "completion_tokens_7d": week["completion_tokens"],
        "credits_7d": week["credits"],
    }


def parse_usage_row(row: dict[str, Any]) -> tuple[str, dict[str, int | float], dict[str, int | float]]:
    org_id = _row_str(row, "organization_id", "organizationId")
    all_time = usage_bucket(
        _row_int(row, "turns"),
        _row_int(row, "prompt_tokens", "promptTokens"),
        _row_int(row, "completion_tokens", "completionTokens"),
        _row_int(row, "credits"),
    )
    last_7d = usage_bucket(
        _row_int(row, "turns_7d", "turns7d"),
        _row_int(row, "prompt_tokens_7d", "promptTokens7d"),
        _row_int(row, "completion_tokens_7d", "completionTokens7d"),
        _row_int(row, "credits_7d", "credits7d"),
    )
    return org_id, all_time, last_7d


def rollup_usage(buckets: list[dict[str, int | float]]) -> dict[str, int | float]:
    return usage_bucket(
        sum(int(b.get("turns") or 0) for b in buckets),
        sum(int(b.get("prompt_tokens") or 0) for b in buckets),
        sum(int(b.get("completion_tokens") or 0) for b in buckets),
        sum(int(b.get("credits") or 0) for b in buckets),
    )


def _window_view(
    window: Any | None,
    plan_limit: int | None,
) -> dict[str, Any]:
    if window is None:
        remaining = plan_limit if plan_limit is not None else None
        return {
            "used": 0,
            "limit": plan_limit,
            "remaining": remaining,
            "resets_at": None,
        }
    used = int(getattr(window, "usedCredits", 0) or 0)
    stored_limit = getattr(window, "limitCredits", None)
    limit = int(stored_limit) if stored_limit is not None else plan_limit
    remaining = max(0, limit - used) if limit is not None else None
    return {
        "used": used,
        "limit": limit,
        "remaining": remaining,
        "resets_at": _iso(getattr(window, "periodEnd", None)),
    }


def serialize_member(membership: Any, user: Any) -> dict[str, Any]:
    return {
        "membership_id": membership.id,
        "user_id": user.id,
        "email": user.email,
        "name": user.name,
        "role": _role_name(membership.role),
        "is_super_admin": bool(getattr(user, "isSuperAdmin", False)),
        "joined_at": _iso(getattr(membership, "createdAt", None)),
    }


def serialize_user(user: Any) -> dict[str, Any]:
    orgs = []
    for membership in getattr(user, "memberships", None) or []:
        org = getattr(membership, "organization", None)
        orgs.append(
            {
                "id": membership.organizationId,
                "name": org.name if org else membership.organizationId,
                "slug": org.slug if org else "",
                "role": _role_name(membership.role),
            }
        )
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "is_super_admin": bool(user.isSuperAdmin),
        "created_at": _iso(user.createdAt),
        "organizations": orgs,
    }


def serialize_turn(
    event: Any,
    *,
    organization_name: str = "",
    conversation_title: str | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
) -> dict[str, Any]:
    prompt = int(event.promptTokens or 0)
    completion = int(event.completionTokens or 0)
    return {
        "id": event.id,
        "organization_id": event.organizationId,
        "organization_name": organization_name,
        "conversation_id": event.conversationId,
        "conversation_title": conversation_title,
        "user_email": user_email,
        "user_name": user_name,
        "source": event.source,
        "model": event.model,
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
        "credits": int(event.credits or 0),
        "created_at": _iso(event.createdAt),
    }


def assemble_overview(
    *,
    now: datetime,
    orgs: list[Any],
    users: list[Any],
    usage_rows: list[dict[str, Any]],
    windows: list[Any],
) -> dict[str, Any]:
    usage_all: dict[str, dict[str, int | float]] = {}
    usage_week: dict[str, dict[str, int | float]] = {}
    for row in usage_rows:
        org_id, all_time, last_7d = parse_usage_row(row)
        if not org_id:
            continue
        usage_all[org_id] = all_time
        usage_week[org_id] = last_7d

    windows_by_key: dict[tuple[str, str], Any] = {}
    for window in windows:
        windows_by_key[(window.organizationId, window.windowType)] = window

    members_by_org: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for user in users:
        for membership in getattr(user, "memberships", None) or []:
            members_by_org[membership.organizationId].append(
                serialize_member(membership, user)
            )

    organizations = []
    for org in orgs:
        ents = get_entitlements(getattr(org, "plan", None))
        all_time = usage_all.get(org.id, empty_usage())
        last_7d = usage_week.get(org.id, empty_usage())
        members = sorted(
            members_by_org.get(org.id, []),
            key=lambda m: (m["role"] != "OWNER", (m["email"] or "").lower()),
        )
        organizations.append(
            {
                "id": org.id,
                "name": org.name,
                "slug": org.slug,
                "plan": (org.plan or "free").lower(),
                "extra_seats": int(getattr(org, "extraSeats", 0) or 0),
                "suspended": bool(org.suspended),
                "created_at": _iso(org.createdAt),
                "member_count": len(members),
                "members": members,
                "ai": {
                    **all_time,
                    "last_7d": last_7d,
                    "windows": {
                        "session_5h": _window_view(
                            windows_by_key.get((org.id, "session_5h")),
                            ents.ai_credits_per_5h,
                        ),
                        "weekly": _window_view(
                            windows_by_key.get((org.id, "weekly")),
                            ents.ai_credits_per_week,
                        ),
                    },
                },
            }
        )

    organizations.sort(
        key=lambda row: (
            -int(row["ai"]["total_tokens"]),
            -int(row["member_count"]),
            row["name"].lower(),
        )
    )

    return {
        "generated_at": _iso(now),
        "totals": {
            "organizations": len(orgs),
            "users": len(users),
            "super_admins": sum(1 for user in users if user.isSuperAdmin),
            "memberships": sum(len(row["members"]) for row in organizations),
            "ai": {
                **rollup_usage(list(usage_all.values())),
                "last_7d": rollup_usage(list(usage_week.values())),
            },
        },
        "organizations": organizations,
        "users": [serialize_user(user) for user in users],
    }


async def _usage_grouped(since: datetime | None = None) -> list[dict[str, Any]]:
    where: dict[str, Any] = {}
    if since is not None:
        where["createdAt"] = {"gte": since}
    rows = await prisma.aiusageevent.group_by(
        by=["organizationId"],
        where=where,
        count=True,
        sum={"promptTokens": True, "completionTokens": True, "credits": True},
    )
    return list(rows or [])


async def platform_overview() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    orgs, users, windows, all_time_rows, week_rows = await gather(
        prisma.organization.find_many(order={"createdAt": "desc"}),
        prisma.user.find_many(
            order={"createdAt": "desc"},
            include={"memberships": {"include": {"organization": True}}},
        ),
        prisma.aiusagewindow.find_many(),
        _usage_grouped(),
        _usage_grouped(week_ago),
    )
    return assemble_overview(
        now=now,
        orgs=orgs,
        users=users,
        usage_rows=merge_usage_groups(all_time_rows, week_rows),
        windows=windows,
    )


async def list_ai_turns(
    *,
    organization_id: str | None = None,
    skip: int = 0,
    take: int = 50,
    days: int | None = None,
) -> dict[str, Any]:
    take = min(max(take, 1), 100)
    skip = max(skip, 0)
    where: dict[str, Any] = {}
    if organization_id:
        where["organizationId"] = organization_id
    if days and days > 0:
        where["createdAt"] = {
            "gte": datetime.now(timezone.utc) - timedelta(days=days),
        }

    events, total = (
        await prisma.aiusageevent.find_many(
            where=where,
            order={"createdAt": "desc"},
            skip=skip,
            take=take,
        ),
        await prisma.aiusageevent.count(where=where),
    )

    org_ids = {event.organizationId for event in events}
    conv_ids = [event.conversationId for event in events if event.conversationId]
    orgs = (
        await prisma.organization.find_many(where={"id": {"in": list(org_ids)}})
        if org_ids
        else []
    )
    conversations = (
        await prisma.aiconversation.find_many(
            where={"id": {"in": conv_ids}},
            include={"user": True},
        )
        if conv_ids
        else []
    )
    org_names = {org.id: org.name for org in orgs}
    conv_by_id = {conv.id: conv for conv in conversations}

    items = []
    for event in events:
        conv = conv_by_id.get(event.conversationId or "")
        user = getattr(conv, "user", None) if conv else None
        items.append(
            serialize_turn(
                event,
                organization_name=org_names.get(event.organizationId, ""),
                conversation_title=conv.title if conv else None,
                user_email=user.email if user else None,
                user_name=user.name if user else None,
            )
        )
    return {"items": items, "total": total, "skip": skip, "take": take}
