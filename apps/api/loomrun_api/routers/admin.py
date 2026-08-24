from asyncio import gather
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from loomrun_api.deps import require_super_admin
from loomrun_api.entitlements import default_trial_ends_at, max_seats_for_org, require_valid_plan
from loomrun_api.prisma_client import prisma
from prisma.enums import MembershipRole
from prisma.models import User

router = APIRouter()


class PatchOrganizationBody(BaseModel):
    suspended: Optional[bool] = None
    plan: Optional[str] = None
    extra_seats: Optional[int] = Field(default=None, ge=0, le=500)


class PatchUserBody(BaseModel):
    is_super_admin: bool


class CreateMembershipBody(BaseModel):
    organization_id: str
    user_email: EmailStr
    role: MembershipRole = MembershipRole.VIEWER


@router.get("/organizations")
async def list_organizations(_admin: User = Depends(require_super_admin)) -> dict:
    orgs = await prisma.organization.find_many(order={"createdAt": "desc"})

    async def row(o):
        member_count, lead_count = await gather(
            prisma.membership.count(where={"organizationId": o.id}),
            prisma.lead.count(where={"organizationId": o.id}),
        )
        return {
            "id": o.id,
            "name": o.name,
            "slug": o.slug,
            "plan": o.plan,
            "extra_seats": getattr(o, "extraSeats", 0) or 0,
            "suspended": o.suspended,
            "created_at": o.createdAt.isoformat(),
            "member_count": member_count,
            "lead_count": lead_count,
        }

    items = list(await gather(*[row(o) for o in orgs])) if orgs else []
    return {"items": items}


@router.patch("/organizations/{org_id}")
async def patch_organization(
    org_id: str,
    body: PatchOrganizationBody,
    _admin: User = Depends(require_super_admin),
) -> dict:
    org = await prisma.organization.find_unique(where={"id": org_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")

    data: dict = {}
    if body.suspended is not None:
        data["suspended"] = body.suspended
    if body.extra_seats is not None:
        data["extraSeats"] = body.extra_seats
    if body.plan is not None:
        plan_key = require_valid_plan(body.plan)
        data["plan"] = plan_key
        if plan_key == "free":
            # Reset / extend trial when admin assigns free
            data["trialEndsAt"] = default_trial_ends_at()
        # Paid plans unlock immediately (trial fields kept for history)

    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    updated = await prisma.organization.update(where={"id": org_id}, data=data)

    if body.plan is not None:
        plan_key = updated.plan
        sub_status = "active" if plan_key in ("growth", "scale") else "inactive"
        seat_limit = max_seats_for_org(org=updated)
        existing = await prisma.subscription.find_first(
            where={"organizationId": org_id},
            order={"updatedAt": "desc"},
        )
        if existing:
            await prisma.subscription.update(
                where={"id": existing.id},
                data={"planKey": plan_key, "status": sub_status, "seatCount": seat_limit},
            )
        else:
            await prisma.subscription.create(
                data={
                    "organizationId": org_id,
                    "planKey": plan_key,
                    "status": sub_status,
                    "seatCount": seat_limit,
                },
            )

    return {
        "id": updated.id,
        "name": updated.name,
        "slug": updated.slug,
        "plan": updated.plan,
        "extra_seats": getattr(updated, "extraSeats", 0) or 0,
        "suspended": updated.suspended,
    }


@router.get("/users")
async def list_users(
    skip: int = 0,
    take: int = 50,
    _admin: User = Depends(require_super_admin),
) -> dict:
    take = min(max(take, 1), 200)
    skip = max(skip, 0)
    users = await prisma.user.find_many(
        skip=skip,
        take=take,
        order={"createdAt": "desc"},
    )
    total = await prisma.user.count()
    items = [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "is_super_admin": u.isSuperAdmin,
            "created_at": u.createdAt.isoformat(),
        }
        for u in users
    ]
    return {"items": items, "total": total, "skip": skip, "take": take}


@router.patch("/users/{user_id}")
async def patch_user(
    user_id: str,
    body: PatchUserBody,
    admin: User = Depends(require_super_admin),
) -> dict:
    if user_id == admin.id and not body.is_super_admin:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own super admin access",
        )
    user = await prisma.user.find_unique(where={"id": user_id})
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    updated = await prisma.user.update(
        where={"id": user_id},
        data={"isSuperAdmin": body.is_super_admin},
    )
    return {
        "id": updated.id,
        "email": updated.email,
        "name": updated.name,
        "is_super_admin": updated.isSuperAdmin,
    }


@router.post("/memberships", status_code=status.HTTP_201_CREATED)
async def create_membership(
    body: CreateMembershipBody,
    _admin: User = Depends(require_super_admin),
) -> dict:
    org = await prisma.organization.find_unique(where={"id": body.organization_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    user = await prisma.user.find_unique(where={"email": body.user_email})
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found for this email")
    existing = await prisma.membership.find_first(
        where={"userId": user.id, "organizationId": body.organization_id},
    )
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Membership already exists")
    m = await prisma.membership.create(
        data={
            "userId": user.id,
            "organizationId": body.organization_id,
            "role": body.role,
        },
    )
    return {
        "id": m.id,
        "user_id": m.userId,
        "organization_id": m.organizationId,
        "role": m.role.name if hasattr(m.role, "name") else str(m.role),
    }


@router.delete("/memberships/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_membership(
    membership_id: str,
    _admin: User = Depends(require_super_admin),
) -> None:
    m = await prisma.membership.find_unique(where={"id": membership_id})
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Membership not found")
    await prisma.membership.delete(where={"id": membership_id})


@router.post("/organizations/{org_id}/join-as-support", status_code=status.HTTP_201_CREATED)
async def join_as_support(
    org_id: str,
    admin: User = Depends(require_super_admin),
) -> dict:
    org = await prisma.organization.find_unique(where={"id": org_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    existing = await prisma.membership.find_first(
        where={"userId": admin.id, "organizationId": org_id},
    )
    if existing:
        # Elevate to OWNER so platform admins can exercise full product features
        role_name = existing.role.name if hasattr(existing.role, "name") else str(existing.role)
        if role_name != "OWNER":
            existing = await prisma.membership.update(
                where={"id": existing.id},
                data={"role": MembershipRole.OWNER},
            )
            role_name = "OWNER"
        return {
            "id": existing.id,
            "user_id": existing.userId,
            "organization_id": existing.organizationId,
            "role": role_name,
            "already_member": True,
        }
    m = await prisma.membership.create(
        data={
            "userId": admin.id,
            "organizationId": org_id,
            "role": MembershipRole.OWNER,
        },
    )
    return {
        "id": m.id,
        "user_id": m.userId,
        "organization_id": m.organizationId,
        "role": m.role.name if hasattr(m.role, "name") else str(m.role),
        "already_member": False,
    }


@router.get("/analytics")
async def platform_analytics(_admin: User = Depends(require_super_admin)) -> dict:
    """Cross-tenant SaaS analytics for the super-admin dashboard."""
    from collections import Counter
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    (
        users_total,
        users_super,
        users_week,
        users_month,
        orgs_total,
        orgs_suspended,
        orgs_week,
        orgs_month,
        memberships_total,
        leads_total,
        leads_week,
        quotations_total,
        production_total,
        expenses_total,
        payments_total,
        calls_total,
        whatsapp_threads,
        outbound_messages,
        catalog_items,
        lead_connections,
        automation_connections,
        telephony_configs,
        subscriptions_active,
    ) = await gather(
        prisma.user.count(),
        prisma.user.count(where={"isSuperAdmin": True}),
        prisma.user.count(where={"createdAt": {"gte": week_ago}}),
        prisma.user.count(where={"createdAt": {"gte": month_ago}}),
        prisma.organization.count(),
        prisma.organization.count(where={"suspended": True}),
        prisma.organization.count(where={"createdAt": {"gte": week_ago}}),
        prisma.organization.count(where={"createdAt": {"gte": month_ago}}),
        prisma.membership.count(),
        prisma.lead.count(),
        prisma.lead.count(where={"createdAt": {"gte": week_ago}}),
        prisma.quotation.count(),
        prisma.productionorder.count(),
        prisma.expense.count(),
        prisma.payment.count(),
        prisma.telecallercalllog.count(),
        prisma.whatsappthread.count(),
        prisma.outboundmessage.count(),
        prisma.catalogitem.count(),
        prisma.leadconnection.count(),
        prisma.automationconnection.count(),
        prisma.telephonyconfig.count(),
        prisma.subscription.count(where={"status": "active"}),
    )

    orgs = await prisma.organization.find_many(
        order={"createdAt": "desc"},
        take=500,
    )
    plan_counts: Counter[str] = Counter((o.plan or "free").lower() for o in orgs)

    # Recent org activity snapshot (top by lead volume)
    async def org_activity(o):
        members, leads, quotes, orders, calls = await gather(
            prisma.membership.count(where={"organizationId": o.id}),
            prisma.lead.count(where={"organizationId": o.id}),
            prisma.quotation.count(where={"organizationId": o.id}),
            prisma.productionorder.count(where={"organizationId": o.id}),
            prisma.telecallercalllog.count(where={"organizationId": o.id}),
        )
        return {
            "id": o.id,
            "name": o.name,
            "slug": o.slug,
            "plan": o.plan,
            "suspended": o.suspended,
            "created_at": o.createdAt.isoformat(),
            "members": members,
            "leads": leads,
            "quotations": quotes,
            "production_orders": orders,
            "calls": calls,
        }

    activity_rows = list(await gather(*[org_activity(o) for o in orgs[:40]])) if orgs else []
    activity_rows.sort(key=lambda r: r["leads"], reverse=True)

    # Growth series: orgs + users created per day (last 14 days)
    series_days = 14
    series_start = now - timedelta(days=series_days - 1)
    recent_users = await prisma.user.find_many(
        where={"createdAt": {"gte": series_start}},
        order={"createdAt": "asc"},
    )
    recent_orgs = await prisma.organization.find_many(
        where={"createdAt": {"gte": series_start}},
        order={"createdAt": "asc"},
    )
    recent_leads = await prisma.lead.find_many(
        where={"createdAt": {"gte": series_start}},
        order={"createdAt": "asc"},
        take=5000,
    )

    def day_key(dt) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date().isoformat()

    users_by_day: Counter[str] = Counter(day_key(u.createdAt) for u in recent_users)
    orgs_by_day: Counter[str] = Counter(day_key(o.createdAt) for o in recent_orgs)
    leads_by_day: Counter[str] = Counter(day_key(l.createdAt) for l in recent_leads)

    growth = []
    for i in range(series_days):
        d = (series_start + timedelta(days=i)).date().isoformat()
        growth.append(
            {
                "date": d,
                "users": users_by_day.get(d, 0),
                "organizations": orgs_by_day.get(d, 0),
                "leads": leads_by_day.get(d, 0),
            }
        )

    # Rough MRR from active paid plans (catalog prices)
    mrr_map = {"growth": 2899, "scale": 5799}
    estimated_mrr_inr = sum(mrr_map.get(p, 0) * c for p, c in plan_counts.items())

    return {
        "generated_at": now.isoformat(),
        "totals": {
            "users": users_total,
            "super_admins": users_super,
            "organizations": orgs_total,
            "suspended_organizations": orgs_suspended,
            "memberships": memberships_total,
            "leads": leads_total,
            "quotations": quotations_total,
            "production_orders": production_total,
            "expenses": expenses_total,
            "payments": payments_total,
            "calls": calls_total,
            "whatsapp_threads": whatsapp_threads,
            "outbound_messages": outbound_messages,
            "catalog_items": catalog_items,
            "lead_connections": lead_connections,
            "automation_connections": automation_connections,
            "telephony_configs": telephony_configs,
            "active_subscriptions": subscriptions_active,
        },
        "growth": {
            "users_last_7d": users_week,
            "users_last_30d": users_month,
            "orgs_last_7d": orgs_week,
            "orgs_last_30d": orgs_month,
            "leads_last_7d": leads_week,
            "leads_last_24h": await prisma.lead.count(where={"createdAt": {"gte": day_ago}}),
        },
        "plans": {
            "counts": dict(plan_counts),
            "estimated_mrr_inr": estimated_mrr_inr,
        },
        "series": {
            "daily": growth,
        },
        "top_organizations": activity_rows[:15],
    }
