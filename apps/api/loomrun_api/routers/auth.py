import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from loomrun_api.config import settings
from loomrun_api.auth_limits import limit_auth_attempts
from loomrun_api.deps import get_current_user_id, require_super_admin
from loomrun_api.entitlements import default_trial_ends_at, trial_payload
from loomrun_api.prisma_client import prisma
from loomrun_api.security import (
    create_access_token,
    create_refresh_token,
    decode_token_safe,
    hash_password,
    verify_password,
)
from prisma.enums import MembershipRole

router = APIRouter(dependencies=[Depends(limit_auth_attempts)])


def slugify(name: str) -> str:
    s = re.sub(r"[^\w\s-]", "", name.lower()).strip()
    s = re.sub(r"[-\s]+", "-", s)
    return (s[:48] or "org").strip("-")


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str | None = None
    organization_name: str = Field(min_length=1, max_length=120)


class RegisterSuperAdminBody(BaseModel):
    """Admin-provisioned platform account. Email must be listed in SUPER_ADMIN_EMAILS."""

    email: EmailStr
    password: str = Field(min_length=8)
    name: str | None = None


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class RefreshBody(BaseModel):
    refresh_token: str


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterBody) -> dict:
    existing = await prisma.user.find_unique(where={"email": body.email})
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    base_slug = slugify(body.organization_name)
    slug = base_slug
    for _ in range(10):
        clash = await prisma.organization.find_unique(where={"slug": slug})
        if not clash:
            break
        slug = f"{base_slug}-{secrets.token_hex(3)}"

    password_hash = hash_password(body.password)
    is_super = False
    org = await prisma.organization.create(
        data={
            "name": body.organization_name,
            "slug": slug,
            "plan": "free",
            "trialEndsAt": default_trial_ends_at(),
        },
    )
    user = await prisma.user.create(
        data={
            "email": body.email,
            "passwordHash": password_hash,
            "name": body.name,
            "isSuperAdmin": is_super,
        },
    )
    await prisma.membership.create(
        data={
            "userId": user.id,
            "organizationId": org.id,
            "role": MembershipRole.OWNER,
        },
    )
    from loomrun_api.document_template_defaults import seed_org_templates

    await seed_org_templates(prisma, org.id)
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


@router.post("/register-super-admin", status_code=status.HTTP_201_CREATED)
async def register_super_admin(body: RegisterSuperAdminBody, _admin=Depends(require_super_admin)) -> dict:
    email_norm = str(body.email).lower().strip()
    if email_norm not in settings.super_admin_email_set:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="This email is not authorized for platform super admin registration",
        )
    existing = await prisma.user.find_unique(where={"email": body.email})
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    password_hash = hash_password(body.password)
    user = await prisma.user.create(
        data={
            "email": body.email,
            "passwordHash": password_hash,
            "name": body.name,
            "isSuperAdmin": True,
        },
    )
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


@router.post("/login")
async def login(body: LoginBody) -> dict:
    user = await prisma.user.find_unique(where={"email": body.email})
    if not user or not verify_password(body.password, user.passwordHash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


@router.post("/refresh")
async def refresh_token(body: RefreshBody) -> dict:
    payload = decode_token_safe(body.refresh_token)
    if not payload or payload.get("typ") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    sub = payload.get("sub")
    if not sub or not isinstance(sub, str):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user = await prisma.user.find_unique(where={"id": sub})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User not found")
    access = create_access_token(user.id)
    new_refresh = create_refresh_token(user.id)
    return {"access_token": access, "refresh_token": new_refresh, "token_type": "bearer"}


@router.get("/me")
async def me(user_id: str = Depends(get_current_user_id)) -> dict:
    user = await prisma.user.find_unique(
        where={"id": user_id},
        include={"memberships": {"include": {"organization": True}}},
    )
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    orgs = []
    for m in user.memberships or []:
        org = m.organization
        orgs.append(
            {
                "membership_id": m.id,
                "role": m.role.name if hasattr(m.role, "name") else str(m.role),
                "organization": {
                    "id": org.id,
                    "name": org.name,
                    "slug": org.slug,
                    "plan": org.plan,
                    "suspended": org.suspended,
                    **trial_payload(org),
                },
            }
        )
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "is_super_admin": user.isSuperAdmin,
        "organizations": orgs,
    }
