from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.document_template_defaults import seed_org_templates
from loomrun_api.document_template_service import (
    assert_can_delete,
    backfill_org_templates,
    get_template_or_404,
    serialize_template,
)
from loomrun_api.pdf.context import sample_preview_context
from loomrun_api.pdf.renderer import render_preview_pdf
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.schemas.document_template import (
    TemplateCloneBody,
    TemplateCreateBody,
    TemplatePreviewBody,
    TemplateUpdateBody,
)
from prisma.enums import DocumentType

router = APIRouter()


@router.get("/orgs/{org_id}/document-templates")
async def list_templates(
    org_id: str,
    doc_type: str | None = Query(None, pattern="^(QUOTATION|INVOICE)$"),
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES", "TELECALLER")),
) -> dict:
    await backfill_org_templates(ctx.organization_id)
    where_org: dict = {"organizationId": ctx.organization_id}
    where_system: dict = {"organizationId": None, "isSystem": True}
    if doc_type:
        where_org["docType"] = DocumentType[doc_type]
        where_system["docType"] = DocumentType[doc_type]
    org_items = await prisma.documenttemplate.find_many(
        where=where_org,
        order={"docType": "asc"},
    )
    system_items = await prisma.documenttemplate.find_many(
        where=where_system,
        order={"slug": "asc"},
    )
    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    return {
        "items": [serialize_template(t) for t in org_items],
        "system_defaults": [serialize_template(t) for t in system_items],
        "default_quotation_template_id": org.defaultQuotationTemplateId if org else None,
        "default_invoice_template_id": org.defaultInvoiceTemplateId if org else None,
    }


@router.get("/orgs/{org_id}/document-templates/{template_id}")
async def get_template(
    org_id: str,
    template_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    tmpl = await get_template_or_404(ctx.organization_id, template_id)
    return serialize_template(tmpl)


@router.post("/orgs/{org_id}/document-templates", status_code=status.HTTP_201_CREATED)
async def create_template(
    org_id: str,
    body: TemplateCreateBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    clash = await prisma.documenttemplate.find_first(
        where={
            "organizationId": ctx.organization_id,
            "slug": body.slug,
            "docType": DocumentType[body.doc_type],
        },
    )
    if clash:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Slug already exists for this document type")
    tmpl = await prisma.documenttemplate.create(
        data={
            "organizationId": ctx.organization_id,
            "name": body.name,
            "slug": body.slug,
            "docType": DocumentType[body.doc_type],
            "layout": json_meta(json.loads(body.layout.model_dump_json(by_alias=True))),
        },
    )
    return serialize_template(tmpl)


@router.post("/orgs/{org_id}/document-templates/clone", status_code=status.HTTP_201_CREATED)
async def clone_template(
    org_id: str,
    body: TemplateCloneBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    source = await get_template_or_404(ctx.organization_id, body.source_template_id)
    clash = await prisma.documenttemplate.find_first(
        where={
            "organizationId": ctx.organization_id,
            "slug": body.slug,
            "docType": source.docType,
        },
    )
    if clash:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Slug already exists for this document type")
    layout = source.layout if isinstance(source.layout, dict) else json.loads(source.layout)
    tmpl = await prisma.documenttemplate.create(
        data={
            "organizationId": ctx.organization_id,
            "name": body.name,
            "slug": body.slug,
            "docType": source.docType,
            "layout": json_meta(layout),
        },
    )
    return serialize_template(tmpl)


@router.patch("/orgs/{org_id}/document-templates/{template_id}")
async def update_template(
    org_id: str,
    template_id: str,
    body: TemplateUpdateBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    tmpl = await get_template_or_404(ctx.organization_id, template_id, allow_system=False)
    if tmpl.isSystem:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="System templates are read-only; clone first")
    data: dict = {}
    if body.name is not None:
        data["name"] = body.name
    if body.layout is not None:
        data["layout"] = json_meta(json.loads(body.layout.model_dump_json(by_alias=True)))
    updated = await prisma.documenttemplate.update(where={"id": template_id}, data=data)
    return serialize_template(updated)


@router.delete("/orgs/{org_id}/document-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    org_id: str,
    template_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> None:
    tmpl = await get_template_or_404(ctx.organization_id, template_id, allow_system=False)
    await assert_can_delete(ctx.organization_id, tmpl)
    await prisma.documenttemplate.delete(where={"id": template_id})


@router.post("/orgs/{org_id}/document-templates/{template_id}/set-default")
async def set_default_template(
    org_id: str,
    template_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    tmpl = await get_template_or_404(ctx.organization_id, template_id, allow_system=False)
    doc_type = tmpl.docType.name if hasattr(tmpl.docType, "name") else str(tmpl.docType)
    await prisma.documenttemplate.update_many(
        where={"organizationId": ctx.organization_id, "docType": tmpl.docType},
        data={"isDefault": False},
    )
    await prisma.documenttemplate.update(where={"id": template_id}, data={"isDefault": True})
    org_data: dict = {}
    if doc_type == "QUOTATION":
        org_data["defaultQuotationTemplateId"] = template_id
    else:
        org_data["defaultInvoiceTemplateId"] = template_id
    await prisma.organization.update(where={"id": ctx.organization_id}, data=org_data)
    return {"status": "ok", "default_template_id": template_id, "doc_type": doc_type}


@router.post("/orgs/{org_id}/document-templates/preview")
async def preview_template(
    org_id: str,
    body: TemplatePreviewBody,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> Response:
    org = await prisma.organization.find_unique(where={"id": ctx.organization_id})
    context = sample_preview_context()
    if org:
        from loomrun_api.pdf.context import build_render_context

        context = build_render_context(
            org=org,
            lead=type("Lead", (), {
                "title": "Rajesh Kumar",
                "company": "Kumar Textiles",
                "phone": "+91 91234 56789",
                "email": "rajesh@kumar.example",
            })(),
            quotation_number="Q-2026-00001",
            lines=context["lines"],
            subtotal=245000,
            tax=0,
            total=245000,
            doc_type="Invoice" if body.doc_type == "INVOICE" else "Quotation",
            invoice_number="INV-2026-00001" if body.doc_type == "INVOICE" else None,
            layout=body.layout,
        )
    pdf_bytes = render_preview_pdf(body.layout, context)
    return Response(content=pdf_bytes, media_type="application/pdf")


@router.post("/orgs/{org_id}/document-templates/backfill")
async def backfill_templates(
    org_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    await seed_org_templates(prisma, ctx.organization_id)
    return {"status": "ok"}
