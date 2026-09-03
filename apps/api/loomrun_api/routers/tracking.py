"""Public customer order tracking (no auth)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from loomrun_api.config import settings
from loomrun_api.prisma_client import prisma
from loomrun_api.services.production import (
    CUSTOMER_MILESTONES,
    customer_milestone_for_stage,
    days_until,
    resolve_order_status,
)

router = APIRouter()


def _enum_name(value) -> str:
    return value.name if hasattr(value, "name") else str(value)


def _iso(dt) -> str | None:
    if dt is None:
        return None
    return dt.isoformat() if hasattr(dt, "isoformat") else str(dt)


@router.get("/track/{token}")
async def get_public_tracking(token: str) -> dict:
    tok = (token or "").strip()
    if not tok or len(tok) > 64:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tracking link not found")

    row = await prisma.productionorder.find_first(
        where={"trackingToken": tok},
        include={
            "organization": True,
            "lead": True,
        },
    )
    if not row or not row.trackingEnabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tracking link not found")

    acts = await prisma.productionactivity.find_many(
        where={"productionOrderId": row.id},
        order={"createdAt": "desc"},
        take=40,
    )

    stage = _enum_name(row.stage)
    current = customer_milestone_for_stage(stage)
    milestones: list[dict] = []
    if current == "DELIVERED":
        milestones = [
            {"key": k, "label": lab, "state": "done"} for k, lab in CUSTOMER_MILESTONES
        ]
    else:
        reached = True
        for key, label in CUSTOMER_MILESTONES:
            if key == current:
                milestones.append({"key": key, "label": label, "state": "current"})
                reached = False
            elif reached:
                milestones.append({"key": key, "label": label, "state": "done"})
            else:
                milestones.append({"key": key, "label": label, "state": "upcoming"})

    updates: list[dict] = []
    for act in acts:
        meta = act.metadata if isinstance(act.metadata, dict) else {}
        customer_note = meta.get("customer_note") if meta else None
        act_type = _enum_name(act.type)
        if customer_note:
            updates.append({"body": customer_note, "created_at": _iso(act.createdAt)})
        elif act_type == "STAGE_CHANGED":
            to_stage = (meta or {}).get("to_stage")
            if to_stage:
                mile = customer_milestone_for_stage(str(to_stage))
                label = dict(CUSTOMER_MILESTONES).get(mile, mile)
                updates.append(
                    {
                        "body": f"Status updated: {label}",
                        "created_at": _iso(act.createdAt),
                    }
                )
        elif act_type == "SHIPMENT_UPDATED" and row.courierName:
            updates.append(
                {
                    "body": f"Shipped via {row.courierName}",
                    "created_at": _iso(act.createdAt),
                }
            )

    deduped: list[dict] = []
    for u in updates:
        if deduped and deduped[-1]["body"] == u["body"]:
            continue
        deduped.append(u)

    org = row.organization
    raw_brand = (
        (org.brandLegalName if org else None)
        or (org.name if org else None)
        or ""
    ).strip()
    # Never show the platform operator (Exora) on customer-facing tracking.
    if not raw_brand or "exora" in raw_brand.lower():
        brand_name = "Loomrun"
        has_logo = False
    else:
        brand_name = raw_brand
        has_logo = bool(org and org.brandLogoUrl)

    return {
        "order_number": row.orderNumber,
        "customer_name": row.lead.title if row.lead else None,
        "current_milestone": current,
        "current_milestone_label": dict(CUSTOMER_MILESTONES).get(current, current),
        "order_status": resolve_order_status(row),
        "milestones": milestones,
        "expected_dispatch_at": _iso(row.expectedDispatchAt),
        "days_until_dispatch": days_until(row.expectedDispatchAt),
        "actual_dispatch_at": _iso(row.actualDispatchAt),
        "courier_name": row.courierName
        if stage in ("SHIPPED", "DELIVERED", "READY_DISPATCH")
        else None,
        "courier_tracking_no": row.courierTrackingNo
        if stage in ("SHIPPED", "DELIVERED")
        else None,
        "last_updated_at": _iso(row.updatedAt),
        "updates": deduped[:15],
        "brand": {
            "name": brand_name,
            "has_logo": has_logo,
            "logo_url": f"/v1/track/{tok}/logo" if has_logo else None,
        },
    }


@router.get("/track/{token}/logo")
async def get_public_tracking_logo(token: str):
    tok = (token or "").strip()
    row = await prisma.productionorder.find_first(
        where={"trackingToken": tok, "trackingEnabled": True},
        include={"organization": True},
    )
    if not row or not row.organization or not row.organization.brandLogoUrl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Logo not found")
    fs_path = settings.storage_dir / row.organization.brandLogoUrl
    if not fs_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Logo not found")
    media = "image/png"
    suffix = Path(fs_path).suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        media = "image/jpeg"
    elif suffix == ".webp":
        media = "image/webp"
    elif suffix == ".svg":
        media = "image/svg+xml"
    return FileResponse(fs_path, media_type=media)
