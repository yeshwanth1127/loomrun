import logging
from datetime import datetime, timezone

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.pdf import brand_pdf_kwargs_from_org, render_quotation_pdf
from loomrun_api.prisma_client import prisma
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


async def _next_quotation_number(org_id: str) -> str:
    n = await prisma.quotation.count(where={"organizationId": org_id})
    year = datetime.now(timezone.utc).year
    return f"Q-{year}-{(n + 1):05d}"


@router.get("/orgs/{org_id}/quotations")
async def list_quotations(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    items = await prisma.quotation.find_many(
        where={"organizationId": ctx.organization_id},
        order={"createdAt": "desc"},
        include={"lines": True},
    )
    return {
        "items": [
            {
                "id": q.id,
                "lead_id": q.leadId,
                "number": q.number,
                "version": q.version,
                "status": q.status.name if hasattr(q.status, "name") else str(q.status),
                "total": float(q.total),
                "pdf_url": q.pdfUrl,
                "sent_at": q.sentAt.isoformat() if q.sentAt else None,
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
async def send_quotation(org_id: str, quotation_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    updated = await prisma.quotation.update(
        where={"id": quotation_id},
        data={"status": QuotationStatus.SENT, "sentAt": datetime.now(timezone.utc)},
    )
    return {"id": updated.id, "status": updated.status.name, "sent_at": updated.sentAt.isoformat() if updated.sentAt else None}


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
    rel = render_quotation_pdf(
        quotation_id=q.id,
        org_id=q.organizationId,
        number=q.number,
        lines=lines,
        lead_title=q.lead.title if q.lead else "",
        **brand_pdf_kwargs_from_org(q.organization),
    )
    await prisma.quotation.update(where={"id": quotation_id}, data={"pdfUrl": rel})
    return rel


@router.post("/orgs/{org_id}/quotations/{quotation_id}/generate-pdf")
async def generate_pdf(org_id: str, quotation_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": ctx.organization_id},
    )
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    await prisma.quotation.update(where={"id": quotation_id}, data={"pdfJobId": "queued"})
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await pool.enqueue_job("generate_quotation_pdf_job", quotation_id)
        await pool.close()
        return {"status": "queued", "quotation_id": quotation_id}
    except Exception as e:  # noqa: BLE001
        logger.warning("ARQ enqueue failed, generating inline: %s", e)
        rel = await _run_pdf_generation(quotation_id)
        return {"status": "completed", "pdf_url": rel}


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
    return FileResponse(path, filename=f"{q.number}.pdf", media_type="application/pdf")
