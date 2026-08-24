from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from loomrun_api.pdf.fonts import resolve_pdf_font
from loomrun_api.schemas.document_template import TemplateLayout


PAGE_SIZES = {"letter": letter, "A4": A4}


def scale_image_dims(path: str, max_w: float, max_h: float) -> tuple[float, float]:
    with Image.open(path) as im:
        w, h = im.size
    scale = min(max_w / float(w), max_h / float(h))
    return float(w) * scale, float(h) * scale


@dataclass
class CanvasState:
    c: canvas.Canvas
    w: float
    h: float
    margin: float
    y: float
    font: str
    font_bold: str
    currency: str
    theme_font: str

    @property
    def content_width(self) -> float:
        return self.w - 2 * self.margin

    def ensure_space(self, needed: float) -> None:
        if self.y - needed < 60:
            self.c.showPage()
            self.y = self.h - self.margin
            self.c.setFont(self.font, 10)

    def draw_text(self, x: float, text: str, *, font: str | None = None, size: float = 10, bold: bool = False) -> None:
        family = font or (self.font_bold if bold else self.font)
        self.c.setFont(family, size)
        self.c.drawString(x, self.y, text[:120])

    def move(self, dy: float) -> None:
        self.y -= dy

    def hline(self, x1: float | None = None, x2: float | None = None) -> None:
        self.c.setLineWidth(1)
        self.c.line(x1 or self.margin, self.y, x2 or (self.w - self.margin), self.y)


def create_canvas(path: Path, layout: TemplateLayout) -> CanvasState:
    pagesize = PAGE_SIZES.get(layout.page.size, letter)
    w, h = pagesize
    c = canvas.Canvas(str(path), pagesize=pagesize)
    theme_font = layout.theme.font_family
    font = resolve_pdf_font(theme_font, bold=False)
    font_bold = resolve_pdf_font(theme_font, bold=True)
    return CanvasState(
        c=c,
        w=w,
        h=h,
        margin=layout.page.margin,
        y=h - layout.page.margin,
        font=font,
        font_bold=font_bold,
        currency=layout.theme.currency_symbol,
        theme_font=theme_font,
    )


def draw_image(state: CanvasState, path: str | None, x: float, max_w: float, max_h: float) -> float:
    if not path or not Path(path).is_file():
        return 0
    try:
        iw, ih = scale_image_dims(path, max_w, max_h)
        img = ImageReader(path)
        state.c.drawImage(img, x, state.y - ih, width=iw, height=ih, mask="auto")
        return ih
    except OSError:
        return 0
