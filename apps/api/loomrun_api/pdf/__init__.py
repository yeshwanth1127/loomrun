"""PDF generation utilities — backward-compatible exports."""

from loomrun_api.pdf.context import brand_paths_from_org, build_render_context, sample_preview_context
from loomrun_api.pdf.renderer import render_preview_pdf, render_quotation_pdf_to_storage


def brand_pdf_kwargs_from_org(org) -> dict:
    """Legacy helper — maps org brand fields to render kwargs."""
    paths = brand_paths_from_org(org)
    issuer = (org.brandLegalName or org.name) if org is not None else ""
    return {
        "issuer_name": issuer,
        "brand_address": org.brandAddress if org is not None else None,
        "brand_phone": org.brandPhone if org is not None else None,
        "brand_email": org.brandEmail if org is not None else None,
        "brand_website": org.brandWebsite if org is not None else None,
        "brand_tax_id": org.brandTaxId if org is not None else None,
        "logo_path": paths["logo_path"],
        "signature_path": paths["signature_path"],
    }


def render_quotation_pdf(
    quotation_id: str,
    org_id: str,
    number: str,
    lines: list[dict],
    lead_title: str,
    *,
    issuer_name: str,
    brand_address: str | None = None,
    brand_phone: str | None = None,
    brand_email: str | None = None,
    brand_website: str | None = None,
    brand_tax_id: str | None = None,
    logo_path: str | None = None,
    signature_path: str | None = None,
    doc_type: str = "Quotation",
    invoice_number: str | None = None,
    layout=None,
    org=None,
    lead=None,
    subtotal: float | None = None,
    tax: float | None = None,
    total: float | None = None,
    upi_qr_path: str | None = None,
    invoiced_at=None,
    created_at=None,
    tax_enabled: bool = False,
    tax_rate: float | None = None,
    version: int | None = None,
) -> str:
    """Write PDF to storage. Uses template layout when provided."""
    from datetime import datetime

    from loomrun_api.document_template_defaults import SYSTEM_TEMPLATES
    from loomrun_api.schemas.document_template import TemplateLayout

    if layout is None:
        slug = "classic-invoice" if doc_type == "Invoice" else "classic-quotation"
        default = next(t for t in SYSTEM_TEMPLATES if t["slug"] == slug)
        layout = TemplateLayout.model_validate(default["layout"])
    elif not isinstance(layout, TemplateLayout):
        layout = TemplateLayout.model_validate(layout)

    computed_subtotal = subtotal if subtotal is not None else sum(l.get("line_total", 0) for l in lines)
    computed_tax = tax if tax is not None else 0.0
    computed_total = total if total is not None else computed_subtotal + computed_tax

    if org is not None and lead is not None:
        context = build_render_context(
            org=org,
            lead=lead,
            quotation_number=number,
            lines=lines,
            subtotal=computed_subtotal,
            tax=computed_tax,
            total=computed_total,
            doc_type=doc_type,
            invoice_number=invoice_number,
            layout=layout,
            invoiced_at=invoiced_at,
            created_at=created_at,
            tax_enabled=tax_enabled,
            tax_rate=tax_rate,
            version=version,
        )
    else:
        tax_label_extra = ""
        if tax_enabled and tax_rate is not None:
            tax_label_extra = f" ({float(tax_rate):g}%)"
        context = {
            "org": {
                "name": issuer_name,
                "legal_name": issuer_name,
                "address": brand_address,
                "phone": brand_phone,
                "email": brand_email,
                "website": brand_website,
                "tax_id": brand_tax_id,
            },
            "lead": {"title": lead_title, "company": None, "phone": None, "email": None},
            "quotation": {
                "number": number,
                "invoice_number": invoice_number,
                "date": datetime.now().strftime("%d %b %Y"),
                "subtotal": computed_subtotal,
                "tax": computed_tax,
                "total": computed_total,
                "tax_enabled": tax_enabled,
                "tax_rate": tax_rate,
                "tax_label_extra": tax_label_extra,
                "version": version,
            },
            "lines": lines,
            "doc_type": doc_type,
            "currency": layout.theme.currency_symbol,
            "logo_path": logo_path,
            "signature_path": signature_path,
            "upi_qr_path": upi_qr_path,
        }

    return render_quotation_pdf_to_storage(
        quotation_id=quotation_id,
        org_id=org_id,
        layout=layout,
        context=context,
    )
