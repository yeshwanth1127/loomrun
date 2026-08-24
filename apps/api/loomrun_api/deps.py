import secrets
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request, status

from loomrun_api.config import settings
from loomrun_api.entitlements import (
    FEATURE_UPGRADE_HINTS,
    Entitlements,
    get_org_entitlements,
    is_access_locked,
    path_allowed_when_locked,
)
from loomrun_api.prisma_client import prisma
from loomrun_api.security import decode_token_safe
from prisma.models import Membership, Organization, User


async def get_current_user_id(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token_safe(token)
    if not payload or payload.get("typ") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    sub = payload.get("sub")
    if not sub or not isinstance(sub, str):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")
    return sub


async def get_current_user(user_id: str = Depends(get_current_user_id)) -> User:
    user = await prisma.user.find_unique(where={"id": user_id})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def require_super_admin(user: User = Depends(get_current_user)) -> User:
    if not user.isSuperAdmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Super admin only")
    return user


@dataclass
class OrgContext:
    organization_id: str
    membership: Membership
    organization: Organization | None = None
    entitlements: Entitlements | None = None


async def get_org_context(
    org_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> OrgContext:
    membership = await prisma.membership.find_first(
        where={"userId": user_id, "organizationId": org_id},
        include={"organization": True},
    )
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not a member of this organization")
    org = membership.organization
    if org and org.suspended:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="This organization has been suspended. Contact support.",
        )

    ents = get_org_entitlements(org) if org else None

    # Expired free trial: only subscription / brand endpoints
    if org and is_access_locked(org) and not path_allowed_when_locked(request.url.path):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail="TRIAL_EXPIRED: Your 14-day free trial has ended. Upgrade to Growth or Scale to continue.",
        )

    return OrgContext(
        organization_id=org_id,
        membership=membership,
        organization=org,
        entitlements=ents,
    )


async def require_automation_api_key(authorization: str | None = Header(None)) -> None:
    """Validate Bearer token for n8n → Loomrun automation calls (LOOMRUN_AUTOMATION_API_KEY)."""
    expected = settings.loomrun_automation_api_key.strip()
    if not expected:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Automation API key is not configured on the server",
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Missing automation API key")
    token = authorization.split(" ", 1)[1].strip()
    if not secrets.compare_digest(token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid automation API key")


def require_roles(*roles: str):
    """Dependency factory: restrict to membership roles (uppercase names matching enum)."""

    async def _checker(ctx: OrgContext = Depends(get_org_context)) -> OrgContext:
        role = ctx.membership.role.name if hasattr(ctx.membership.role, "name") else str(ctx.membership.role)
        if role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return ctx

    return _checker


def require_feature(feature: str):
    """Dependency factory: require a plan entitlement feature flag."""

    async def _checker(ctx: OrgContext = Depends(get_org_context)) -> OrgContext:
        ents = ctx.entitlements
        if ents is None and ctx.organization is not None:
            ents = get_org_entitlements(ctx.organization)
        if ents is None or not ents.has_feature(feature):
            hint = FEATURE_UPGRADE_HINTS.get(
                feature,
                "This feature is not available on your current plan. Please upgrade.",
            )
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail=f"FEATURE_LOCKED: {hint}",
            )
        return ctx

    return _checker
