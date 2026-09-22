"""Quotation / invoice services shared by HTTP routers and the AI agent."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import HTTPException, status
from prisma.enums import QuotationStatus
from prisma.errors import UniqueViolationError

from loomrun_api.config import settings
from loomrun_api.document_template_service import layout_from_json, resolve_template_for_render
from loomrun_api.document_totals import compute_document_totals, money_float, to_decimal
from loomrun_api.pdf import brand_pdf_kwargs_from_org, render_quotation_pdf
from loomrun_api.pdf.renderer import render_preview_pdf
from loomrun_api import org_events
from loomrun_api.prisma_client import prisma
from loomrun_api.quotation_versions import (
    bump_version_for_revision,
    ensure_version_snapshot,
    is_commercially_issued,
    list_versions,
    serialize_version,
)
from loomrun_api.services.leads import apply_created_updated_filters, resolve_lead
from loomrun_api.quotation_delivery import advance_lead_to_quotation, deliver_quotation

logger = logging.getLogger(__name__)

LineIn = dict[str, Any]  # description, quantity, unit_price


def _parse_sequence(value: str, prefix: str) -> int | None:
    if not value.startswith(prefix):
        return None
    try:
        return int(value[len(prefix) :])
    except ValueError:
        return None


async def next_sequential_number(org_id: str, prefix: str, *, invoice: bool = False) -> str:
    if invoice:
        rows = await prisma.quotation.find_many(
            where={"organizationId": org_id, "invoiceNumber": {"startswith": prefix}},
        )
        values = [r.invoiceNumber for r in rows if r.invoiceNumber]
    else:
        rows = await prisma.quotation.find_many(
            where={"organizationId": org_id, "number": {"startswith": prefix}},
        )
        values = [r.number for r in rows]

    max_seq = 0
    for value in values:
        seq = _parse_sequence(value, prefix)
        if seq is not None:
            max_seq = max(max_seq, seq)
    return f"{prefix}{(max_seq + 1):05d}"


async def next_quotation_number(org_id: str) -> str:
    year = datetime.now(timezone.utc).year
    return await next_sequential_number(org_id, f"Q-{year}-", invoice=False)


async def next_invoice_number(org_id: str) -> str:
    year = datetime.now(timezone.utc).year
    return await next_sequential_number(org_id, f"INV-{year}-", invoice=True)


def serialize_quotation(q, *, include_versions: bool = False) -> dict[str, Any]:
    source = getattr(q, "sourceQuotation", None)
    tax_enabled = bool(getattr(q, "taxEnabled", False))
    tax_rate = getattr(q, "taxRate", None)
    derived = getattr(q, "derivedInvoices", None) or []
    linked_invoices = [
        {
            "id": inv.id,
            "invoice_number": inv.invoiceNumber,
            "number": inv.number,
            "total": money_float(inv.total),
            "status": inv.status.name if hasattr(inv.status, "name") else str(inv.status),
            "created_at": inv.createdAt.isoformat() if getattr(inv, "createdAt", None) else None,
        }
        for inv in derived
        if getattr(inv, "invoiceNumber", None)
    ]
    # Prefer newest linked invoice for quick "Open invoice" navigation.
    linked_invoices.sort(key=lambda row: row.get("created_at") or "", reverse=True)
    primary_invoice = linked_invoices[0] if linked_invoices else None
    data = {
        "id": q.id,
        "lead_id": q.leadId,
        "lead_title": q.lead.title if getattr(q, "lead", None) else None,
        "lead_phone": q.lead.phone if getattr(q, "lead", None) else None,
        "lead_email": q.lead.email if getattr(q, "lead", None) else None,
        "lead_company": q.lead.company if getattr(q, "lead", None) else None,
        "number": q.number,
        "title": getattr(q, "title", None),
        "invoice_number": q.invoiceNumber,
        "version": q.version,
        "status": q.status.name if hasattr(q.status, "name") else str(q.status),
        "total": money_float(q.total),
        "subtotal": money_float(q.subtotal),
        "tax": money_float(q.tax),
        "tax_enabled": tax_enabled,
        "tax_rate": money_float(tax_rate) if tax_rate is not None else None,
        "pdf_url": q.pdfUrl,
        "template_id": q.templateId,
        "sent_at": q.sentAt.isoformat() if q.sentAt else None,
        "invoiced_at": q.invoicedAt.isoformat() if q.invoicedAt else None,
        "created_at": q.createdAt.isoformat() if getattr(q, "createdAt", None) else None,
        "updated_at": q.updatedAt.isoformat() if getattr(q, "updatedAt", None) else None,
        "source_quotation_id": getattr(q, "sourceQuotationId", None),
        "source_quotation_version": getattr(q, "sourceQuotationVersion", None),
        "source_quotation_number": source.number if source else None,
        "linked_invoices": linked_invoices,
        "linked_invoice_id": primary_invoice["id"] if primary_invoice else None,
        "linked_invoice_number": primary_invoice["invoice_number"] if primary_invoice else None,
        "lines": [
            {
                "id": getattr(ln, "id", None),
                "description": ln.description,
                "quantity": float(ln.quantity),
                "unit_price": float(ln.unitPrice),
                "line_total": float(ln.lineTotal),
            }
            for ln in (q.lines or [])
        ],
    }
    return data


def quotation_lines(q) -> list[dict]:
    return [
        {
            "description": ln.description,
            "quantity": float(ln.quantity),
            "unit_price": float(ln.unitPrice),
            "line_total": float(ln.lineTotal),
        }
        for ln in (q.lines or [])
    ]


async def resolve_quotation_layout(q, *, doc_type: str, template_id: str | None = None):
    effective_template_id = template_id or q.templateId
    tmpl = await resolve_template_for_render(
        q.organizationId,
        doc_type,
        effective_template_id,
        prefer_quotation_template=doc_type == "Invoice" and bool(q.invoiceNumber),
    )
    return layout_from_json(tmpl.layout) if tmpl else None, tmpl


async def render_quotation_pdf_bytes(
    q,
    *,
    doc_type: str,
    template_id: str | None = None,
) -> bytes:
    from loomrun_api.pdf.context import build_render_context

    layout, _tmpl = await resolve_quotation_layout(q, doc_type=doc_type, template_id=template_id)
    context = build_render_context(
        org=q.organization,
        lead=q.lead,
        quotation_number=q.number,
        lines=quotation_lines(q),
        subtotal=float(q.subtotal),
        tax=float(q.tax),
        total=float(q.total),
        doc_type=doc_type,
        invoice_number=q.invoiceNumber if doc_type == "Invoice" else None,
        layout=layout,
        invoiced_at=q.invoicedAt,
        created_at=q.createdAt,
        tax_enabled=bool(getattr(q, "taxEnabled", False)),
        tax_rate=float(q.taxRate) if getattr(q, "taxRate", None) is not None else None,
        version=q.version,
    )
    return render_preview_pdf(layout, context)


async def run_pdf_generation(quotation_id: str, template_id: str | None = None) -> str | None:
    q = await prisma.quotation.find_unique(
        where={"id": quotation_id},
        include={"lines": True, "lead": True, "organization": True, "template": True},
    )
    if not q:
        return None
    lines = quotation_lines(q)
    doc_type = "Invoice" if q.invoiceNumber else "Quotation"
    layout, tmpl = await resolve_quotation_layout(q, doc_type=doc_type, template_id=template_id)
    effective_template_id = template_id or q.templateId
    rel = render_quotation_pdf(
        quotation_id=q.id,
        org_id=q.organizationId,
        number=q.number,
        lines=lines,
        lead_title=q.lead.title if q.lead else "",
        doc_type=doc_type,
        invoice_number=q.invoiceNumber,
        layout=layout,
        org=q.organization,
        lead=q.lead,
        subtotal=float(q.subtotal),
        tax=float(q.tax),
        total=float(q.total),
        invoiced_at=q.invoicedAt,
        created_at=q.createdAt,
        tax_enabled=bool(getattr(q, "taxEnabled", False)),
        tax_rate=float(q.taxRate) if getattr(q, "taxRate", None) is not None else None,
        version=q.version,
        **brand_pdf_kwargs_from_org(q.organization),
    )
    update_data: dict = {"pdfUrl": rel, "pdfJobId": None}
    if template_id:
        update_data["templateId"] = template_id
    elif effective_template_id and not q.templateId and tmpl and tmpl.organizationId:
        update_data["templateId"] = tmpl.id
    await prisma.quotation.update(where={"id": quotation_id}, data=update_data)
    return rel


async def generate_pdf_task(quotation_id: str, template_id: str | None = None) -> None:
    try:
        await run_pdf_generation(quotation_id, template_id)
    except Exception:
        logger.exception("Background PDF generation failed for %s", quotation_id)
        await prisma.quotation.update(where={"id": quotation_id}, data={"pdfJobId": None})


async def ensure_pdf(quotation_id: str, *, organization_id: str, template_id: str | None = None) -> str:
    """Synchronously generate PDF if missing; returns relative pdfUrl."""
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if q.pdfUrl:
        path = settings.storage_dir / q.pdfUrl
        if path.is_file():
            return q.pdfUrl
    rel = await run_pdf_generation(quotation_id, template_id)
    if not rel:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PDF generation failed")
    return rel


async def quotation_pdf_for_variant(q, doc_type: str) -> tuple[str, bytes]:
    variant = "invoice" if doc_type == "invoice" else "quotation"
    stored_is_invoice = bool(q.invoiceNumber)
    filename = f"{q.invoiceNumber if variant == 'invoice' else q.number}.pdf"

    use_stored = q.pdfUrl and (
        (variant == "invoice" and stored_is_invoice)
        or (variant == "quotation" and not stored_is_invoice)
    )
    if use_stored:
        path = settings.storage_dir / q.pdfUrl
        if path.is_file():
            return filename, path.read_bytes()

    pdf_bytes = await render_quotation_pdf_bytes(
        q, doc_type="Invoice" if variant == "invoice" else "Quotation"
    )
    return filename, pdf_bytes


def quotation_card(q) -> dict[str, Any]:
    """Short list row. get_quotation stays full including lines."""
    return {
        "id": q.id,
        "number": q.number,
        "title": getattr(q, "title", None),
        "status": q.status.name if hasattr(q.status, "name") else str(q.status),
        "total": money_float(q.total),
        "lead_id": q.leadId,
        "invoice_number": q.invoiceNumber,
        "created_at": q.createdAt.isoformat() if getattr(q, "createdAt", None) else None,
        "updated_at": q.updatedAt.isoformat() if getattr(q, "updatedAt", None) else None,
    }


async def resolve_quotation(*, organization_id: str, quotation_id: str):
    """Resolve by internal id or document number (Q-… / INV-…)."""
    key = (quotation_id or "").strip()
    if not key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    q = await prisma.quotation.find_first(
        where={"id": key, "organizationId": organization_id},
        include={"lines": True, "lead": True},
    )
    if not q:
        upper = key.upper()
        if upper.startswith("Q-") or upper.startswith("INV-"):
            q = await prisma.quotation.find_first(
                where={
                    "organizationId": organization_id,
                    "OR": [
                        {"number": {"equals": key, "mode": "insensitive"}},
                        {"invoiceNumber": {"equals": key, "mode": "insensitive"}},
                    ],
                },
                include={"lines": True, "lead": True},
            )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    return q


async def get_quotation(*, organization_id: str, quotation_id: str) -> dict[str, Any]:
    q = await resolve_quotation(organization_id=organization_id, quotation_id=quotation_id)
    return serialize_quotation(q)


async def list_quotations_for_lead(
    *,
    organization_id: str,
    lead_id: str,
    limit: int = 20,
    created_after: str | None = None,
    created_before: str | None = None,
    updated_after: str | None = None,
    updated_before: str | None = None,
    timezone: str | None = None,
) -> dict[str, Any]:
    # Accepts a lead id or the customer/company name, like the other lead tools.
    lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
    lead_id = lead.id
    take = max(1, min(int(limit or 20), 50))
    where: dict[str, Any] = {
        "organizationId": organization_id,
        "leadId": lead_id,
        "invoiceNumber": None,
    }
    apply_created_updated_filters(
        where,
        created_after=created_after,
        created_before=created_before,
        updated_after=updated_after,
        updated_before=updated_before,
        timezone=timezone,
    )
    items = await prisma.quotation.find_many(
        where=where,
        order={"createdAt": "desc"},
        take=take,
        include={"lead": True},
    )
    return {"items": [quotation_card(q) for q in items], "count": len(items)}


async def create_quotation(
    *,
    organization_id: str,
    user_id: str,
    lead_id: str,
    lines: list[LineIn],
    status: QuotationStatus | str = QuotationStatus.DRAFT,
    template_id: str | None = None,
    title: str | None = None,
    tax_enabled: bool = False,
    tax_rate: float | None = None,
    as_invoice: bool = False,
    source_quotation_id: str | None = None,
    source_quotation_version: int | None = None,
) -> dict[str, Any]:
    if not lines:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="At least one line is required")

    lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
    lead_id = lead.id

    if isinstance(status, str):
        status = QuotationStatus[status]

    normalized: list[dict] = []
    for ln in lines:
        description = str(ln.get("description") or "").strip()
        quantity = float(ln.get("quantity") or 0)
        unit_price = float(ln.get("unit_price") if "unit_price" in ln else ln.get("unitPrice") or 0)
        if not description:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Line description is required")
        if quantity <= 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Line quantity must be > 0")
        if unit_price < 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Line unit_price must be >= 0")
        normalized.append(
            {"description": description, "quantity": quantity, "unit_price": unit_price}
        )

    try:
        totals = compute_document_totals(
            lines=normalized, tax_enabled=tax_enabled, tax_rate=tax_rate
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if template_id:
        doc_kind = "Invoice" if as_invoice else "Quotation"
        tmpl = await resolve_template_for_render(organization_id, doc_kind, template_id)
        if not tmpl or (tmpl.organizationId and tmpl.organizationId != organization_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid template")

    source_id = source_quotation_id
    source_ver = source_quotation_version
    if source_id:
        src = await prisma.quotation.find_first(
            where={"id": source_id, "organizationId": organization_id},
        )
        if not src:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Source quotation not found")
        if src.leadId != lead_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Source quotation must belong to the same lead",
            )
        if source_ver is None:
            source_ver = src.version

    create_data = {
        "organizationId": organization_id,
        "leadId": lead_id,
        "authorId": user_id,
        "status": status,
        "templateId": template_id,
        "title": (title or "").strip() or None,
        "subtotal": totals["subtotal"],
        "taxEnabled": totals["tax_enabled"],
        "taxRate": totals["tax_rate"],
        "tax": totals["tax"],
        "total": totals["total"],
        "version": 1,
        "sourceQuotationId": source_id,
        "sourceQuotationVersion": source_ver,
        "lines": {
            "create": [
                {
                    "description": ln["description"],
                    "quantity": ln["quantity"],
                    "unitPrice": ln["unit_price"],
                    "lineTotal": ln["line_total"],
                    "sortOrder": ln["sort_order"],
                }
                for ln in totals["lines"]
            ]
        },
    }

    q = None
    for attempt in range(5):
        number = await next_quotation_number(organization_id)
        invoice_number = None
        invoiced_at = None
        if as_invoice:
            invoice_number = await next_invoice_number(organization_id)
            invoiced_at = datetime.now(timezone.utc)
        try:
            q = await prisma.quotation.create(
                data={
                    **create_data,
                    "number": number,
                    "invoiceNumber": invoice_number,
                    "invoicedAt": invoiced_at,
                },
                include={"lines": True, "lead": True, "sourceQuotation": True},
            )
            await ensure_version_snapshot(
                quotation=q, user_id=user_id, note="Initial version"
            )
            org_events.record_changed(
                organization_id=organization_id,
                entity_type=org_events.qlix_docs.ENTITY_QUOTATION,
                entity_id=q.id,
            )
            break
        except UniqueViolationError:
            if attempt == 4:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail="Could not allocate a document number. Please try again.",
                ) from None
    if not q:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create quotation")
    # Always build an initial PDF so DocumentWorkspace has a preview immediately.
    try:
        await ensure_pdf(q.id, organization_id=organization_id)
        q = await prisma.quotation.find_unique(
            where={"id": q.id},
            include={"lines": True, "lead": True, "sourceQuotation": True},
        ) or q
    except Exception:
        logger.exception("Initial PDF generation failed for quotation %s", q.id)
    return serialize_quotation(q)


async def update_quotation_document(
    *,
    organization_id: str,
    user_id: str,
    quotation_id: str,
    lead_id: str,
    lines: list[LineIn],
    template_id: str | None = None,
    title: str | None = None,
    tax_enabled: bool | None = None,
    tax_rate: float | None = None,
    version_note: str | None = None,
) -> dict[str, Any]:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": organization_id},
        include={"lines": True, "lead": True},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")

    lead = await prisma.lead.find_first(
        where={"id": lead_id, "organizationId": organization_id},
    )
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")

    enabled = bool(q.taxEnabled) if tax_enabled is None else bool(tax_enabled)
    rate = tax_rate if tax_rate is not None else (
        float(q.taxRate) if q.taxRate is not None else None
    )
    try:
        totals = compute_document_totals(lines=lines, tax_enabled=enabled, tax_rate=rate)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    next_version = q.version
    had_pdf = bool(q.pdfUrl)
    was_generated = had_pdf or is_commercially_issued(q)
    if is_commercially_issued(q) or had_pdf:
        next_version = await bump_version_for_revision(
            quotation=q,
            user_id=user_id,
            note=version_note or "Revised",
        )

    await prisma.quotationline.delete_many(where={"quotationId": quotation_id})

    update_data: dict[str, Any] = {
        "leadId": lead_id,
        "subtotal": totals["subtotal"],
        "taxEnabled": totals["tax_enabled"],
        "taxRate": totals["tax_rate"],
        "tax": totals["tax"],
        "total": totals["total"],
        "version": next_version,
        "status": QuotationStatus.DRAFT,
        "pdfUrl": None,
        "pdfJobId": None,
        "sentAt": None,
        "templateId": template_id if template_id is not None else q.templateId,
        "lines": {
            "create": [
                {
                    "description": ln["description"],
                    "quantity": float(ln["quantity"]),
                    "unitPrice": float(ln["unit_price"]),
                    "lineTotal": float(ln["line_total"]),
                    "sortOrder": ln["sort_order"],
                }
                for ln in totals["lines"]
            ]
        },
    }
    if title is not None:
        update_data["title"] = title.strip() or None

    org_events.record_changed(
        organization_id=organization_id,
        entity_type=org_events.qlix_docs.ENTITY_QUOTATION,
        entity_id=quotation_id,
    )
    updated = await prisma.quotation.update(
        where={"id": quotation_id},
        data=update_data,
        include={"lines": True, "lead": True, "sourceQuotation": True},
    )

    lead_stage = None
    if was_generated and not updated.invoiceNumber:
        from loomrun_api.quotation_delivery import advance_lead_to_negotiation

        new_stage = await advance_lead_to_negotiation(
            lead_id=lead_id,
            user_id=user_id,
            quotation_number=updated.number,
        )
        if new_stage is not None:
            lead_stage = new_stage.name if hasattr(new_stage, "name") else str(new_stage)

    result = serialize_quotation(updated)
    if lead_stage:
        result["lead_stage"] = lead_stage
        result["message"] = (
            "Quotation updated — lead moved to Negotiation"
            if lead_stage == "NEGOTIATION"
            else "Document updated — regenerate PDF when ready"
        )
    if next_version != q.version:
        result["message"] = (
            f"Saved as version {next_version}. Previous version {q.version} kept in history."
        )
    elif not result.get("message"):
        result["message"] = "Document saved"

    saved_message = result.get("message")
    try:
        await ensure_pdf(updated.id, organization_id=organization_id)
        updated = await prisma.quotation.find_unique(
            where={"id": updated.id},
            include={"lines": True, "lead": True, "sourceQuotation": True},
        ) or updated
        if next_version != q.version:
            await ensure_version_snapshot(
                quotation=updated,
                user_id=user_id,
                note=version_note or "Revised",
            )
        result = serialize_quotation(updated)
        result["message"] = saved_message or "Document saved"
        if lead_stage:
            result["lead_stage"] = lead_stage
    except Exception:
        logger.exception("PDF regeneration failed for quotation %s", updated.id)
    return result


async def generate_invoice(
    *,
    organization_id: str,
    quotation_id: str,
    queue_pdf: bool = True,
    wait_pdf: bool = False,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Create a new invoice document copied from a quotation (preserves lineage).

    Legacy quotations that were stamped in place remain valid; new invoices are
    separate rows with ``source_quotation_id`` set. On success the source
    quotation status becomes ``INVOICED`` (version number unchanged).
    """
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": organization_id},
        include={"lines": True, "lead": True, "derivedInvoices": True},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if q.invoiceNumber:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This document is already an invoice",
        )

    # Soft duplicate guard: if this quotation already has a linked invoice,
    # return that invoice instead of creating another from a double-click.
    existing = [
        inv
        for inv in (getattr(q, "derivedInvoices", None) or [])
        if getattr(inv, "invoiceNumber", None)
    ]
    if existing:
        existing.sort(
            key=lambda inv: getattr(inv, "createdAt", None) or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        latest = existing[0]
        # Ensure source status is reconciled even for older rows.
        src_status = q.status.name if hasattr(q.status, "name") else str(q.status)
        if src_status != "INVOICED":
            await prisma.quotation.update(
                where={"id": q.id},
                data={"status": QuotationStatus.INVOICED},
            )
        row = await prisma.quotation.find_unique(
            where={"id": latest.id},
            include={"lines": True, "lead": True, "sourceQuotation": True},
        )
        result = serialize_quotation(row) if row else {"id": latest.id}
        result["status_message"] = "existing"
        result["source_quotation_id"] = q.id
        result["invoice_number"] = latest.invoiceNumber
        return result

    # Snapshot the source quotation version before copying (does not bump version).
    await ensure_version_snapshot(quotation=q, user_id=user_id, note=None)

    lines = [
        {
            "description": ln.description,
            "quantity": float(ln.quantity),
            "unit_price": float(ln.unitPrice),
        }
        for ln in (q.lines or [])
    ]
    created = await create_quotation(
        organization_id=organization_id,
        user_id=user_id or (q.authorId or ""),
        lead_id=q.leadId,
        lines=lines,
        status=QuotationStatus.DRAFT,
        template_id=q.templateId,
        title=q.title,
        tax_enabled=bool(getattr(q, "taxEnabled", False)),
        tax_rate=float(q.taxRate) if q.taxRate is not None else None,
        as_invoice=True,
        source_quotation_id=q.id,
        source_quotation_version=q.version,
    )

    invoice_id = created["id"]
    invoice_number = created.get("invoice_number")

    # Mark source quotation INVOICED only after the invoice row exists.
    try:
        await prisma.quotation.update(
            where={"id": q.id},
            data={"status": QuotationStatus.INVOICED},
        )
    except Exception:
        logger.exception(
            "Invoice %s created but failed to mark quotation %s as INVOICED",
            invoice_id,
            q.id,
        )
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invoice created but quotation status could not be updated. Refresh and retry.",
        ) from None

    # Lead activity (existing infrastructure).
    try:
        from prisma.enums import LeadActivityType
        from loomrun_api.prisma_json import json_meta

        await prisma.leadactivity.create(
            data={
                "leadId": q.leadId,
                "userId": user_id,
                "type": LeadActivityType.SYSTEM,
                "body": (
                    f"Invoice {invoice_number} created from quotation {q.number}"
                ),
                "metadata": json_meta(
                    {
                        "quotation_id": q.id,
                        "quotation_number": q.number,
                        "quotation_version": q.version,
                        "invoice_id": invoice_id,
                        "invoice_number": invoice_number,
                    }
                ),
            }
        )
    except Exception:
        logger.exception("Failed to record invoice activity for quotation %s", q.id)

    org_events.emit(
        organization_id,
        "quotation.invoiced",
        {
            "quotation_id": q.id,
            "quotation_number": q.number,
            "invoice_id": invoice_id,
            "invoice_number": invoice_number,
        },
        entity_type=org_events.qlix_docs.ENTITY_QUOTATION,
        entity_id=q.id,
    )
    org_events.record_changed(
        organization_id=organization_id,
        entity_type=org_events.qlix_docs.ENTITY_QUOTATION,
        entity_id=q.id,
    )

    if wait_pdf or queue_pdf:
        try:
            await ensure_pdf(invoice_id, organization_id=organization_id)
            row = await prisma.quotation.find_unique(
                where={"id": invoice_id},
                include={"lines": True, "lead": True, "sourceQuotation": True},
            )
            result = serialize_quotation(row) if row else created
        except Exception:
            logger.exception("Invoice PDF generation failed for %s", invoice_id)
            result = created
    else:
        result = created

    result["status_message"] = "ready"
    result["source_quotation_id"] = q.id
    return result


async def send_document(
    *,
    organization_id: str,
    user_id: str,
    quotation_id: str,
    channel: Literal["whatsapp", "email"] = "whatsapp",
    doc_type: Literal["quotation", "invoice"] | None = None,
    ensure_pdf_first: bool = True,
) -> dict[str, Any]:
    if ensure_pdf_first:
        await ensure_pdf(quotation_id, organization_id=organization_id)

    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": organization_id},
        include={"lines": True, "lead": True, "organization": True, "template": True},
    )
    if not q or not q.lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if not q.pdfUrl:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Generate the PDF before sending the quotation",
        )

    resolved_doc_type = doc_type or ("invoice" if q.invoiceNumber else "quotation")
    if resolved_doc_type == "invoice" and not q.invoiceNumber:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="This quotation is not invoiced yet")

    document_number = q.invoiceNumber if resolved_doc_type == "invoice" else q.number
    attachment = await quotation_pdf_for_variant(q, resolved_doc_type)

    delivery = await deliver_quotation(
        organization_id=organization_id,
        quotation=q,
        lead=q.lead,
        org_name=q.organization.name if q.organization else None,
        channel=channel,
        user_id=user_id,
        doc_type=resolved_doc_type,
        attachment=attachment,
    )

    new_stage = await advance_lead_to_quotation(
        lead_id=q.leadId,
        user_id=user_id,
        quotation_number=document_number,
        channel=channel,
        doc_type=resolved_doc_type,
    )

    updated = await prisma.quotation.update(
        where={"id": quotation_id},
        data={"status": QuotationStatus.SENT, "sentAt": datetime.now(timezone.utc)},
        include={"lines": True, "lead": True, "sourceQuotation": True},
    )
    await ensure_version_snapshot(
        quotation=updated,
        user_id=user_id,
        note="Sent",
    )
    org_events.emit(
        organization_id,
        "quotation.sent",
        {"quotation_id": quotation_id, "number": document_number, "channel": channel},
        entity_type=org_events.qlix_docs.ENTITY_QUOTATION,
        entity_id=quotation_id,
    )
    channel_label = "WhatsApp" if channel == "whatsapp" else "Email"
    doc_label = "Invoice" if resolved_doc_type == "invoice" else "Quotation"
    return {
        **serialize_quotation(updated),
        "lead_stage": new_stage.name if hasattr(new_stage, "name") else str(new_stage),
        "message": f"{doc_label} sent via {channel_label}",
        **delivery,
    }


async def create_and_send_quotation(
    *,
    organization_id: str,
    user_id: str,
    lead_id: str,
    lines: list[LineIn],
    channel: Literal["whatsapp", "email"] = "whatsapp",
    template_id: str | None = None,
) -> dict[str, Any]:
    created = await create_quotation(
        organization_id=organization_id,
        user_id=user_id,
        lead_id=lead_id,
        lines=lines,
        template_id=template_id,
    )
    sent = await send_document(
        organization_id=organization_id,
        user_id=user_id,
        quotation_id=created["id"],
        channel=channel,
        doc_type="quotation",
        ensure_pdf_first=True,
    )
    return {"created": created, "sent": sent}


async def create_and_send_invoice(
    *,
    organization_id: str,
    user_id: str,
    quotation_id: str | None = None,
    lead_id: str | None = None,
    lines: list[LineIn] | None = None,
    channel: Literal["whatsapp", "email"] = "whatsapp",
    template_id: str | None = None,
) -> dict[str, Any]:
    """Invoice an existing quotation, or create quotation first then invoice+send."""
    if quotation_id:
        qid = quotation_id
    else:
        if not lead_id or not lines:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Provide quotation_id, or lead_id + lines to create first",
            )
        created = await create_quotation(
            organization_id=organization_id,
            user_id=user_id,
            lead_id=lead_id,
            lines=lines,
            template_id=template_id,
        )
        qid = created["id"]

    invoiced = await generate_invoice(
        organization_id=organization_id,
        quotation_id=qid,
        queue_pdf=False,
        wait_pdf=True,
        user_id=user_id,
    )
    invoice_id = invoiced["id"]
    sent = await send_document(
        organization_id=organization_id,
        user_id=user_id,
        quotation_id=invoice_id,
        channel=channel,
        doc_type="invoice",
        ensure_pdf_first=True,
    )
    return {"invoiced": invoiced, "sent": sent}
