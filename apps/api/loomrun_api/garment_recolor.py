"""Recolor existing TEMPLATE_2D PNG garments for default Design mockups."""

from __future__ import annotations

import io
from functools import lru_cache
from statistics import mean, pstdev

from PIL import Image

from loomrun_api.garment_defaults import parse_hex_rgb
from loomrun_api import mockup_compose


def recolor_garment_image(im: Image.Image, color: str) -> Image.Image:
    """Tint garment fabric to `color` while preserving subtle fold shading.

    Templates are often dark-base garments on a near-white canvas. We replace
    fabric colour (not multiply dark×target, which made White look black) and
    composite onto an opaque white canvas so transparent gaps don't read as black.
    """
    cr, cg, cb = parse_hex_rgb(color)
    src = im.convert("RGBA")
    w, h = src.size
    pixels = src.load()

    fabric: list[tuple[int, int, float, int]] = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a < 12:
                continue
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            # Near-white baked backgrounds
            if lum > 0.94:
                continue
            fabric.append((x, y, lum, a))

    # Opaque white canvas — avoids "black shirt" on dark UI from transparency
    out = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    out_px = out.load()
    if not fabric:
        return out

    lums = [p[2] for p in fabric]
    avg = mean(lums)
    std = max(0.04, pstdev(lums) if len(lums) > 1 else 0.04)

    for x, y, lum, a in fabric:
        # Relative fold shading around the fabric average (gentle)
        t = (lum - avg) / (2.5 * std)
        t = -1.0 if t < -1 else 1.0 if t > 1 else t
        # Base stays close to the chosen colour; folds slightly darker/lighter
        shade = 0.88 + 0.12 * t
        if shade < 0.55:
            shade = 0.55
        if shade > 1.08:
            shade = 1.08
        out_px[x, y] = (
            min(255, int(cr * shade)),
            min(255, int(cg * shade)),
            min(255, int(cb * shade)),
            255,
        )
    return out


# Back-compat alias used by older imports/tests
_recolor_rgba = recolor_garment_image


@lru_cache(maxsize=128)
def colored_template_png(template_key: str, color: str) -> bytes:
    tmpl = mockup_compose.get_template_by_key(template_key)
    if not tmpl:
        raise FileNotFoundError(f"Unknown template: {template_key}")
    path = mockup_compose.template_image_path(tmpl)
    im = Image.open(path)
    colored = recolor_garment_image(im, color)
    buf = io.BytesIO()
    colored.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def clear_recolor_cache() -> None:
    colored_template_png.cache_clear()
