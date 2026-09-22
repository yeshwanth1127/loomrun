import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from typing import Literal

from loomrun_api.config import settings
from loomrun_api.date_filter import apply_created_at
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api import org_events
from loomrun_api.prisma_client import prisma
from loomrun_api.services import quotations as quote_svc
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
    template_id: str | None = None
    title: str | None = Field(default=None, max_length=200)
    tax_enabled: bool = False
    tax_rate: float | None = Field(default=None, ge=0, le=100)
    as_invoice: bool = False
    source_quotation_id: str | None = None
    source_quotation_version: int | None = None


class QuotationUpdate(BaseModel):
    lead_id: str
    lines: list[QuotationLineIn] = Field(min_length=1)
    template_id: str | None = None
    title: str | None = Field(default=None, max_length=200)
    tax_enabled: bool | None = None
    tax_rate: float | None = Field(default=None, ge=0, le=100)
    version_note: str | None = Field(default=None, max_length=500)


class GeneratePdfBody(BaseModel):
    template_id: str | None = None


class QuotationSendBody(BaseModel):
    channel: Literal["whatsapp", "email"] = "whatsapp"
    doc_type: Literal["quotation", "invoice"] | None = None


class QuotationRenameBody(BaseModel):
    title: str = Field(max_length=200)


# Back-compat aliases for any internal imports
_next_quotation_number = quote_svc.next_quotation_number
_next_invoice_number = quote_svc.next_invoice_number
_run_pdf_generation = quote_svc.run_pdf_generation
_generate_pdf_task = quote_svc.generate_pdf_task
_quotation_pdf_for_variant = quote_svc.quotation_pdf_for_variant
_render_quotation_pdf_bytes = quote_svc.render_quotation_pdf_bytes
_quotation_lines = quote_svc.quotation_lines


@router.get("/orgs/{org_id}/quotations")
async def list_quotations(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    doc: str = Query(
        "quotation",
        pattern="^(quotation|invoice|all)$",
        description="quotation = not yet invoiced; invoice = converted; all = both",
    ),
    lead_id: str | None = Query(None, description="Filter to one lead"),
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
) -> dict:
    where: dict = {"organizationId": ctx.organization_id}
    apply_created_at(where, day)
    if doc == "quotation":
        where["invoiceNumber"] = None
    elif doc == "invoice":
        where["invoiceNumber"] = {"not": None}
    if lead_id:
        where["leadId"] = lead_id
    items = await prisma.quotation.find_many(
        where=where,
        order={"updatedAt": "desc"},
        include={"lines": True, "lead": True, "sourceQuotation": True, "derivedInvoices": True},
    )
    return {"items": [quote_svc.serialize_quotation(q) for q in items]}


@router.get("/orgs/{org_id}/quotations/{quotation_id}")
async def get_quotation(
    org_id: str,
    quotation_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
        include={"lines": True, "lead": True, "sourceQuotation": True, "derivedInvoices": True},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    data = quote_svc.serialize_quotation(q)
    from loomrun_api.quotation_versions import list_versions

    data["versions"] = await list_versions(
        organization_id=ctx.organization_id, quotation_id=quotation_id
    )
    return data


@router.get("/orgs/{org_id}/quotations/{quotation_id}/versions")
async def get_quotation_versions(
    org_id: str,
    quotation_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    from loomrun_api.quotation_versions import list_versions

    return {
        "items": await list_versions(
            organization_id=ctx.organization_id, quotation_id=quotation_id
        ),
        "current_version": q.version,
    }


@router.get("/orgs/{org_id}/quotations/{quotation_id}/versions/{version_number}")
async def get_quotation_version(
    org_id: str,
    quotation_id: str,
    version_number: int,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    from loomrun_api.quotation_versions import serialize_version

    row = await prisma.quotationversion.find_first(
        where={
            "quotationId": quotation_id,
            "organizationId": ctx.organization_id,
            "versionNumber": version_number,
        }
    )
    if not row:
        if q.version == version_number:
            # Live current version without snapshot yet
            q_full = await prisma.quotation.find_first(
                where={"id": quotation_id},
                include={"lines": True, "lead": True, "sourceQuotation": True},
            )
            data = quote_svc.serialize_quotation(q_full)
            data["version_number"] = q.version
            data["is_current"] = True
            data["is_snapshot"] = False
            return data
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Version not found")
    data = serialize_version(row, is_current=(row.versionNumber == q.version))
    data["is_snapshot"] = True
    data["number"] = q.number
    data["lead_id"] = q.leadId
    return data


@router.post("/orgs/{org_id}/quotations", status_code=status.HTTP_201_CREATED)
async def create_quotation(org_id: str, body: QuotationCreate, ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER"))) -> dict:
    role = ctx.membership.role.name if hasattr(ctx.membership.role, "name") else str(ctx.membership.role)
    if body.as_invoice and role != "OWNER":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only owners can create invoices")
    return await quote_svc.create_quotation(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        lead_id=body.lead_id,
        lines=[ln.model_dump() for ln in body.lines],
        status=body.status,
        template_id=body.template_id,
        title=body.title,
        tax_enabled=body.tax_enabled,
        tax_rate=body.tax_rate,
        as_invoice=body.as_invoice,
        source_quotation_id=body.source_quotation_id,
        source_quotation_version=body.source_quotation_version,
    )


@router.post("/orgs/{org_id}/quotations/{quotation_id}/send")
async def send_quotation(
    org_id: str,
    quotation_id: str,
    body: QuotationSendBody,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
) -> dict:
    return await quote_svc.send_document(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        quotation_id=quotation_id,
        channel=body.channel,
        doc_type=body.doc_type,
        ensure_pdf_first=False,
    )


@router.post("/orgs/{org_id}/quotations/{quotation_id}/generate-pdf")
async def generate_pdf(
    org_id: str,
    quotation_id: str,
    body: GeneratePdfBody | None = Body(default=None),
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    template_id = body.template_id if body else None
    # Generate synchronously so the workspace preview is ready when the client
    # refreshes — fire-and-forget left users staring at an empty gray pane.
    pdf_url = await quote_svc.run_pdf_generation(quotation_id, template_id)
    if not pdf_url:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PDF generation failed")
    updated = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
        include={"lines": True, "lead": True, "sourceQuotation": True},
    )
    return {
        "status": "ready",
        "quotation_id": quotation_id,
        "pdf_url": pdf_url,
        **(quote_svc.serialize_quotation(updated) if updated else {}),
    }


@router.patch("/orgs/{org_id}/quotations/{quotation_id}")
async def update_quotation(
    org_id: str,
    quotation_id: str,
    body: QuotationUpdate,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
) -> dict:
    role = ctx.membership.role.name if hasattr(ctx.membership.role, "name") else str(ctx.membership.role)
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if q.invoiceNumber and role != "OWNER":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only owners can edit invoices",
        )
    return await quote_svc.update_quotation_document(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        quotation_id=quotation_id,
        lead_id=body.lead_id,
        lines=[ln.model_dump() for ln in body.lines],
        template_id=body.template_id,
        title=body.title,
        tax_enabled=body.tax_enabled,
        tax_rate=body.tax_rate,
        version_note=body.version_note,
    )


@router.patch("/orgs/{org_id}/quotations/{quotation_id}/title")
async def rename_quotation(
    org_id: str,
    quotation_id: str,
    body: QuotationRenameBody,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
        include={"lines": True, "lead": True},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")

    title = body.title.strip() or None
    updated = await prisma.quotation.update(
        where={"id": quotation_id},
        data={"title": title},
        include={"lines": True, "lead": True},
    )
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_QUOTATION,
        entity_id=quotation_id,
    )
    return quote_svc.serialize_quotation(updated)


@router.post("/orgs/{org_id}/quotations/{quotation_id}/generate-invoice")
async def generate_invoice(
    org_id: str,
    quotation_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    result = await quote_svc.generate_invoice(
        organization_id=ctx.organization_id,
        quotation_id=quotation_id,
        queue_pdf=True,
        wait_pdf=False,
        user_id=ctx.membership.userId,
    )
    return {
        "status": "queued",
        "invoice_number": result.get("invoice_number"),
        "quotation_id": result.get("id"),
        "source_quotation_id": quotation_id,
        "source_quotation_version": result.get("source_quotation_version"),
        **{k: v for k, v in result.items() if k in ("id", "number", "total", "tax", "tax_rate", "tax_enabled")},
    }


@router.get("/orgs/{org_id}/quotations/{quotation_id}/pdf-file")
async def download_pdf(
    org_id: str,
    quotation_id: str,
    variant: Literal["quotation", "invoice"] | None = Query(
        None,
        description="Download as quotation or invoice PDF",
    ),
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
):
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
        include={"lines": True, "lead": True, "organization": True, "template": True},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")

    effective_variant = variant or ("invoice" if q.invoiceNumber else "quotation")
    if effective_variant == "invoice" and not q.invoiceNumber:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="This quotation is not invoiced yet")

    stored_is_invoice = bool(q.invoiceNumber)
    use_stored = (
        q.pdfUrl
        and (
            (effective_variant == "invoice" and stored_is_invoice)
            or (effective_variant == "quotation" and not stored_is_invoice)
        )
    )
    if use_stored:
        path = settings.storage_dir / q.pdfUrl
        if path.is_file():
            filename = f"{q.invoiceNumber if effective_variant == 'invoice' else q.number}.pdf"
            return FileResponse(
                path,
                filename=filename,
                media_type="application/pdf",
                content_disposition_type="inline",
            )

    if not q.lines:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="PDF not available")

    doc_type = "Invoice" if effective_variant == "invoice" else "Quotation"
    pdf_bytes = await quote_svc.render_quotation_pdf_bytes(q, doc_type=doc_type)
    filename = f"{q.invoiceNumber if effective_variant == 'invoice' else q.number}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.delete("/orgs/{org_id}/quotations/{quotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_quotation(
    org_id: str,
    quotation_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> None:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")

    if q.pdfUrl:
        path = settings.storage_dir / q.pdfUrl
        if path.is_file():
            path.unlink()

    await prisma.productionorder.update_many(
        where={"quotationId": quotation_id},
        data={"quotationId": None},
    )
    await prisma.quotation.delete(where={"id": quotation_id})
    org_events.record_changed(
        organization_id=ctx.organization_id,
        entity_type=org_events.qlix_docs.ENTITY_QUOTATION,
        entity_id=quotation_id,
        deleted=True,
    )
