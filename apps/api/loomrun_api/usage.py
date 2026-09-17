"""Daily usage counters for plan capacity limits (WhatsApp).

AI chat uses dual credit windows in loomrun_api.ai_usage instead.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import HTTPException, status

from loomrun_api.ai_usage import ai_usage_snapshot
from loomrun_api.entitlements import Entitlements, METRIC_WHATSAPP
from loomrun_api.prisma_client import prisma


def _today() -> datetime:
    d = datetime.now(timezone.utc).date()
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


async def get_usage_count(organization_id: str, metric: str) -> int:
    day = _today()
    row = await prisma.usagedaily.find_unique(
        where={
            "organizationId_day_metric": {
                "organizationId": organization_id,
                "day": day,
                "metric": metric,
            }
        }
    )
    return int(row.count) if row else 0


async def increment_usage(organization_id: str, metric: str, *, by: int = 1) -> int:
    day = _today()
    existing = await prisma.usagedaily.find_unique(
        where={
            "organizationId_day_metric": {
                "organizationId": organization_id,
                "day": day,
                "metric": metric,
            }
        }
    )
    if existing:
        updated = await prisma.usagedaily.update(
            where={"id": existing.id},
            data={"count": existing.count + by},
        )
        return int(updated.count)
    created = await prisma.usagedaily.create(
        data={
            "organizationId": organization_id,
            "day": day,
            "metric": metric,
            "count": by,
        }
    )
    return int(created.count)


async def require_capacity(
    organization_id: str,
    *,
    ents: Entitlements,
    metric: str,
    limit: int | None,
    label: str,
) -> None:
    if limit is None:
        return
    if limit <= 0:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"{label} is not available on your current plan. Please upgrade.",
        )
    used = await get_usage_count(organization_id, metric)
    if used >= limit:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Daily {label} limit reached ({limit}/day on your plan). Upgrade for higher capacity.",
        )


async def usage_snapshot(organization_id: str, ents: Entitlements) -> dict:
    wa = await get_usage_count(organization_id, METRIC_WHATSAPP)
    ai = await ai_usage_snapshot(organization_id, ents)
    return {
        "day": date.today().isoformat(),
        "whatsapp_outbound": {
            "used": wa,
            "limit": ents.messages_per_day,
        },
        "ai": ai,
    }
