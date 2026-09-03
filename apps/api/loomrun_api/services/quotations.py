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
from loomrun_api.pdf import brand_pdf_kwargs_from_org, render_quotation_pdf
from loomrun_api.pdf.renderer import render_preview_pdf
from loomrun_api import org_events
from loomrun_api.prisma_client import prisma
from loomrun_api.services.leads import resolve_lead
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


def serialize_quotation(q) -> dict[str, Any]:
    return {
        "id": q.id,
        "lead_id": q.leadId,
        "lead_title": q.lead.title if getattr(q, "lead", None) else None,
        "lead_phone": q.lead.phone if getattr(q, "lead", None) else None,
        "lead_email": q.lead.email if getattr(q, "lead", None) else None,
        "number": q.number,
        "title": getattr(q, "title", None),
        "invoice_number": q.invoiceNumber,
        "version": q.version,
        "status": q.status.name if hasattr(q.status, "name") else str(q.status),
        "total": float(q.total),
        "subtotal": float(q.subtotal),
        "tax": float(q.tax),
        "pdf_url": q.pdfUrl,
        "template_id": q.templateId,
        "sent_at": q.sentAt.isoformat() if q.sentAt else None,
        "invoiced_at": q.invoicedAt.isoformat() if q.invoicedAt else None,
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


async def get_quotation(*, organization_id: str, quotation_id: str) -> dict[str, Any]:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": organization_id},
        include={"lines": True, "lead": True},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    return serialize_quotation(q)


async def list_quotations_for_lead(*, organization_id: str, lead_id: str, limit: int = 20) -> dict[str, Any]:
    # Accepts a lead id or the customer/company name, like the other lead tools.
    lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
    lead_id = lead.id
    take = max(1, min(int(limit or 20), 50))
    items = await prisma.quotation.find_many(
        where={"organizationId": organization_id, "leadId": lead_id},
        order={"createdAt": "desc"},
        take=take,
        include={"lines": True, "lead": True},
    )
    return {"items": [serialize_quotation(q) for q in items], "count": len(items)}


async def create_quotation(
    *,
    organization_id: str,
    user_id: str,
    lead_id: str,
    lines: list[LineIn],
    status: QuotationStatus | str = QuotationStatus.DRAFT,
    template_id: str | None = None,
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

    subtotal = sum(ln["quantity"] * ln["unit_price"] for ln in normalized)
    tax = 0.0
    total = subtotal + tax

    if template_id:
        tmpl = await resolve_template_for_render(organization_id, "Quotation", template_id)
        if not tmpl or (tmpl.organizationId and tmpl.organizationId != organization_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid template")

    create_data = {
        "organizationId": organization_id,
        "leadId": lead_id,
        "authorId": user_id,
        "status": status,
        "templateId": template_id,
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "lines": {
            "create": [
                {
                    "description": ln["description"],
                    "quantity": ln["quantity"],
                    "unitPrice": ln["unit_price"],
                    "lineTotal": ln["quantity"] * ln["unit_price"],
                    "sortOrder": i,
                }
                for i, ln in enumerate(normalized)
            ]
        },
    }

    q = None
    for attempt in range(5):
        number = await next_quotation_number(organization_id)
        try:
            q = await prisma.quotation.create(
                data={**create_data, "number": number},
                include={"lines": True, "lead": True},
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
                    detail="Could not allocate a quotation number. Please try again.",
                ) from None
    if not q:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create quotation")
    return serialize_quotation(q)


async def generate_invoice(
    *,
    organization_id: str,
    quotation_id: str,
    queue_pdf: bool = True,
    wait_pdf: bool = False,
) -> dict[str, Any]:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": organization_id},
        include={"lines": True, "lead": True},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if q.invoiceNumber:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="This quotation is already invoiced")

    updated = None
    invoice_number = ""
    for attempt in range(5):
        invoice_number = await next_invoice_number(organization_id)
        try:
            org_events.record_changed(
                organization_id=organization_id,
                entity_type=org_events.qlix_docs.ENTITY_QUOTATION,
                entity_id=quotation_id,
            )
            updated = await prisma.quotation.update(
                where={"id": quotation_id},
                data={
                    "invoiceNumber": invoice_number,
                    "invoicedAt": datetime.now(timezone.utc),
                    "pdfUrl": None,
                    "pdfJobId": "queued" if queue_pdf or wait_pdf else None,
                },
                include={"lines": True, "lead": True},
            )
            break
        except UniqueViolationError:
            if attempt == 4:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail="Could not allocate an invoice number. Please try again.",
                ) from None
    if not updated:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate invoice")

    if wait_pdf:
        await ensure_pdf(quotation_id, organization_id=organization_id)
        updated = await prisma.quotation.find_unique(
            where={"id": quotation_id},
            include={"lines": True, "lead": True},
        )
    elif queue_pdf:
        asyncio.create_task(generate_pdf_task(quotation_id))

    result = serialize_quotation(updated) if updated else {"id": quotation_id, "invoice_number": invoice_number}
    result["status_message"] = "queued" if queue_pdf and not wait_pdf else "ready"
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
        include={"lines": True, "lead": True},
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
    )
    sent = await send_document(
        organization_id=organization_id,
        user_id=user_id,
        quotation_id=qid,
        channel=channel,
        doc_type="invoice",
        ensure_pdf_first=True,
    )
    return {"invoiced": invoiced, "sent": sent}
