from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from loomrun_api.config import settings


def brand_pdf_kwargs_from_org(org) -> dict:
    """Build kwargs for render_quotation_pdf from a Prisma Organization record."""
    logo_path = None
    if org is not None and org.brandLogoUrl:
        p = settings.storage_dir / org.brandLogoUrl
        if p.is_file():
            logo_path = str(p)
    issuer = (org.brandLegalName or org.name) if org is not None else ""
    return {
        "issuer_name": issuer,
        "brand_address": org.brandAddress if org is not None else None,
        "brand_phone": org.brandPhone if org is not None else None,
        "brand_email": org.brandEmail if org is not None else None,
        "brand_website": org.brandWebsite if org is not None else None,
        "brand_tax_id": org.brandTaxId if org is not None else None,
        "logo_path": logo_path,
    }


def _scale_logo_dims(path: str, max_w: float, max_h: float) -> tuple[float, float]:
    with Image.open(path) as im:
        w, h = im.size
    scale = min(max_w / float(w), max_h / float(h))
    return float(w) * scale, float(h) * scale


def _draw_wrapped_line(c: canvas.Canvas, text: str, x: float, y: float, max_chars: int, leading: float) -> float:
    t = text.strip()
    if not t:
        return y
    while t:
        chunk = t[:max_chars]
        if len(t) > max_chars:
            split = chunk.rfind(" ")
            if split > max_chars // 3:
                chunk = chunk[:split]
                t = t[split:].lstrip()
            else:
                t = t[max_chars:]
        else:
            t = ""
        c.drawString(x, y, chunk)
        y -= leading
    return y


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
) -> str:
    """Write PDF to storage and return relative path token for URL."""
    dest_dir = settings.storage_dir / org_id / "quotations"
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / f"{quotation_id}.pdf"
    c = canvas.Canvas(str(path), pagesize=letter)
    _, height = letter
    top = height - 72
    y = top

    if logo_path and Path(logo_path).is_file():
        try:
            lw, lh = _scale_logo_dims(logo_path, 140, 48)
            img = ImageReader(logo_path)
            c.drawImage(img, 72, y - lh, width=lw, height=lh, mask="auto")
            y = y - lh - 14
        except OSError:
            pass

    c.setFont("Helvetica-Bold", 13)
    c.drawString(72, y, issuer_name[:120])
    y -= 16
    c.setFont("Helvetica", 9)
    addr = brand_address or ""
    if addr:
        for para in addr.splitlines():
            y = _draw_wrapped_line(c, para, 72, y, 85, 11)
            y -= 2
        y -= 4
    meta_lines: list[str] = []
    if brand_phone:
        meta_lines.append(f"Phone: {brand_phone}")
    if brand_email:
        meta_lines.append(f"Email: {brand_email}")
    if brand_website:
        meta_lines.append(f"Web: {brand_website}")
    if brand_tax_id:
        meta_lines.append(f"Tax ID: {brand_tax_id}")
    for m in meta_lines:
        c.drawString(72, y, m[:100])
        y -= 11

    y -= 14
    c.setFont("Helvetica-Bold", 15)
    c.drawString(72, y, "Quotation")
    y -= 22
    c.setFont("Helvetica", 11)
    c.drawString(72, y, f"Quote #: {number}")
    y -= 14
    c.drawString(72, y, f"Lead: {lead_title}")
    y -= 22
    c.setFont("Helvetica-Bold", 11)
    c.drawString(72, y, "Line items")
    y -= 18
    c.setFont("Helvetica", 10)
    for line in lines:
        text = (
            f"{line.get('description', '')}  x{line.get('quantity')} @ {line.get('unit_price')} "
            f"= {line.get('line_total')}"
        )
        y = _draw_wrapped_line(c, text[:220], 72, y, 95, 13)
        y -= 4
        if y < 72:
            c.showPage()
            y = height - 72
    c.save()
    return f"{org_id}/quotations/{quotation_id}.pdf"
