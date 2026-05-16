from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from loomrun_api.prisma_client import prisma
from loomrun_api.security import decode_token_safe
from prisma.models import Membership, User


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


async def get_org_context(
    org_id: str,
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
    return OrgContext(organization_id=org_id, membership=membership)


def require_roles(*roles: str):
    """Dependency factory: restrict to membership roles (uppercase names matching enum)."""

    async def _checker(ctx: OrgContext = Depends(get_org_context)) -> OrgContext:
        role = ctx.membership.role.name if hasattr(ctx.membership.role, "name") else str(ctx.membership.role)
        if role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return ctx

    return _checker
