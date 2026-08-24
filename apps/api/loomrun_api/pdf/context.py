from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loomrun_api.config import settings
from loomrun_api.schemas.document_template import TemplateLayout


def brand_paths_from_org(org) -> dict[str, str | None]:
    logo_path = None
    signature_path = None
    upi_qr_path = None
    if org is not None:
        if org.brandLogoUrl:
            p = settings.storage_dir / org.brandLogoUrl
            if p.is_file():
                logo_path = str(p)
        if org.brandSignatureUrl:
            p = settings.storage_dir / org.brandSignatureUrl
            if p.is_file():
                signature_path = str(p)
        if org.brandUpiQrUrl:
            p = settings.storage_dir / org.brandUpiQrUrl
            if p.is_file():
                upi_qr_path = str(p)
    return {
        "logo_path": logo_path,
        "signature_path": signature_path,
        "upi_qr_path": upi_qr_path,
    }


def _format_doc_date(value: datetime | None) -> str:
    if value is None:
        return datetime.now(timezone.utc).strftime("%d %b %Y")
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%d %b %Y")


def build_render_context(
    *,
    org,
    lead,
    quotation_number: str,
    lines: list[dict],
    subtotal: float,
    tax: float,
    total: float,
    doc_type: str,
    invoice_number: str | None = None,
    layout: TemplateLayout | dict | None = None,
    invoiced_at: datetime | None = None,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    paths = brand_paths_from_org(org)
    issuer = (org.brandLegalName or org.name) if org is not None else ""
    currency = "₹"
    theme_primary = "#111827"
    theme_accent = "#374151"
    if layout is not None:
        theme = layout.theme if hasattr(layout, "theme") else layout.get("theme", {})
        currency = theme.currency_symbol if hasattr(theme, "currency_symbol") else theme.get("currencySymbol", "₹")
        theme_primary = theme.primary_color if hasattr(theme, "primary_color") else theme.get("primaryColor", theme_primary)
        theme_accent = theme.accent_color if hasattr(theme, "accent_color") else theme.get("accentColor", theme_accent)

    if doc_type == "Invoice":
        document_date = _format_doc_date(invoiced_at)
    else:
        document_date = _format_doc_date(created_at)

    return {
        "org": {
            "name": org.name if org else "",
            "legal_name": issuer,
            "address": org.brandAddress if org else None,
            "phone": org.brandPhone if org else None,
            "email": org.brandEmail if org else None,
            "website": org.brandWebsite if org else None,
            "tax_id": org.brandTaxId if org else None,
            "bank_name": getattr(org, "brandBankName", None) if org else None,
            "bank_account_number": getattr(org, "brandBankAccountNumber", None) if org else None,
            "bank_account_name": getattr(org, "brandBankAccountName", None) if org else None,
            "bank_ifsc": getattr(org, "brandBankIfsc", None) if org else None,
            "bank_swift": getattr(org, "brandBankSwift", None) if org else None,
            "bank_ad_code": getattr(org, "brandBankAdCode", None) if org else None,
            "bank_branch": getattr(org, "brandBankBranch", None) if org else None,
        },
        "lead": {
            "title": lead.title if lead else "",
            "company": lead.company if lead else None,
            "phone": lead.phone if lead else None,
            "email": lead.email if lead else None,
            "city": getattr(lead, "city", None) if lead else None,
        },
        "quotation": {
            "number": quotation_number,
            "invoice_number": invoice_number,
            "date": document_date,
            "subtotal": subtotal,
            "tax": tax,
            "total": total,
            "total_formatted": f"{currency}{total:,.2f}",
            "subtotal_formatted": f"{currency}{subtotal:,.2f}",
            "tax_formatted": f"{currency}{tax:,.2f}",
        },
        "lines": lines,
        "doc_type": doc_type,
        "currency": currency,
        "theme": {"primary_color": theme_primary, "accent_color": theme_accent},
        **paths,
    }


def sample_preview_context() -> dict[str, Any]:
    return build_render_context(
        org=type("Org", (), {
            "name": "Acme Manufacturing",
            "brandLegalName": "Acme Manufacturing Pvt Ltd",
            "brandAddress": "123 Industrial Area\nMumbai, MH 400001",
            "brandPhone": "+91 98765 43210",
            "brandEmail": "sales@acme.example",
            "brandWebsite": "https://acme.example",
            "brandTaxId": "27AABCU9603R1ZM",
            "brandLogoUrl": None,
            "brandSignatureUrl": None,
            "brandUpiQrUrl": None,
        })(),
        lead=type("Lead", (), {
            "title": "Rajesh Kumar",
            "company": "Kumar Textiles",
            "phone": "+91 91234 56789",
            "email": "rajesh@kumar.example",
            "city": "Hyderabad",
        })(),
        quotation_number="Q-2026-00001",
        lines=[
            {"description": "Custom polo shirts (100% cotton)", "quantity": 500, "unit_price": 450, "line_total": 225000, "sku": "POLO-001", "hsn": "6109"},
            {"description": "Screen printing (2 colors)", "quantity": 500, "unit_price": 35, "line_total": 17500, "sku": "PRINT-2C", "hsn": "9988"},
            {"description": "Delivery & packaging", "quantity": 1, "unit_price": 2500, "line_total": 2500, "sku": "DEL", "hsn": "9965"},
        ],
        subtotal=245000,
        tax=0,
        total=245000,
        doc_type="Quotation",
        invoice_number=None,
    )
