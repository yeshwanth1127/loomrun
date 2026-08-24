"""Default document template layouts and seed helpers."""

from __future__ import annotations

import json
from typing import Any

from loomrun_api.prisma_json import json_meta

CLASSIC_SECTIONS: list[dict[str, Any]] = [
    {"type": "header", "enabled": True, "layout": "invoice_like", "showTaxId": True},
    {"type": "doc_title", "enabled": False, "customTitle": None},
    {"type": "meta", "enabled": False, "fields": ["number", "date", "invoice_number"]},
    {"type": "bill_to", "enabled": False, "label": "Bill To", "showCompany": True, "showPhone": False, "showEmail": False},
    {
        "type": "line_items",
        "enabled": True,
        "style": "invoice_table",
        "columns": ["sl", "description", "qty", "unit_price", "line_total"],
    },
    {
        "type": "totals",
        "enabled": True,
        "showSubtotal": True,
        "showTax": True,
        "showDiscount": False,
        "taxLabel": "Tax",
    },
    {"type": "payment", "enabled": True, "showUpiQr": True, "paymentNote": ""},
    {"type": "terms", "enabled": False, "text": ""},
    {"type": "signature", "enabled": True, "label": "Authorized Signatory"},
    {"type": "footer", "enabled": False, "text": "", "showPageNumber": False},
]

MINIMAL_SECTIONS: list[dict[str, Any]] = [
    {"type": "header", "enabled": True, "layout": "company_only", "showTaxId": False},
    {"type": "doc_title", "enabled": True, "customTitle": None},
    {"type": "meta", "enabled": True, "fields": ["number", "date"]},
    {"type": "bill_to", "enabled": True, "label": "Bill To", "showCompany": True, "showPhone": False, "showEmail": False},
    {
        "type": "line_items",
        "enabled": True,
        "columns": ["description", "qty", "line_total"],
    },
    {
        "type": "totals",
        "enabled": True,
        "showSubtotal": False,
        "showTax": False,
        "showDiscount": False,
        "taxLabel": "Tax",
    },
    {"type": "payment", "enabled": False, "showUpiQr": False, "paymentNote": ""},
    {"type": "terms", "enabled": False, "text": ""},
    {"type": "signature", "enabled": False, "label": "Authorized Signatory"},
    {"type": "footer", "enabled": False, "text": "", "showPageNumber": False},
]

GST_SECTIONS: list[dict[str, Any]] = [
    {"type": "header", "enabled": True, "layout": "logo_left_company_right", "showTaxId": True},
    {"type": "doc_title", "enabled": True, "customTitle": None},
    {
        "type": "meta",
        "enabled": True,
        "fields": ["number", "date", "invoice_number", "valid_until"],
    },
    {"type": "bill_to", "enabled": True, "label": "Bill To", "showCompany": True, "showPhone": True, "showEmail": False},
    {
        "type": "line_items",
        "enabled": True,
        "columns": ["description", "qty", "unit_price", "line_total", "hsn"],
    },
    {
        "type": "totals",
        "enabled": True,
        "showSubtotal": True,
        "showTax": True,
        "showDiscount": False,
        "taxLabel": "GST",
    },
    {
        "type": "payment",
        "enabled": True,
        "showUpiQr": True,
        "paymentNote": "Scan UPI QR to pay",
    },
    {
        "type": "terms",
        "enabled": True,
        "text": "Prices valid for 15 days. GST as applicable. {{org.legal_name}}",
    },
    {"type": "signature", "enabled": True, "label": "Authorized Signatory"},
    {"type": "footer", "enabled": True, "text": "Thank you for your business", "showPageNumber": False},
]

SYSTEM_TEMPLATES: list[dict[str, Any]] = [
    {
        "slug": "classic-quotation",
        "name": "Classic",
        "doc_type": "QUOTATION",
        "layout": {"page": {"size": "letter", "margin": 40}, "theme": {"primaryColor": "#111827", "accentColor": "#2563eb", "fontFamily": "Helvetica", "currencySymbol": "₹"}, "sections": CLASSIC_SECTIONS},
    },
    {
        "slug": "classic-invoice",
        "name": "Classic Invoice",
        "doc_type": "INVOICE",
        "layout": {"page": {"size": "letter", "margin": 40}, "theme": {"primaryColor": "#111827", "accentColor": "#2563eb", "fontFamily": "Helvetica", "currencySymbol": "₹"}, "sections": CLASSIC_SECTIONS},
    },
    {
        "slug": "minimal-quotation",
        "name": "Minimal",
        "doc_type": "QUOTATION",
        "layout": {"page": {"size": "letter", "margin": 32}, "theme": {"primaryColor": "#111827", "accentColor": "#6B7280", "fontFamily": "Helvetica", "currencySymbol": "₹"}, "sections": MINIMAL_SECTIONS},
    },
    {
        "slug": "gst-india-quotation",
        "name": "GST India",
        "doc_type": "QUOTATION",
        "layout": {"page": {"size": "letter", "margin": 40}, "theme": {"primaryColor": "#1E3A5F", "accentColor": "#374151", "fontFamily": "Helvetica", "currencySymbol": "₹"}, "sections": GST_SECTIONS},
    },
]


def layout_json(layout: dict[str, Any]) -> str:
    return json.dumps(layout)


async def seed_org_templates(prisma, org_id: str) -> tuple[str | None, str | None]:
    """Clone system templates for a new org and set defaults. Returns (quotation_template_id, invoice_template_id)."""
    system_templates = await prisma.documenttemplate.find_many(
        where={"organizationId": None, "isSystem": True},
    )
    if not system_templates:
        return None, None

    q_default_id: str | None = None
    inv_default_id: str | None = None

    for st in system_templates:
        doc_type = st.docType.name if hasattr(st.docType, "name") else str(st.docType)
        created = await prisma.documenttemplate.create(
            data={
                "organizationId": org_id,
                "name": st.name,
                "slug": st.slug,
                "docType": st.docType,
                "isDefault": True,
                "isSystem": False,
                "layout": json_meta(st.layout if isinstance(st.layout, dict) else json.loads(st.layout)),
            },
        )
        if doc_type == "QUOTATION" and st.slug == "classic-quotation":
            q_default_id = created.id
        elif doc_type == "INVOICE" and st.slug == "classic-invoice":
            inv_default_id = created.id

    if q_default_id or inv_default_id:
        await prisma.organization.update(
            where={"id": org_id},
            data={
                "defaultQuotationTemplateId": q_default_id,
                "defaultInvoiceTemplateId": inv_default_id,
            },
        )
    return q_default_id, inv_default_id
