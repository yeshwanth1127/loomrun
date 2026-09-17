"""Production design assets and 2D garment mockups."""

from __future__ import annotations

import mimetypes
import re
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api import mockup_compose
from loomrun_api.design_views import (
    VIEW_TYPES,
    normalize_kind,
    normalize_view_type,
)
from loomrun_api.garment_defaults import (
    default_views_for_product,
    list_product_types,
    normalize_hex_color,
    normalize_product_type,
)
from loomrun_api.garment_recolor import colored_template_png
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.production_activity import log_production_activity
from prisma.enums import ProductionActivityType

router = APIRouter()

_OPS_ROLES = require_roles("OWNER", "PRODUCTION", "PRODUCTION_MANAGER")
_READ_ROLES = require_roles("OWNER", "PRODUCTION", "PRODUCTION_MANAGER", "SALES")

_DESIGN_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}
_MAX_DESIGN_BYTES = 15 * 1024 * 1024

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class MockupCreateBody(BaseModel):
    design_asset_id: str
    garment_type: str = Field(min_length=2, max_length=40)
    view: str = Field(min_length=2, max_length=40)
    placement: dict[str, float] = Field(default_factory=dict)
    engine: str = "TEMPLATE_2D"
    garment_color: str | None = Field(default=None, max_length=16)


class MockupWhatsAppBody(BaseModel):
    caption: str | None = Field(default=None, max_length=1000)


class DesignMetaBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    view_type: str | None = Field(default=None, max_length=40)
    kind: str | None = Field(default=None, max_length=20)


def _unlink(rel: str | None) -> None:
    if not rel:
        return
    path = settings.storage_dir / rel
    try:
        if path.is_file():
            path.unlink()
    except OSError:
        pass


def _safe_filename(name: str | None) -> str:
    base = (name or "design").strip() or "design"
    base = base.replace("\\", "/").split("/")[-1]
    base = _SAFE_NAME.sub("_", base)[:120]
    return base or "design"


async def _get_order(org_id: str, order_id: str):
    row = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": org_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    return row


def _serialize_mockup(m) -> dict[str, Any]:
    placement = m.placement
    if hasattr(placement, "dict"):
        placement = placement.dict()  # type: ignore[attr-defined]
    return {
        "id": m.id,
        "design_asset_id": m.designAssetId,
        "garment_type": m.garmentType,
        "view": m.view,
        "placement": placement,
        "engine": m.engine,
        "status": m.status,
        "has_file": bool(m.storagePath),
        "last_error": m.lastError,
        "created_at": m.createdAt.isoformat(),
        "updated_at": m.updatedAt.isoformat(),
    }


def _serialize_design(d, mockups: list | None = None) -> dict[str, Any]:
    return {
        "id": d.id,
        "file_name": d.fileName,
        "mime_type": d.mimeType,
        "byte_size": d.byteSize,
        "kind": getattr(d, "kind", None) or "SOURCE",
        "view_type": getattr(d, "viewType", None),
        "title": getattr(d, "title", None),
        "created_at": d.createdAt.isoformat(),
        "updated_at": d.updatedAt.isoformat(),
        "mockups": [_serialize_mockup(m) for m in (mockups if mockups is not None else (d.mockups or []))],
    }


@router.get("/orgs/{org_id}/production/{order_id}/mockup-templates")
async def list_mockup_templates(
    org_id: str,
    order_id: str,
    ctx: OrgContext = Depends(_READ_ROLES),
) -> dict:
    await _get_order(ctx.organization_id, order_id)
    items = []
    for t in mockup_compose.list_templates():
        tw = max(1, int(t["width"]))
        th = max(1, int(t["height"]))
        pa = t["print_area"]
        # FE placement canvas expects 0–1 fractions; catalog stores pixels.
        items.append(
            {
                "key": t["key"],
                "garment_type": t["garment_type"],
                "view": t["view"],
                "label": t["label"],
                "width": tw,
                "height": th,
                "print_area": {
                    "x": float(pa["x"]) / tw,
                    "y": float(pa["y"]) / th,
                    "w": float(pa["w"]) / tw,
                    "h": float(pa["h"]) / th,
                },
            }
        )
    return {"items": items}


@router.get("/orgs/{org_id}/production/{order_id}/mockup-templates/{key}/image")
async def get_mockup_template_image(
    org_id: str,
    order_id: str,
    key: str,
    ctx: OrgContext = Depends(_READ_ROLES),
):
    await _get_order(ctx.organization_id, order_id)
    tmpl = mockup_compose.get_template_by_key(key)
    if not tmpl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Template not found")
    try:
        path = mockup_compose.template_image_path(tmpl)
    except FileNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Template image missing") from None
    return FileResponse(path, media_type="image/png")


@router.get("/orgs/{org_id}/production/{order_id}/designs")
async def list_designs(
    org_id: str,
    order_id: str,
    ctx: OrgContext = Depends(_READ_ROLES),
) -> dict:
    await _get_order(ctx.organization_id, order_id)
    rows = await prisma.productiondesignasset.find_many(
        where={"organizationId": ctx.organization_id, "productionOrderId": order_id},
        include={"mockups": True},
        order={"createdAt": "desc"},
    )
    return {"items": [_serialize_design(r) for r in rows]}


@router.get("/orgs/{org_id}/production/{order_id}/design-view-types")
async def list_design_view_types(
    org_id: str,
    order_id: str,
    ctx: OrgContext = Depends(_READ_ROLES),
) -> dict:
    await _get_order(ctx.organization_id, order_id)
    return {"items": [{"value": k, "label": lab} for k, lab in VIEW_TYPES]}


@router.get("/orgs/{org_id}/production/{order_id}/default-garments")
async def list_default_garments(
    org_id: str,
    order_id: str,
    ctx: OrgContext = Depends(_READ_ROLES),
) -> dict:
    """Product types + available default Front/Back template keys."""
    await _get_order(ctx.organization_id, order_id)
    items = []
    for pt in list_product_types():
        views = default_views_for_product(pt["value"])
        items.append({**pt, "views": views})
    return {"items": items}


@router.get("/orgs/{org_id}/production/{order_id}/default-mockups/{template_key}")
async def get_default_mockup_image(
    org_id: str,
    order_id: str,
    template_key: str,
    color: str = "#FFFFFF",
    ctx: OrgContext = Depends(_READ_ROLES),
):
    """Blank garment template tinted to `color` (no AI — recolors static PNG)."""
    await _get_order(ctx.organization_id, order_id)
    try:
        hex_color = normalize_hex_color(color)
        png = colored_template_png(template_key, hex_color)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    from fastapi.responses import Response

    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post("/orgs/{org_id}/production/{order_id}/designs", status_code=status.HTTP_201_CREATED)
async def upload_design(
    org_id: str,
    order_id: str,
    ctx: OrgContext = Depends(_OPS_ROLES),
    file: UploadFile = File(...),
    kind: str = Form("SOURCE"),
    view_type: str | None = Form(None),
    title: str | None = Form(None),
) -> dict:
    order = await _get_order(ctx.organization_id, order_id)
    try:
        asset_kind = normalize_kind(kind)
        vt = normalize_view_type(view_type)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = _DESIGN_CONTENT_TYPES.get(ctype)
    if not ext:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Design must be PNG, JPEG, WebP, or PDF",
        )
    if asset_kind == "DESIGN" and not ctype.startswith("image/"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Design / mockup views must be an image (PNG, JPEG, or WebP)",
        )
    if asset_kind == "DESIGN" and not vt:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Design / mockup uploads require a view type",
        )
    if asset_kind == "SOURCE":
        vt = None

    raw = await file.read()
    if len(raw) > _MAX_DESIGN_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Design must be 15MB or smaller")
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty file")

    oid = ctx.organization_id
    display_title = (title or "").strip()[:200] or None
    asset = await prisma.productiondesignasset.create(
        data={
            "organizationId": oid,
            "productionOrderId": order_id,
            "fileName": _safe_filename(file.filename),
            "storagePath": "pending",
            "mimeType": ctype,
            "byteSize": len(raw),
            "kind": asset_kind,
            "viewType": vt,
            "title": display_title,
        }
    )
    rel = f"{oid}/production/{order_id}/designs/{asset.id}{ext}"
    dest = settings.storage_dir / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    asset = await prisma.productiondesignasset.update(
        where={"id": asset.id},
        data={"storagePath": rel},
        include={"mockups": True},
    )
    label = "Customer file" if asset_kind == "SOURCE" else "Design view"
    await log_production_activity(
        organization_id=oid,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.NOTE_ADDED,
        body=f"{label} uploaded: {asset.fileName}",
        metadata={
            "design_asset_id": asset.id,
            "file_name": asset.fileName,
            "kind": asset_kind,
            "view_type": vt,
        },
    )
    return _serialize_design(asset)


@router.get("/orgs/{org_id}/production/{order_id}/designs/{design_id}/file")
async def get_design_file(
    org_id: str,
    order_id: str,
    design_id: str,
    ctx: OrgContext = Depends(_READ_ROLES),
):
    await _get_order(ctx.organization_id, order_id)
    row = await prisma.productiondesignasset.find_first(
        where={
            "id": design_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        },
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Design not found")
    path = settings.storage_dir / row.storagePath
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Design file missing")
    media = row.mimeType or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media, filename=row.fileName)


@router.post("/orgs/{org_id}/production/{order_id}/designs/{design_id}/replace")
async def replace_design_file(
    org_id: str,
    order_id: str,
    design_id: str,
    ctx: OrgContext = Depends(_OPS_ROLES),
    file: UploadFile = File(...),
) -> dict:
    """Replace the underlying file while preserving kind / view type / title."""
    order = await _get_order(ctx.organization_id, order_id)
    row = await prisma.productiondesignasset.find_first(
        where={
            "id": design_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        },
        include={"mockups": True},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Design not found")

    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = _DESIGN_CONTENT_TYPES.get(ctype)
    if not ext:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="File must be PNG, JPEG, WebP, or PDF",
        )
    kind = getattr(row, "kind", None) or "SOURCE"
    if kind == "DESIGN" and not ctype.startswith("image/"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Design views must remain images (PNG, JPEG, or WebP)",
        )
    raw = await file.read()
    if len(raw) > _MAX_DESIGN_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="File must be 15MB or smaller")
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty file")

    _unlink(row.storagePath)
    rel = f"{ctx.organization_id}/production/{order_id}/designs/{row.id}{ext}"
    dest = settings.storage_dir / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    updated = await prisma.productiondesignasset.update(
        where={"id": row.id},
        data={
            "storagePath": rel,
            "mimeType": ctype,
            "byteSize": len(raw),
            "fileName": _safe_filename(file.filename) or row.fileName,
        },
        include={"mockups": True},
    )
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.NOTE_ADDED,
        body=f"Design file replaced: {updated.fileName}",
        metadata={"design_asset_id": updated.id},
    )
    return _serialize_design(updated)


@router.patch("/orgs/{org_id}/production/{order_id}/designs/{design_id}")
async def update_design_meta(
    org_id: str,
    order_id: str,
    design_id: str,
    body: DesignMetaBody,
    ctx: OrgContext = Depends(_OPS_ROLES),
) -> dict:
    await _get_order(ctx.organization_id, order_id)
    row = await prisma.productiondesignasset.find_first(
        where={
            "id": design_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        },
        include={"mockups": True},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Design not found")

    data: dict = {}
    payload = body.model_dump(exclude_unset=True)
    try:
        if "kind" in payload and payload["kind"] is not None:
            data["kind"] = normalize_kind(payload["kind"])
        if "view_type" in payload:
            data["viewType"] = normalize_view_type(payload["view_type"])
        if "title" in payload:
            title = payload["title"]
            data["title"] = (title or "").strip()[:200] or None
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    kind = data.get("kind") or (getattr(row, "kind", None) or "SOURCE")
    vt = data["viewType"] if "viewType" in data else getattr(row, "viewType", None)
    if kind == "SOURCE":
        data["viewType"] = None
    elif kind == "DESIGN" and not vt:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Design views require a view type",
        )

    if not data:
        return _serialize_design(row)
    updated = await prisma.productiondesignasset.update(
        where={"id": row.id},
        data=data,
        include={"mockups": True},
    )
    return _serialize_design(updated)


@router.delete("/orgs/{org_id}/production/{order_id}/designs/{design_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_design(
    org_id: str,
    order_id: str,
    design_id: str,
    ctx: OrgContext = Depends(_OPS_ROLES),
) -> None:
    await _get_order(ctx.organization_id, order_id)
    row = await prisma.productiondesignasset.find_first(
        where={
            "id": design_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        },
        include={"mockups": True},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Design not found")
    for m in row.mockups or []:
        _unlink(m.storagePath)
    _unlink(row.storagePath)
    await prisma.productiondesignasset.delete(where={"id": design_id})


@router.post("/orgs/{org_id}/production/{order_id}/mockups", status_code=status.HTTP_201_CREATED)
async def create_mockup(
    org_id: str,
    order_id: str,
    body: MockupCreateBody,
    ctx: OrgContext = Depends(_OPS_ROLES),
) -> dict:
    order = await _get_order(ctx.organization_id, order_id)
    engine = (body.engine or "TEMPLATE_2D").strip().upper()
    if engine not in mockup_compose.SUPPORTED_ENGINES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Only TEMPLATE_2D mockups are supported right now",
        )

    garment = body.garment_type.strip().upper()
    view = body.view.strip().upper()
    tmpl = mockup_compose.get_template(garment, view)
    if not tmpl:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown garment type or view")

    design = await prisma.productiondesignasset.find_first(
        where={
            "id": body.design_asset_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        },
    )
    if not design:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Design not found")
    if not (design.mimeType or "").startswith("image/"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Mockups require an image design (PNG/JPEG/WebP). PDFs are stored as customer files only.",
        )

    placement = mockup_compose.normalize_placement(body.placement)
    design_path = settings.storage_dir / design.storagePath
    if not design_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Design file missing")

    color_raw = body.garment_color or getattr(order, "designGarmentColor", None) or "#FFFFFF"
    try:
        garment_color = normalize_hex_color(color_raw)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    mockup = await prisma.productionmockup.create(
        data={
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
            "designAssetId": design.id,
            "garmentType": garment,
            "view": view,
            "placement": json_meta(placement),
            "engine": engine,
            "status": "READY",
            "storagePath": None,
        }
    )

    rel = f"{ctx.organization_id}/production/{order_id}/mockups/{mockup.id}.png"
    out_path = settings.storage_dir / rel
    try:
        mockup_compose.compose_mockup(
            template=tmpl,
            design_path=design_path,
            placement=placement,
            out_path=out_path,
            garment_color=garment_color,
        )
    except Exception as exc:  # noqa: BLE001 — surface compose failures to client
        await prisma.productionmockup.update(
            where={"id": mockup.id},
            data={"status": "FAILED", "lastError": str(exc)[:2000]},
        )
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Mockup generation failed: {exc}",
        ) from exc

    mockup = await prisma.productionmockup.update(
        where={"id": mockup.id},
        data={"storagePath": rel, "status": "READY", "lastError": None},
    )
    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.NOTE_ADDED,
        body=f"Mockup generated: {garment} {view}",
        metadata={
            "mockup_id": mockup.id,
            "design_asset_id": design.id,
            "garment_type": garment,
            "view": view,
            "engine": engine,
        },
    )
    return _serialize_mockup(mockup)


@router.get("/orgs/{org_id}/production/{order_id}/mockups/{mockup_id}/file")
async def get_mockup_file(
    org_id: str,
    order_id: str,
    mockup_id: str,
    ctx: OrgContext = Depends(_READ_ROLES),
):
    await _get_order(ctx.organization_id, order_id)
    row = await prisma.productionmockup.find_first(
        where={
            "id": mockup_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        },
    )
    if not row or not row.storagePath:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Mockup not found")
    path = settings.storage_dir / row.storagePath
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Mockup file missing")
    return FileResponse(path, media_type="image/png", filename=f"mockup-{row.id}.png")


@router.delete("/orgs/{org_id}/production/{order_id}/mockups/{mockup_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_mockup(
    org_id: str,
    order_id: str,
    mockup_id: str,
    ctx: OrgContext = Depends(_OPS_ROLES),
) -> None:
    await _get_order(ctx.organization_id, order_id)
    row = await prisma.productionmockup.find_first(
        where={
            "id": mockup_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        },
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Mockup not found")
    _unlink(row.storagePath)
    await prisma.productionmockup.delete(where={"id": mockup_id})


@router.post("/orgs/{org_id}/production/{order_id}/mockups/{mockup_id}/send-whatsapp")
async def send_mockup_whatsapp(
    org_id: str,
    order_id: str,
    mockup_id: str,
    body: MockupWhatsAppBody | None = None,
    ctx: OrgContext = Depends(_OPS_ROLES),
) -> dict:
    """Send a generated mockup image to the order's lead via WhatsApp (Baileys)."""
    from loomrun_api import baileys_client

    order = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": ctx.organization_id},
        include={"lead": True},
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Production order not found")
    phone = (order.lead.phone if order.lead else None) or ""
    if not phone.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This lead has no phone number",
        )

    mockup = await prisma.productionmockup.find_first(
        where={
            "id": mockup_id,
            "organizationId": ctx.organization_id,
            "productionOrderId": order_id,
        },
    )
    if not mockup or not mockup.storagePath:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Mockup not found")
    path = settings.storage_dir / mockup.storagePath
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Mockup file missing")

    if not await baileys_client.is_connected(ctx.organization_id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="WhatsApp is not connected. Connect it under Settings → WhatsApp first.",
        )

    caption = (body.caption if body else None) or (
        f"Mockup preview for order {order.orderNumber} "
        f"({mockup.garmentType.replace('_', ' ').title()} — {mockup.view.title()})"
    )
    result = await baileys_client.send_image(
        ctx.organization_id,
        phone,
        str(path.resolve()),
        mimetype="image/png",
        caption=caption,
    )
    if not result:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=result.error or "Failed to send mockup on WhatsApp",
        )

    await log_production_activity(
        organization_id=ctx.organization_id,
        production_order_id=order_id,
        lead_id=order.leadId,
        user_id=ctx.membership.userId,
        activity_type=ProductionActivityType.NOTE_ADDED,
        body=f"Mockup sent on WhatsApp ({mockup.garmentType} {mockup.view})",
        metadata={"mockup_id": mockup.id, "channel": "whatsapp"},
    )
    return {"sent": True, "phone": phone}
