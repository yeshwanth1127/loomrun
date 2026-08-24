"""Register Unicode-capable TTF fonts for PDF rendering (₹ and other glyphs)."""

from __future__ import annotations

from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

_DEJAVU = Path("/usr/share/fonts/truetype/dejavu")

# Theme font family → (regular TTF name, bold TTF name, regular path, bold path)
_FONT_FILES: dict[str, tuple[str, str, Path, Path]] = {
    "Helvetica": (
        "LoomrunSans",
        "LoomrunSans-Bold",
        _DEJAVU / "DejaVuSans.ttf",
        _DEJAVU / "DejaVuSans-Bold.ttf",
    ),
    "Times-Roman": (
        "LoomrunSerif",
        "LoomrunSerif-Bold",
        _DEJAVU / "DejaVuSerif.ttf",
        _DEJAVU / "DejaVuSerif-Bold.ttf",
    ),
    "Courier": (
        "LoomrunMono",
        "LoomrunMono-Bold",
        _DEJAVU / "DejaVuSansMono.ttf",
        _DEJAVU / "DejaVuSansMono-Bold.ttf",
    ),
}

_registered = False


def ensure_pdf_fonts() -> None:
    global _registered
    if _registered:
        return
    for _theme, (regular, bold, regular_path, bold_path) in _FONT_FILES.items():
        if regular_path.is_file() and regular not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(regular, str(regular_path)))
        if bold_path.is_file() and bold not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(bold, str(bold_path)))
    _registered = True


def resolve_pdf_font(theme_family: str, *, bold: bool = False) -> str:
    """Map template theme font to a registered Unicode TTF (falls back to Helvetica)."""
    ensure_pdf_fonts()
    mapping = _FONT_FILES.get(theme_family) or _FONT_FILES["Helvetica"]
    regular, bold_name, regular_path, bold_path = mapping
    if bold:
        if bold_path.is_file():
            return bold_name
        if regular_path.is_file():
            return regular
        return "Helvetica-Bold" if theme_family == "Helvetica" else theme_family
    if regular_path.is_file():
        return regular
    return theme_family
