from asyncio import gather

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from loomrun_api.deps import require_super_admin
from loomrun_api.prisma_client import prisma
from prisma.enums import MembershipRole
from prisma.models import User

router = APIRouter()


class PatchOrganizationBody(BaseModel):
    suspended: bool


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
    updated = await prisma.organization.update(
        where={"id": org_id},
        data={"suspended": body.suspended},
    )
    return {
        "id": updated.id,
        "name": updated.name,
        "slug": updated.slug,
        "plan": updated.plan,
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
        return {
            "id": existing.id,
            "user_id": existing.userId,
            "organization_id": existing.organizationId,
            "role": existing.role.name if hasattr(existing.role, "name") else str(existing.role),
            "already_member": True,
        }
    m = await prisma.membership.create(
        data={
            "userId": admin.id,
            "organizationId": org_id,
            "role": MembershipRole.VIEWER,
        },
    )
    return {
        "id": m.id,
        "user_id": m.userId,
        "organization_id": m.organizationId,
        "role": m.role.name if hasattr(m.role, "name") else str(m.role),
        "already_member": False,
    }
