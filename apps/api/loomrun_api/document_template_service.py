from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, status

from loomrun_api.document_template_defaults import SYSTEM_TEMPLATES
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.schemas.document_template import TemplateLayout
from prisma.enums import DocumentType


def layout_from_json(data: Any) -> TemplateLayout:
    if isinstance(data, str):
        data = json.loads(data)
    if isinstance(data, dict):
        data = normalize_layout_dict(data)
    return TemplateLayout.model_validate(data)


def normalize_layout_dict(layout: dict) -> dict:
    """Ensure layout JSON always uses camelCase keys expected by the designer UI."""
    out = dict(layout)
    page = dict(out.get("page") or {})
    out["page"] = {
        "size": page.get("size") or "letter",
        "margin": page.get("margin", 40),
    }

    theme = dict(out.get("theme") or {})
    out["theme"] = {
        "primaryColor": theme.get("primaryColor") or theme.get("primary_color") or "#111827",
        "accentColor": theme.get("accentColor") or theme.get("accent_color") or "#374151",
        "fontFamily": theme.get("fontFamily") or theme.get("font_family") or "Helvetica",
        "currencySymbol": theme.get("currencySymbol") or theme.get("currency_symbol") or "₹",
    }
    return out


def serialize_template(t) -> dict:
    doc_type = t.docType.name if hasattr(t.docType, "name") else str(t.docType)
    raw_layout = t.layout if isinstance(t.layout, dict) else json.loads(t.layout)
    return {
        "id": t.id,
        "organization_id": t.organizationId,
        "name": t.name,
        "slug": t.slug,
        "doc_type": doc_type,
        "is_default": t.isDefault,
        "is_system": t.isSystem,
        "layout": normalize_layout_dict(raw_layout),
        "created_at": t.createdAt.isoformat(),
        "updated_at": t.updatedAt.isoformat(),
    }


async def ensure_system_templates() -> None:
    for tmpl in SYSTEM_TEMPLATES:
        clash = await prisma.documenttemplate.find_first(
            where={"organizationId": None, "slug": tmpl["slug"], "docType": DocumentType[tmpl["doc_type"]]},
        )
        if clash:
            # Keep system templates current when defaults change in code.
            await prisma.documenttemplate.update(
                where={"id": clash.id},
                data={
                    "name": tmpl["name"],
                    "isDefault": True,
                    "isSystem": True,
                    "layout": json_meta(tmpl["layout"]),
                },
            )
        else:
            await prisma.documenttemplate.create(
                data={
                    "name": tmpl["name"],
                    "slug": tmpl["slug"],
                    "docType": DocumentType[tmpl["doc_type"]],
                    "isDefault": True,
                    "isSystem": True,
                    "layout": json_meta(tmpl["layout"]),
                },
            )

    # Opportunistically upgrade org-scoped Classic templates that still match the old classic layout.
    await _upgrade_old_classic_org_templates()
    await _ensure_classic_payment_sections()


def _payment_section_defaults() -> dict[str, Any]:
    from loomrun_api.document_template_defaults import CLASSIC_SECTIONS

    for section in CLASSIC_SECTIONS:
        if section.get("type") == "payment":
            return dict(section)
    return {"type": "payment", "enabled": True, "showUpiQr": True, "paymentNote": ""}


def _patch_payment_section(sections: list[dict]) -> tuple[list[dict], bool]:
    defaults = _payment_section_defaults()
    changed = False
    payment_idx = next((i for i, s in enumerate(sections) if s.get("type") == "payment"), None)
    if payment_idx is None:
        # Insert before signature when possible.
        sig_idx = next((i for i, s in enumerate(sections) if s.get("type") == "signature"), len(sections))
        sections.insert(sig_idx, defaults)
        return sections, True

    payment = dict(sections[payment_idx])
    if not payment.get("enabled"):
        payment["enabled"] = True
        changed = True
    if not payment.get("showUpiQr"):
        payment["showUpiQr"] = True
        changed = True
    if payment != sections[payment_idx]:
        sections[payment_idx] = payment
    return sections, changed


async def _ensure_classic_payment_sections(org_id: str | None = None) -> None:
    where: dict[str, Any] = {
        "isSystem": False,
        "slug": {"in": ["classic-quotation", "classic-invoice"]},
    }
    if org_id:
        where["organizationId"] = org_id

    candidates = await prisma.documenttemplate.find_many(where=where)
    for t in candidates:
        raw = t.layout
        layout = raw if isinstance(raw, dict) else json.loads(raw)
        sections = list(layout.get("sections") or [])
        sections, changed = _patch_payment_section(sections)
        if not changed:
            continue
        layout["sections"] = sections
        await prisma.documenttemplate.update(
            where={"id": t.id},
            data={"layout": json_meta(normalize_layout_dict(layout))},
        )


def _is_old_classic_layout(layout: dict) -> bool:
    try:
        sections = layout.get("sections") or []
        by_type = {s.get("type"): s for s in sections if isinstance(s, dict) and s.get("type")}
        header = by_type.get("header") or {}
        doc_title = by_type.get("doc_title") or {}
        meta = by_type.get("meta") or {}
        bill_to = by_type.get("bill_to") or {}
        line_items = by_type.get("line_items") or {}
        if not (header and doc_title and meta and bill_to and line_items):
            return False
        return (
            header.get("enabled") is True
            and header.get("layout") == "logo_left_company_right"
            and doc_title.get("enabled") is True
            and meta.get("enabled") is True
            and bill_to.get("enabled") is True
            and (line_items.get("columns") == ["description", "qty", "unit_price", "line_total"])
            and ("style" not in line_items)
        )
    except Exception:
        return False


async def _upgrade_old_classic_org_templates() -> None:
    import json

    from loomrun_api.document_template_defaults import SYSTEM_TEMPLATES

    wanted: dict[tuple[str, str], dict] = {}
    for st in SYSTEM_TEMPLATES:
        wanted[(st["slug"], st["doc_type"])] = st["layout"]

    candidates = await prisma.documenttemplate.find_many(
        where={
            "isSystem": False,
            "slug": {"in": ["classic-quotation", "classic-invoice"]},
        }
    )
    for t in candidates:
        raw = t.layout
        layout = raw if isinstance(raw, dict) else json.loads(raw)
        if not _is_old_classic_layout(layout):
            continue
        # Update to current default Classic layouts.
        doc_type = t.docType.name if hasattr(t.docType, "name") else str(t.docType)
        key = (t.slug, doc_type)
        next_layout = wanted.get(key)
        if next_layout:
            await prisma.documenttemplate.update(
                where={"id": t.id},
                data={"layout": json_meta(next_layout)},
            )


async def backfill_org_templates(org_id: str) -> None:
    from loomrun_api.document_template_defaults import seed_org_templates

    count = await prisma.documenttemplate.count(where={"organizationId": org_id})
    if count == 0:
        await seed_org_templates(prisma, org_id)
    await _ensure_classic_payment_sections(org_id=org_id)


async def resolve_template_for_render(
    org_id: str,
    doc_type: str,
    template_id: str | None = None,
    *,
    prefer_quotation_template: bool = False,
):
    doc_enum = DocumentType.INVOICE if doc_type == "Invoice" else DocumentType.QUOTATION

    if template_id:
        tmpl = await prisma.documenttemplate.find_first(
            where={
                "id": template_id,
                "OR": [
                    {"organizationId": org_id},
                    {"organizationId": None, "isSystem": True},
                ],
            },
        )
        if tmpl:
            return tmpl

    org = await prisma.organization.find_unique(where={"id": org_id})
    default_ids: list[str] = []
    if org:
        if prefer_quotation_template and org.defaultQuotationTemplateId:
            default_ids.append(org.defaultQuotationTemplateId)
        if doc_enum == DocumentType.INVOICE and org.defaultInvoiceTemplateId:
            if org.defaultInvoiceTemplateId not in default_ids:
                default_ids.append(org.defaultInvoiceTemplateId)
        elif doc_enum == DocumentType.QUOTATION and org.defaultQuotationTemplateId:
            if org.defaultQuotationTemplateId not in default_ids:
                default_ids.append(org.defaultQuotationTemplateId)

        for default_id in default_ids:
            tmpl = await prisma.documenttemplate.find_first(
                where={"id": default_id, "organizationId": org_id},
            )
            if tmpl:
                return tmpl

    slug_candidates = []
    if prefer_quotation_template:
        slug_candidates.append("classic-quotation")
    slug_candidates.append("classic-invoice" if doc_enum == DocumentType.INVOICE else "classic-quotation")

    for slug in slug_candidates:
        tmpl = await prisma.documenttemplate.find_first(
            where={"organizationId": org_id, "slug": slug},
        )
        if tmpl:
            return tmpl

    slug = slug_candidates[-1]
    return await prisma.documenttemplate.find_first(
        where={"organizationId": None, "slug": slug, "isSystem": True},
    )


async def get_template_or_404(org_id: str, template_id: str, *, allow_system: bool = True):
    where: dict = {"id": template_id}
    if allow_system:
        where["OR"] = [{"organizationId": org_id}, {"organizationId": None, "isSystem": True}]
    else:
        where["organizationId"] = org_id
    tmpl = await prisma.documenttemplate.find_first(where=where)
    if not tmpl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Template not found")
    return tmpl


async def assert_can_delete(org_id: str, tmpl) -> None:
    if tmpl.isSystem:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="System templates cannot be deleted")
    org = await prisma.organization.find_unique(where={"id": org_id})
    if org and tmpl.id in (org.defaultQuotationTemplateId, org.defaultInvoiceTemplateId):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unset default template before deleting")
    in_use = await prisma.quotation.count(where={"templateId": tmpl.id})
    if in_use:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Template is used by quotations")
