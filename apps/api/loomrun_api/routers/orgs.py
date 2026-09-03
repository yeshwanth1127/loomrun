import mimetypes
import secrets

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, get_current_user_id, get_org_context, require_roles
from loomrun_api.entitlements import EXTRA_USER_PRICE_INR, default_trial_ends_at, max_seats_for_org
from loomrun_api.prisma_client import prisma
from loomrun_api.security import hash_password
from prisma.enums import MembershipRole

router = APIRouter()

_INVITABLE_ROLES = frozenset(
    {
        MembershipRole.SALES,
        MembershipRole.TELECALLER,
        MembershipRole.PRODUCTION,
        MembershipRole.VIEWER,
    }
)


class CreateOrgBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CreateOrgMemberBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str | None = None
    role: MembershipRole = MembershipRole.SALES
    whatsapp_phone: str | None = Field(default=None, max_length=32)


class UpdateOrgMemberBody(BaseModel):
    whatsapp_phone: str | None = Field(default=None, max_length=32)
    role: MembershipRole | None = None


def _normalize_member_phone(value: str | None) -> str | None:
    if value is None:
        return None
    import re

    digits = re.sub(r"\D", "", value.strip())
    if not digits:
        return None
    if len(digits) == 10:
        digits = "91" + digits
    if len(digits) < 10 or len(digits) > 15:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid WhatsApp phone number")
    return digits


_LOGO_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_SIGNATURE_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
_QR_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
_MAX_LOGO_BYTES = 2 * 1024 * 1024
_MAX_SIGNATURE_BYTES = 500 * 1024
_MAX_QR_BYTES = 200 * 1024


class BrandUpdateBody(BaseModel):
    legal_name: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=4000)
    phone: str | None = Field(default=None, max_length=80)
    email: EmailStr | None = None
    website: str | None = Field(default=None, max_length=300)
    tax_id: str | None = Field(default=None, max_length=120)
    bank_name: str | None = Field(default=None, max_length=120)
    bank_account_number: str | None = Field(default=None, max_length=80)
    bank_account_name: str | None = Field(default=None, max_length=160)
    bank_ifsc: str | None = Field(default=None, max_length=40)
    bank_swift: str | None = Field(default=None, max_length=40)
    bank_ad_code: str | None = Field(default=None, max_length=40)
    bank_branch: str | None = Field(default=None, max_length=120)


def _clean_opt(max_len: int, value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    if not s:
        return None
    return s[:max_len]


def _unlink_logo(rel: str | None) -> None:
    if not rel:
        return
    path = settings.storage_dir / rel
    try:
        if path.is_file():
            path.unlink()
    except OSError:
        pass



@router.post("/orgs", status_code=status.HTTP_201_CREATED)
async def create_organization(body: CreateOrgBody, user_id: str = Depends(get_current_user_id)) -> dict:
    import re

    def slugify(name: str) -> str:
        s = re.sub(r"[^\w\s-]", "", name.lower()).strip()
        s = re.sub(r"[-\s]+", "-", s)
        return (s[:48] or "org").strip("-")

    base_slug = slugify(body.name)
    slug = base_slug
    for _ in range(10):
        clash = await prisma.organization.find_unique(where={"slug": slug})
        if not clash:
            break
        slug = f"{base_slug}-{secrets.token_hex(3)}"

    org = await prisma.organization.create(
        data={
            "name": body.name,
            "slug": slug,
            "plan": "free",
            "trialEndsAt": default_trial_ends_at(),
            "memberships": {"create": {"userId": user_id, "role": MembershipRole.OWNER}},
        }
    )
    return {"id": org.id, "name": org.name, "slug": org.slug, "plan": org.plan}


@router.get("/orgs/{org_id}")
async def get_organization(org_id: str, _ctx: OrgContext = Depends(get_org_context)) -> dict:
    org = await prisma.organization.find_unique(where={"id": _ctx.organization_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "plan": org.plan,
        "suspended": org.suspended,
        "your_role": _ctx.membership.role.name
        if hasattr(_ctx.membership.role, "name")
        else str(_ctx.membership.role),
    }


@router.get("/orgs/{org_id}/members")
async def list_org_members(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    rows = await prisma.membership.find_many(
        where={"organizationId": ctx.organization_id},
        include={"user": True},
        order={"createdAt": "asc"},
    )
    return {
        "items": [
            {
                "membership_id": m.id,
                "user_id": m.userId,
                "email": m.user.email,
                "name": m.user.name,
                "role": m.role.name if hasattr(m.role, "name") else str(m.role),
                "whatsapp_phone": getattr(m, "whatsappPhone", None),
                "created_at": m.createdAt.isoformat(),
            }
            for m in rows
            if m.user is not None
        ]
    }


@router.patch("/orgs/{org_id}/members/{membership_id}")
async def update_org_member(
    org_id: str,
    membership_id: str,
    body: UpdateOrgMemberBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    m = await prisma.membership.find_first(
        where={"id": membership_id, "organizationId": ctx.organization_id},
        include={"user": True},
    )
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")

    data: dict = {}
    payload = body.model_dump(exclude_unset=True)
    if "whatsapp_phone" in payload:
        data["whatsappPhone"] = _normalize_member_phone(payload.get("whatsapp_phone"))
    if "role" in payload and body.role is not None:
        if body.role not in _INVITABLE_ROLES and body.role != MembershipRole.OWNER:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid role")
        # Don't demote/promote OWNER via this path — keep simple for phone edits.
        if m.role == MembershipRole.OWNER:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot change owner role here")
        if body.role == MembershipRole.OWNER:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot promote to owner here")
        data["role"] = body.role

    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No changes")

    updated = await prisma.membership.update(
        where={"id": m.id},
        data=data,
        include={"user": True},
    )
    return {
        "membership_id": updated.id,
        "user_id": updated.userId,
        "email": updated.user.email if updated.user else None,
        "name": updated.user.name if updated.user else None,
        "role": updated.role.name if hasattr(updated.role, "name") else str(updated.role),
        "whatsapp_phone": updated.whatsappPhone,
    }


@router.post("/orgs/{org_id}/members", status_code=status.HTTP_201_CREATED)
async def create_org_member(
    org_id: str,
    body: CreateOrgMemberBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    if body.role not in _INVITABLE_ROLES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Role must be SALES, TELECALLER, PRODUCTION, or VIEWER",
        )
    oid = ctx.organization_id
    org = await prisma.organization.find_unique(where={"id": oid})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    member_count = await prisma.membership.count(where={"organizationId": oid})
    seat_limit = max_seats_for_org(org=org)
    if member_count >= seat_limit:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=(
                f"Seat limit reached ({seat_limit} users on your plan). "
                f"Additional users are ₹{EXTRA_USER_PRICE_INR}/user/month — "
                "upgrade or ask a platform admin to add extra seats."
            ),
        )
    existing_user = await prisma.user.find_unique(where={"email": body.email})
    if existing_user:
        existing_m = await prisma.membership.find_first(
            where={"userId": existing_user.id, "organizationId": oid},
        )
        if existing_m:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="This user is already a member of this organization",
            )
        user = existing_user
    else:
        user = await prisma.user.create(
            data={
                "email": body.email,
                "passwordHash": hash_password(body.password),
                "name": body.name,
                "isSuperAdmin": False,
            },
        )
    m = await prisma.membership.create(
        data={
            "userId": user.id,
            "organizationId": oid,
            "role": body.role,
            "whatsappPhone": _normalize_member_phone(body.whatsapp_phone),
        },
    )
    return {
        "membership_id": m.id,
        "user_id": user.id,
        "email": user.email,
        "name": user.name,
        "role": m.role.name if hasattr(m.role, "name") else str(m.role),
        "whatsapp_phone": m.whatsappPhone,
    }


@router.get("/orgs/{org_id}/brand")
async def get_org_brand(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {
        "legal_name": org.brandLegalName,
        "address": org.brandAddress,
        "phone": org.brandPhone,
        "email": org.brandEmail,
        "website": org.brandWebsite,
        "tax_id": org.brandTaxId,
        "bank_name": getattr(org, "brandBankName", None),
        "bank_account_number": getattr(org, "brandBankAccountNumber", None),
        "bank_account_name": getattr(org, "brandBankAccountName", None),
        "bank_ifsc": getattr(org, "brandBankIfsc", None),
        "bank_swift": getattr(org, "brandBankSwift", None),
        "bank_ad_code": getattr(org, "brandBankAdCode", None),
        "bank_branch": getattr(org, "brandBankBranch", None),
        "has_logo": bool(org.brandLogoUrl),
        "has_signature": bool(org.brandSignatureUrl),
        "has_upi_qr": bool(org.brandUpiQrUrl),
        "updated_at": org.updatedAt.isoformat(),
    }


@router.patch("/orgs/{org_id}/brand")
async def update_org_brand(
    org_id: str,
    body: BrandUpdateBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    oid = ctx.organization_id
    dump = body.model_dump(exclude_unset=True)
    data: dict = {}
    if "legal_name" in dump:
        data["brandLegalName"] = _clean_opt(200, dump["legal_name"])
    if "address" in dump:
        data["brandAddress"] = _clean_opt(4000, dump["address"])
    if "phone" in dump:
        data["brandPhone"] = _clean_opt(80, dump["phone"])
    if "email" in dump:
        raw_email = dump["email"]
        data["brandEmail"] = str(raw_email).strip().lower() if raw_email else None
    if "website" in dump:
        data["brandWebsite"] = _clean_opt(300, dump["website"])
    if "tax_id" in dump:
        data["brandTaxId"] = _clean_opt(120, dump["tax_id"])
    if "bank_name" in dump:
        data["brandBankName"] = _clean_opt(120, dump["bank_name"])
    if "bank_account_number" in dump:
        data["brandBankAccountNumber"] = _clean_opt(80, dump["bank_account_number"])
    if "bank_account_name" in dump:
        data["brandBankAccountName"] = _clean_opt(160, dump["bank_account_name"])
    if "bank_ifsc" in dump:
        data["brandBankIfsc"] = _clean_opt(40, dump["bank_ifsc"])
    if "bank_swift" in dump:
        data["brandBankSwift"] = _clean_opt(40, dump["bank_swift"])
    if "bank_ad_code" in dump:
        data["brandBankAdCode"] = _clean_opt(40, dump["bank_ad_code"])
    if "bank_branch" in dump:
        data["brandBankBranch"] = _clean_opt(120, dump["bank_branch"])
    if data:
        await prisma.organization.update(where={"id": oid}, data=data)
    org = await prisma.organization.find_unique(where={"id": oid})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {
        "legal_name": org.brandLegalName,
        "address": org.brandAddress,
        "phone": org.brandPhone,
        "email": org.brandEmail,
        "website": org.brandWebsite,
        "tax_id": org.brandTaxId,
        "bank_name": getattr(org, "brandBankName", None),
        "bank_account_number": getattr(org, "brandBankAccountNumber", None),
        "bank_account_name": getattr(org, "brandBankAccountName", None),
        "bank_ifsc": getattr(org, "brandBankIfsc", None),
        "bank_swift": getattr(org, "brandBankSwift", None),
        "bank_ad_code": getattr(org, "brandBankAdCode", None),
        "bank_branch": getattr(org, "brandBankBranch", None),
        "has_logo": bool(org.brandLogoUrl),
        "has_signature": bool(org.brandSignatureUrl),
        "has_upi_qr": bool(org.brandUpiQrUrl),
        "updated_at": org.updatedAt.isoformat(),
    }


@router.post("/orgs/{org_id}/brand/logo")
async def upload_org_brand_logo(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
    file: UploadFile = File(...),
) -> dict:
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = _LOGO_CONTENT_TYPES.get(ctype)
    if not ext:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Logo must be PNG, JPEG, WebP, or GIF",
        )
    raw = await file.read()
    if len(raw) > _MAX_LOGO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Logo must be 2MB or smaller")

    oid = ctx.organization_id
    dest_dir = settings.storage_dir / oid / "brand"
    dest_dir.mkdir(parents=True, exist_ok=True)

    prev = await prisma.organization.find_unique(where={"id": oid})
    if prev and prev.brandLogoUrl:
        _unlink_logo(prev.brandLogoUrl)

    filename = f"logo{ext}"
    rel = f"{oid}/brand/{filename}"
    out = settings.storage_dir / rel
    out.write_bytes(raw)

    await prisma.organization.update(where={"id": oid}, data={"brandLogoUrl": rel})
    org = await prisma.organization.find_unique(where={"id": oid})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {
        "logo_url": rel,
        "has_logo": True,
        "updated_at": org.updatedAt.isoformat(),
    }


@router.delete("/orgs/{org_id}/brand/logo")
async def delete_org_brand_logo(org_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    oid = ctx.organization_id
    prev = await prisma.organization.find_unique(where={"id": oid})
    if prev and prev.brandLogoUrl:
        _unlink_logo(prev.brandLogoUrl)
        await prisma.organization.update(where={"id": oid}, data={"brandLogoUrl": None})
    org = await prisma.organization.find_unique(where={"id": oid})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {"has_logo": False, "updated_at": org.updatedAt.isoformat()}


@router.get("/orgs/{org_id}/brand/logo")
async def download_org_brand_logo(org_id: str, ctx: OrgContext = Depends(get_org_context)):
    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    if not org or not org.brandLogoUrl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No logo uploaded")
    fs_path = settings.storage_dir / org.brandLogoUrl
    if not fs_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Logo file missing")
    media = mimetypes.guess_type(fs_path.name)[0] or "application/octet-stream"
    return FileResponse(fs_path, media_type=media)


@router.post("/orgs/{org_id}/brand/signature")
async def upload_org_brand_signature(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
    file: UploadFile = File(...),
) -> dict:
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = _SIGNATURE_CONTENT_TYPES.get(ctype)
    if not ext:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Signature must be PNG, JPEG, or WebP",
        )
    raw = await file.read()
    if len(raw) > _MAX_SIGNATURE_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Signature must be 500KB or smaller")

    oid = ctx.organization_id
    dest_dir = settings.storage_dir / oid / "brand"
    dest_dir.mkdir(parents=True, exist_ok=True)

    prev = await prisma.organization.find_unique(where={"id": oid})
    if prev and prev.brandSignatureUrl:
        _unlink_logo(prev.brandSignatureUrl)

    filename = f"signature{ext}"
    rel = f"{oid}/brand/{filename}"
    out = settings.storage_dir / rel
    out.write_bytes(raw)

    await prisma.organization.update(where={"id": oid}, data={"brandSignatureUrl": rel})
    org = await prisma.organization.find_unique(where={"id": oid})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {
        "signature_url": rel,
        "has_signature": True,
        "updated_at": org.updatedAt.isoformat(),
    }


@router.get("/orgs/{org_id}/brand/signature")
async def download_org_brand_signature(org_id: str, ctx: OrgContext = Depends(get_org_context)):
    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    if not org or not org.brandSignatureUrl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No signature uploaded")
    fs_path = settings.storage_dir / org.brandSignatureUrl
    if not fs_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Signature file missing")
    media = mimetypes.guess_type(fs_path.name)[0] or "application/octet-stream"
    return FileResponse(fs_path, media_type=media)


@router.delete("/orgs/{org_id}/brand/signature")
async def delete_org_brand_signature(org_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    oid = ctx.organization_id
    prev = await prisma.organization.find_unique(where={"id": oid})
    if prev and prev.brandSignatureUrl:
        _unlink_logo(prev.brandSignatureUrl)
        await prisma.organization.update(where={"id": oid}, data={"brandSignatureUrl": None})
    org = await prisma.organization.find_unique(where={"id": oid})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {"has_signature": False, "updated_at": org.updatedAt.isoformat()}


@router.post("/orgs/{org_id}/brand/upi-qr")
async def upload_org_brand_upi_qr(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
    file: UploadFile = File(...),
) -> dict:
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = _QR_CONTENT_TYPES.get(ctype)
    if not ext:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="UPI QR code must be PNG, JPEG, or WebP",
        )
    raw = await file.read()
    if len(raw) > _MAX_QR_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="UPI QR code must be 200KB or smaller")

    oid = ctx.organization_id
    dest_dir = settings.storage_dir / oid / "brand"
    dest_dir.mkdir(parents=True, exist_ok=True)

    prev = await prisma.organization.find_unique(where={"id": oid})
    if prev and prev.brandUpiQrUrl:
        _unlink_logo(prev.brandUpiQrUrl)

    filename = f"upi-qr{ext}"
    rel = f"{oid}/brand/{filename}"
    out = settings.storage_dir / rel
    out.write_bytes(raw)

    await prisma.organization.update(where={"id": oid}, data={"brandUpiQrUrl": rel})
    org = await prisma.organization.find_unique(where={"id": oid})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {
        "upi_qr_url": rel,
        "has_upi_qr": True,
        "updated_at": org.updatedAt.isoformat(),
    }


@router.get("/orgs/{org_id}/brand/upi-qr")
async def download_org_brand_upi_qr(org_id: str, ctx: OrgContext = Depends(get_org_context)):
    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    if not org or not org.brandUpiQrUrl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No UPI QR code uploaded")
    fs_path = settings.storage_dir / org.brandUpiQrUrl
    if not fs_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="UPI QR code file missing")
    media = mimetypes.guess_type(fs_path.name)[0] or "application/octet-stream"
    return FileResponse(fs_path, media_type=media)


@router.delete("/orgs/{org_id}/brand/upi-qr")
async def delete_org_brand_upi_qr(org_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    oid = ctx.organization_id
    prev = await prisma.organization.find_unique(where={"id": oid})
    if prev and prev.brandUpiQrUrl:
        _unlink_logo(prev.brandUpiQrUrl)
        await prisma.organization.update(where={"id": oid}, data={"brandUpiQrUrl": None})
    org = await prisma.organization.find_unique(where={"id": oid})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {"has_upi_qr": False, "updated_at": org.updatedAt.isoformat()}
