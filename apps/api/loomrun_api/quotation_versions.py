"""Quotation / invoice version snapshots.

Historical versions are immutable commercial snapshots. The parent Quotation row
always holds the *current* editable document.
"""

from __future__ import annotations

from typing import Any

from prisma import fields

from loomrun_api.document_totals import money_float, to_decimal
from loomrun_api.prisma_client import prisma


def _enum_name(value: Any) -> str:
    return value.name if hasattr(value, "name") else str(value)


def is_commercially_issued(q) -> bool:
    """True once the document has left pure draft (sent, accepted, or invoiced)."""
    status = _enum_name(getattr(q, "status", None))
    if status in ("SENT", "ACCEPTED", "INVOICED"):
        return True
    if getattr(q, "sentAt", None) is not None:
        return True
    if getattr(q, "invoiceNumber", None) and getattr(q, "invoicedAt", None):
        return True
    return False


def lead_snapshot_from(lead) -> dict[str, Any] | None:
    if lead is None:
        return None
    return {
        "title": getattr(lead, "title", None),
        "company": getattr(lead, "company", None),
        "phone": getattr(lead, "phone", None),
        "email": getattr(lead, "email", None),
    }


def lines_snapshot_from(q_or_lines) -> list[dict[str, Any]]:
    lines = q_or_lines
    if hasattr(q_or_lines, "lines"):
        lines = getattr(q_or_lines, "lines", None) or []
    rows: list[dict[str, Any]] = []
    for i, ln in enumerate(lines):
        if isinstance(ln, dict):
            qty = to_decimal(ln.get("quantity"))
            price = to_decimal(ln.get("unit_price", ln.get("unitPrice")))
            rows.append(
                {
                    "description": str(ln.get("description") or ""),
                    "quantity": float(qty),
                    "unit_price": float(price),
                    "line_total": float(
                        to_decimal(
                            ln.get("line_total", ln.get("lineTotal"), default=qty * price)
                        )
                    ),
                    "sort_order": int(ln.get("sort_order", ln.get("sortOrder", i)) or i),
                }
            )
        else:
            rows.append(
                {
                    "description": ln.description,
                    "quantity": float(ln.quantity),
                    "unit_price": float(ln.unitPrice),
                    "line_total": float(ln.lineTotal),
                    "sort_order": int(getattr(ln, "sortOrder", i) or i),
                }
            )
    return rows


def serialize_version(v, *, is_current: bool = False) -> dict[str, Any]:
    return {
        "id": v.id,
        "quotation_id": v.quotationId,
        "version_number": v.versionNumber,
        "title": v.title,
        "status": _enum_name(v.status),
        "invoice_number": v.invoiceNumber,
        "subtotal": money_float(v.subtotal),
        "tax_enabled": bool(v.taxEnabled),
        "tax_rate": money_float(v.taxRate) if v.taxRate is not None else None,
        "tax": money_float(v.tax),
        "total": money_float(v.total),
        "lines": v.linesJson if isinstance(v.linesJson, list) else (v.linesJson or []),
        "lead_snapshot": v.leadSnapshot,
        "note": v.note,
        "created_at": v.createdAt.isoformat() if v.createdAt else None,
        "created_by_id": v.createdById,
        "is_current": is_current,
    }


def _prisma_json(value: Any) -> fields.Json:
    """Wrap list/dict for prisma-client-py Json columns."""
    if value is None:
        return fields.Json([])
    return fields.Json(value)


async def ensure_version_snapshot(
    *,
    quotation,
    user_id: str | None = None,
    note: str | None = None,
) -> Any:
    """Persist an immutable snapshot for the quotation's current version number.

    Idempotent: if a snapshot for this version already exists, return it.
    """
    existing = await prisma.quotationversion.find_first(
        where={"quotationId": quotation.id, "versionNumber": quotation.version},
    )
    if existing:
        return existing

    tax_enabled = bool(getattr(quotation, "taxEnabled", False))
    tax_rate = getattr(quotation, "taxRate", None)
    lead_snap = lead_snapshot_from(getattr(quotation, "lead", None))
    data: dict[str, Any] = {
        "organizationId": quotation.organizationId,
        "quotationId": quotation.id,
        "versionNumber": quotation.version,
        "title": quotation.title,
        "status": quotation.status,
        "invoiceNumber": quotation.invoiceNumber,
        "subtotal": quotation.subtotal,
        "taxEnabled": tax_enabled,
        "taxRate": tax_rate,
        "tax": quotation.tax,
        "total": quotation.total,
        "linesJson": _prisma_json(lines_snapshot_from(quotation)),
        "note": note,
    }
    if lead_snap is not None:
        data["leadSnapshot"] = _prisma_json(lead_snap)
    if user_id:
        data["createdById"] = user_id
    return await prisma.quotationversion.create(data=data)


async def bump_version_for_revision(
    *,
    quotation,
    user_id: str | None = None,
    note: str | None = "Revised",
) -> int:
    """Snapshot current commercial state, then return the next version number."""
    await ensure_version_snapshot(
        quotation=quotation,
        user_id=user_id,
        note=note or "Issued version",
    )
    return int(quotation.version) + 1


async def list_versions(*, organization_id: str, quotation_id: str) -> list[dict[str, Any]]:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": organization_id},
        include={"lines": True},
    )
    if not q:
        return []
    rows = await prisma.quotationversion.find_many(
        where={"quotationId": quotation_id, "organizationId": organization_id},
        order={"versionNumber": "desc"},
    )
    # Ensure current live version appears even if snapshot not yet written
    numbers = {r.versionNumber for r in rows}
    items = [serialize_version(r, is_current=(r.versionNumber == q.version)) for r in rows]
    if q.version not in numbers:
        items.insert(
            0,
            {
                "id": None,
                "quotation_id": q.id,
                "version_number": q.version,
                "title": q.title,
                "status": _enum_name(q.status),
                "invoice_number": q.invoiceNumber,
                "subtotal": money_float(q.subtotal),
                "tax_enabled": bool(getattr(q, "taxEnabled", False)),
                "tax_rate": money_float(q.taxRate) if getattr(q, "taxRate", None) is not None else None,
                "tax": money_float(q.tax),
                "total": money_float(q.total),
                "lines": lines_snapshot_from(q),
                "lead_snapshot": lead_snapshot_from(getattr(q, "lead", None)),
                "note": "Current",
                "created_at": q.updatedAt.isoformat() if q.updatedAt else None,
                "created_by_id": None,
                "is_current": True,
            },
        )
    return items
