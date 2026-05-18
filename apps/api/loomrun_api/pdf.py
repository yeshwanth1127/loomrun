from datetime import datetime
from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

from loomrun_api.config import settings


def brand_pdf_kwargs_from_org(org) -> dict:
    """Build kwargs for render_quotation_pdf from a Prisma Organization record."""
    logo_path = None
    if org is not None and org.brandLogoUrl:
        p = settings.storage_dir / org.brandLogoUrl
        if p.is_file():
            logo_path = str(p)
    signature_path = None
    if org is not None and org.brandSignatureUrl:
        p = settings.storage_dir / org.brandSignatureUrl
        if p.is_file():
            signature_path = str(p)
    issuer = (org.brandLegalName or org.name) if org is not None else ""
    return {
        "issuer_name": issuer,
        "brand_address": org.brandAddress if org is not None else None,
        "brand_phone": org.brandPhone if org is not None else None,
        "brand_email": org.brandEmail if org is not None else None,
        "brand_website": org.brandWebsite if org is not None else None,
        "brand_tax_id": org.brandTaxId if org is not None else None,
        "logo_path": logo_path,
        "signature_path": signature_path,
    }


def _scale_image_dims(path: str, max_w: float, max_h: float) -> tuple[float, float]:
    with Image.open(path) as im:
        w, h = im.size
    scale = min(max_w / float(w), max_h / float(h))
    return float(w) * scale, float(h) * scale


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
) -> str:
    """Write professional PDF to storage and return relative path token for URL."""
    dest_dir = settings.storage_dir / org_id / "quotations"
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / f"{quotation_id}.pdf"

    c = canvas.Canvas(str(path), pagesize=letter)
    w, h = letter
    c.setFont("Helvetica", 10)

    y = h - 40
    margin = 40
    content_width = w - 2 * margin

    # Header with logo
    if logo_path and Path(logo_path).is_file():
        try:
            lw, lh = _scale_image_dims(logo_path, 120, 40)
            img = ImageReader(logo_path)
            c.drawImage(img, margin, y - lh, width=lw, height=lh, mask="auto")
        except OSError:
            pass

    # Company details on right
    c.setFont("Helvetica-Bold", 11)
    c.drawString(w - margin - 150, y, issuer_name[:50])

    y -= 14
    c.setFont("Helvetica", 8)
    details = []
    if brand_address:
        for line in brand_address.split('\n')[:2]:
            details.append(line.strip())
    if brand_phone:
        details.append(f"Phone: {brand_phone}")
    if brand_email:
        details.append(f"Email: {brand_email}")

    for detail in details[:4]:
        if detail:
            c.drawString(w - margin - 200, y, detail[:45])
            y -= 10

    # Document title
    y -= 20
    c.setFont("Helvetica-Bold", 20)
    doc_title = "INVOICE" if doc_type == "Invoice" else "QUOTATION"
    c.drawString(margin, y, doc_title)

    # Document numbers
    y -= 30
    c.setFont("Helvetica", 9)
    c.drawString(margin, y, f"{doc_type} #: {number}")
    y -= 12
    if invoice_number:
        c.drawString(margin, y, f"Invoice #: {invoice_number}")
        y -= 12

    date_str = datetime.now().strftime("%d %b %Y")
    c.drawString(margin, y, f"Date: {date_str}")

    # Bill To
    y -= 25
    c.setFont("Helvetica-Bold", 10)
    c.drawString(margin, y, "Bill To")
    y -= 14
    c.setFont("Helvetica", 9)
    c.drawString(margin, y, lead_title[:80])

    # Table header
    y -= 28
    c.setFont("Helvetica-Bold", 9)
    c.drawString(margin, y, "Description")
    c.drawString(margin + 280, y, "Qty")
    c.drawString(margin + 330, y, "Unit Price")
    c.drawString(margin + 430, y, "Total")

    # Separator line
    y -= 12
    c.setLineWidth(1)
    c.line(margin, y, w - margin, y)

    # Line items
    y -= 14
    c.setFont("Helvetica", 8)
    total_amount = 0

    for line in lines:
        description = line.get('description', '')[:60]
        qty = line.get('quantity', 0)
        unit_price = line.get('unit_price', 0)
        line_total = line.get('line_total', 0)
        total_amount += line_total

        c.drawString(margin, y, description)
        c.drawString(margin + 300, y, f"{qty:.0f}")
        c.drawString(margin + 350, y, f"₹{unit_price:,.2f}")
        c.drawString(margin + 430, y, f"₹{line_total:,.2f}")
        y -= 14

        if y < 80:
            c.showPage()
            y = h - 40

    # Totals section
    y -= 10
    c.setLineWidth(1)
    c.line(margin + 350, y, w - margin, y)

    y -= 16
    c.setFont("Helvetica", 9)
    c.drawString(margin + 350, y, "Subtotal:")
    c.drawString(margin + 430, y, f"₹{total_amount:,.2f}")

    y -= 14
    c.drawString(margin + 350, y, "Tax:")
    c.drawString(margin + 430, y, "₹0.00")

    y -= 14
    c.setFont("Helvetica-Bold", 10)
    c.drawString(margin + 350, y, "Total:")
    c.drawString(margin + 430, y, f"₹{total_amount:,.2f}")

    # Signature section
    y -= 40
    if signature_path and Path(signature_path).is_file():
        try:
            sig_w, sig_h = _scale_image_dims(signature_path, 80, 40)
            sig_img = ImageReader(signature_path)
            c.drawImage(sig_img, margin, y - sig_h, width=sig_w, height=sig_h, mask="auto")
        except OSError:
            pass

    y -= 50
    c.setFont("Helvetica", 8)
    c.drawString(margin, y, "Authorized Signatory")

    c.save()
    return f"{org_id}/quotations/{quotation_id}.pdf"
