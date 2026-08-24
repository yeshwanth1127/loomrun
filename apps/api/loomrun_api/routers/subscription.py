"""Org subscription catalog, current plan, seats, trial, and usage."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.entitlements import (
    PLAN_CATALOG,
    ai_mode_label,
    get_org_entitlements,
    max_seats_for_org,
    normalize_plan,
    trial_payload,
)
from loomrun_api.prisma_client import prisma
from loomrun_api.usage import usage_snapshot

router = APIRouter()


@router.get("/orgs/{org_id}/subscription")
async def get_org_subscription(ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    if not org:
        return {"plan": "free"}

    plan = normalize_plan(org.plan)
    ents = get_org_entitlements(org)
    member_count = await prisma.membership.count(where={"organizationId": org.id})
    lead_count = await prisma.lead.count(where={"organizationId": org.id})
    extra_seats = getattr(org, "extraSeats", 0) or 0
    seat_limit = max_seats_for_org(org=org)
    trial = trial_payload(org)
    usage = await usage_snapshot(org.id, ents)

    sub = await prisma.subscription.find_first(
        where={"organizationId": org.id},
        order={"updatedAt": "desc"},
    )

    upgrade_email = settings.subscription_support_email.strip() or "support@loomrun.com"

    return {
        "plan": plan,
        "plan_label": "Free trial" if trial["trial_active"] else plan.title(),
        "status": (
            "trial"
            if trial["trial_active"]
            else (
                "expired"
                if trial["trial_expired"]
                else (sub.status if sub else ("active" if plan != "free" else "inactive"))
            )
        ),
        "entitlements": ents.to_dict(),
        "ai_mode": ai_mode_label(ents),
        "trial": trial,
        "usage": usage,
        "seats": {
            "used": member_count,
            "included": ents.max_users,
            "extra": extra_seats,
            "limit": seat_limit,
            "extra_user_price_inr": ents.extra_user_price_inr,
        },
        "leads": {
            "used": lead_count,
            "limit": ents.max_leads,
        },
        "catalog": PLAN_CATALOG,
        "upgrade": {
            "contact_email": upgrade_email,
            "mailto": (
                f"mailto:{upgrade_email}"
                f"?subject=Loomrun%20plan%20upgrade%20request"
                f"&body=Organization%3A%20{org.name}%20({org.id})%0ACurrent%20plan%3A%20{plan}%0A"
            ),
        },
        "subscription": (
            {
                "id": sub.id,
                "plan_key": sub.planKey,
                "status": sub.status,
                "current_period_end": sub.currentPeriodEnd.isoformat() if sub.currentPeriodEnd else None,
                "seat_count": sub.seatCount,
            }
            if sub
            else None
        ),
    }
