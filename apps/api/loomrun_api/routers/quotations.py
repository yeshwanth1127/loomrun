import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Literal

from loomrun_api.config import settings
from loomrun_api.date_filter import apply_created_at
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.pdf import brand_pdf_kwargs_from_org, render_quotation_pdf
from loomrun_api.prisma_client import prisma
from loomrun_api.quotation_delivery import advance_lead_to_quotation, deliver_quotation
from prisma.enums import QuotationStatus

logger = logging.getLogger(__name__)
router = APIRouter()


class QuotationLineIn(BaseModel):
    description: str = Field(min_length=1)
    quantity: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class QuotationCreate(BaseModel):
    lead_id: str
    lines: list[QuotationLineIn] = Field(min_length=1)
    status: QuotationStatus = QuotationStatus.DRAFT


class QuotationSendBody(BaseModel):
    channel: Literal["whatsapp", "email"] = "whatsapp"


async def _next_quotation_number(org_id: str) -> str:
    n = await prisma.quotation.count(where={"organizationId": org_id, "invoiceNumber": None})
    year = datetime.now(timezone.utc).year
    return f"Q-{year}-{(n + 1):05d}"


async def _next_invoice_number(org_id: str) -> str:
    n = await prisma.quotation.count(where={"organizationId": org_id, "invoiceNumber": {"not": None}})
    year = datetime.now(timezone.utc).year
    return f"INV-{year}-{(n + 1):05d}"


@router.get("/orgs/{org_id}/quotations")
async def list_quotations(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    apply_created_at(where, day)
    items = await prisma.quotation.find_many(
        where=where,
        order={"createdAt": "desc"},
        include={"lines": True, "lead": True},
    )
    return {
        "items": [
            {
                "id": q.id,
                "lead_id": q.leadId,
                "lead_title": q.lead.title if q.lead else None,
                "lead_phone": q.lead.phone if q.lead else None,
                "lead_email": q.lead.email if q.lead else None,
                "number": q.number,
                "invoice_number": q.invoiceNumber,
                "version": q.version,
                "status": q.status.name if hasattr(q.status, "name") else str(q.status),
                "total": float(q.total),
                "pdf_url": q.pdfUrl,
                "sent_at": q.sentAt.isoformat() if q.sentAt else None,
                "invoiced_at": q.invoicedAt.isoformat() if q.invoicedAt else None,
                "lines": [
                    {
                        "id": ln.id,
                        "description": ln.description,
                        "quantity": float(ln.quantity),
                        "unit_price": float(ln.unitPrice),
                        "line_total": float(ln.lineTotal),
                    }
                    for ln in (q.lines or [])
                ],
            }
            for q in items
        ]
    }


@router.post("/orgs/{org_id}/quotations", status_code=status.HTTP_201_CREATED)
async def create_quotation(org_id: str, body: QuotationCreate, ctx: OrgContext = Depends(get_org_context)) -> dict:
    lead = await prisma.lead.find_first(
        where={"id": body.lead_id, "organizationId": ctx.organization_id},
    )
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")
    number = await _next_quotation_number(ctx.organization_id)
    subtotal = sum(line.quantity * line.unit_price for line in body.lines)
    tax = 0.0
    total = subtotal + tax
    q = await prisma.quotation.create(
        data={
            "organizationId": ctx.organization_id,
            "leadId": body.lead_id,
            "authorId": ctx.membership.userId,
            "number": number,
            "status": body.status,
            "subtotal": subtotal,
            "tax": tax,
            "total": total,
            "lines": {
                "create": [
                    {
                        "description": ln.description,
                        "quantity": ln.quantity,
                        "unitPrice": ln.unit_price,
                        "lineTotal": ln.quantity * ln.unit_price,
                        "sortOrder": i,
                    }
                    for i, ln in enumerate(body.lines)
                ]
            },
        },
        include={"lines": True},
    )
    return {
        "id": q.id,
        "lead_id": q.leadId,
        "number": q.number,
        "status": q.status.name if hasattr(q.status, "name") else str(q.status),
        "total": float(q.total),
        "lines": [
            {
                "description": ln.description,
                "quantity": float(ln.quantity),
                "unit_price": float(ln.unitPrice),
                "line_total": float(ln.lineTotal),
            }
            for ln in (q.lines or [])
        ],
    }


@router.post("/orgs/{org_id}/quotations/{quotation_id}/send")
async def send_quotation(
    org_id: str,
    quotation_id: str,
    body: QuotationSendBody,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
        include={"lead": True, "organization": True},
    )
    if not q or not q.lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if not q.pdfUrl:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Generate the PDF before sending the quotation",
        )

    delivery = await deliver_quotation(
        organization_id=ctx.organization_id,
        quotation=q,
        lead=q.lead,
        org_name=q.organization.name if q.organization else None,
        channel=body.channel,
        user_id=ctx.membership.userId,
    )

    new_stage = await advance_lead_to_quotation(
        lead_id=q.leadId,
        user_id=ctx.membership.userId,
        quotation_number=q.number,
        channel=body.channel,
    )

    updated = await prisma.quotation.update(
        where={"id": quotation_id},
        data={"status": QuotationStatus.SENT, "sentAt": datetime.now(timezone.utc)},
    )
    channel_label = "WhatsApp" if body.channel == "whatsapp" else "Email"
    status_name = updated.status.name if hasattr(updated.status, "name") else str(updated.status)
    return {
        "id": updated.id,
        "status": status_name,
        "sent_at": updated.sentAt.isoformat() if updated.sentAt else None,
        "lead_stage": new_stage.name if hasattr(new_stage, "name") else str(new_stage),
        "message": f"Sent via {channel_label}",
        **delivery,
    }


async def _run_pdf_generation(quotation_id: str) -> str | None:
    q = await prisma.quotation.find_unique(
        where={"id": quotation_id},
        include={"lines": True, "lead": True, "organization": True},
    )
    if not q:
        return None
    lines = [
        {
            "description": ln.description,
            "quantity": float(ln.quantity),
            "unit_price": float(ln.unitPrice),
            "line_total": float(ln.lineTotal),
        }
        for ln in (q.lines or [])
    ]
    doc_type = "Invoice" if q.invoiceNumber else "Quotation"
    rel = render_quotation_pdf(
        quotation_id=q.id,
        org_id=q.organizationId,
        number=q.number,
        lines=lines,
        lead_title=q.lead.title if q.lead else "",
        doc_type=doc_type,
        invoice_number=q.invoiceNumber,
        **brand_pdf_kwargs_from_org(q.organization),
    )
    await prisma.quotation.update(where={"id": quotation_id}, data={"pdfUrl": rel, "pdfJobId": None})
    return rel


async def _generate_pdf_task(quotation_id: str) -> None:
    try:
        await _run_pdf_generation(quotation_id)
    except Exception:
        logger.exception("Background PDF generation failed for %s", quotation_id)
        await prisma.quotation.update(where={"id": quotation_id}, data={"pdfJobId": None})


@router.post("/orgs/{org_id}/quotations/{quotation_id}/generate-pdf")
async def generate_pdf(org_id: str, quotation_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    await prisma.quotation.update(where={"id": quotation_id}, data={"pdfJobId": "queued"})
    asyncio.create_task(_generate_pdf_task(quotation_id))
    return {"status": "queued", "quotation_id": quotation_id}


@router.patch("/orgs/{org_id}/quotations/{quotation_id}")
async def update_quotation(
    org_id: str,
    quotation_id: str,
    body: QuotationCreate,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")

    lead = await prisma.lead.find_first(
        where={"id": body.lead_id, "organizationId": ctx.organization_id},
    )
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lead not found")

    subtotal = sum(line.quantity * line.unit_price for line in body.lines)
    tax = 0.0
    total = subtotal + tax

    await prisma.quotationline.delete_many(where={"quotationId": quotation_id})

    updated = await prisma.quotation.update(
        where={"id": quotation_id},
        data={
            "leadId": body.lead_id,
            "subtotal": subtotal,
            "tax": tax,
            "total": total,
            "lines": {
                "create": [
                    {
                        "description": ln.description,
                        "quantity": ln.quantity,
                        "unitPrice": ln.unit_price,
                        "lineTotal": ln.quantity * ln.unit_price,
                        "sortOrder": i,
                    }
                    for i, ln in enumerate(body.lines)
                ]
            },
        },
        include={"lines": True},
    )

    return {
        "id": updated.id,
        "lead_id": updated.leadId,
        "number": updated.number,
        "status": updated.status.name if hasattr(updated.status, "name") else str(updated.status),
        "total": float(updated.total),
        "lines": [
            {
                "description": ln.description,
                "quantity": float(ln.quantity),
                "unit_price": float(ln.unitPrice),
                "line_total": float(ln.lineTotal),
            }
            for ln in (updated.lines or [])
        ],
    }


@router.post("/orgs/{org_id}/quotations/{quotation_id}/generate-invoice")
async def generate_invoice(
    org_id: str,
    quotation_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
        include={"lines": True},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")

    if q.invoiceNumber:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="This quotation is already invoiced")

    invoice_number = await _next_invoice_number(ctx.organization_id)

    updated = await prisma.quotation.update(
        where={"id": quotation_id},
        data={
            "invoiceNumber": invoice_number,
            "invoicedAt": datetime.now(timezone.utc),
            "pdfUrl": None,
            "pdfJobId": "queued",
        },
    )

    asyncio.create_task(_generate_pdf_task(quotation_id))
    return {"status": "queued", "invoice_number": invoice_number, "quotation_id": quotation_id}


@router.get("/orgs/{org_id}/quotations/{quotation_id}/pdf-file")
async def download_pdf(org_id: str, quotation_id: str, ctx: OrgContext = Depends(get_org_context)):
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q or not q.pdfUrl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="PDF not available")
    path = settings.storage_dir / q.pdfUrl
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="PDF file missing")
    filename = f"{q.invoiceNumber or q.number}.pdf"
    return FileResponse(path, filename=filename, media_type="application/pdf")
