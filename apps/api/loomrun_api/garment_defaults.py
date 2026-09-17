"""Default garment mockup registry + product-name → garment type resolver.

Maps LoomRun Design product types onto the existing TEMPLATE_2D PNG catalog
(mockup_templates/catalog.json). No AI image generation.
"""

from __future__ import annotations

import re
from typing import Any

# Product types shown in the Design UI (stable API values).
PRODUCT_TYPES: list[tuple[str, str]] = [
    ("T_SHIRT", "T-Shirt"),
    ("POLO_T_SHIRT", "Polo T-Shirt"),
    ("SHIRT", "Shirt"),
    ("PANTS", "Pants / Trousers"),
    ("SHORTS", "Shorts"),
    ("HOODIE", "Hoodie"),
    ("SWEATSHIRT", "Sweatshirt"),
    ("JACKET", "Jacket"),
    ("OTHER", "Other"),
]

PRODUCT_TYPE_KEYS = frozenset(k for k, _ in PRODUCT_TYPES)

# Maps Design product type → catalog garment_type used by mockup_compose.
# Types without dedicated assets fall back to the closest existing template.
CATALOG_GARMENT_FOR_PRODUCT: dict[str, str] = {
    "T_SHIRT": "TSHIRT",
    "POLO_T_SHIRT": "POLO",
    "SHIRT": "SHIRT",
    "PANTS": "PANT",
    "SHORTS": "SHORTS",
    "HOODIE": "HOODIE",
    "SWEATSHIRT": "HOODIE",
    "JACKET": "HOODIE",
    "OTHER": "TSHIRT",
}

DEFAULT_VIEWS = ("FRONT", "BACK", "LEFT", "RIGHT")
VIEW_LABELS = {
    "FRONT": "Front",
    "BACK": "Back",
    "LEFT": "Left",
    "RIGHT": "Right",
}

# Keyword patterns → product type (first match wins; order matters).
_DETECT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bpolo\b", re.I), "POLO_T_SHIRT"),
    (re.compile(r"\bhoodie\b|\bhoody\b", re.I), "HOODIE"),
    (re.compile(r"\bsweat\s*shirt\b|\bsweatshirt\b", re.I), "SWEATSHIRT"),
    (re.compile(r"\bjacket\b|\bblazer\b", re.I), "JACKET"),
    (re.compile(r"\bshorts?\b", re.I), "SHORTS"),
    (re.compile(r"\bpants?\b|\btrousers?\b|\bdenim\b|\bjeans?\b", re.I), "PANTS"),
    (re.compile(r"\bt[\s-]?shirts?\b|\btee\b", re.I), "T_SHIRT"),
    (re.compile(r"\bshirts?\b", re.I), "SHIRT"),
]

_HEX_RE = re.compile(r"^#?[0-9A-Fa-f]{6}$")


def normalize_product_type(raw: str | None) -> str | None:
    if not raw:
        return None
    key = str(raw).strip().upper().replace("-", "_").replace(" ", "_")
    if key in PRODUCT_TYPE_KEYS:
        return key
    # Accept catalog garment names too
    aliases = {
        "TSHIRT": "T_SHIRT",
        "TSHIRTS": "T_SHIRT",
        "POLO": "POLO_T_SHIRT",
        "PANT": "PANTS",
        "PANTS": "PANTS",
        "SHORT": "SHORTS",
        "SHORTS": "SHORTS",
    }
    return aliases.get(key)


def catalog_garment_type(product_type: str) -> str:
    pt = normalize_product_type(product_type) or "OTHER"
    return CATALOG_GARMENT_FOR_PRODUCT.get(pt, "TSHIRT")


def resolve_product_type_from_text(*parts: str | None) -> str | None:
    """Best-effort detect garment type from order/product naming text."""
    blob = " ".join(p for p in parts if p).strip()
    if not blob:
        return None
    for pattern, product_type in _DETECT_PATTERNS:
        if pattern.search(blob):
            return product_type
    return None


def normalize_hex_color(raw: str | None, *, default: str = "#FFFFFF") -> str:
    if not raw or not str(raw).strip():
        return default
    c = str(raw).strip()
    if not c.startswith("#"):
        c = f"#{c}"
    if not _HEX_RE.match(c):
        raise ValueError(f"Invalid colour: {raw}")
    return c.upper()


def parse_hex_rgb(color: str) -> tuple[int, int, int]:
    c = normalize_hex_color(color)
    return int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)


def list_product_types() -> list[dict[str, Any]]:
    return [{"value": k, "label": lab} for k, lab in PRODUCT_TYPES]


def default_views_for_product(product_type: str) -> list[dict[str, str]]:
    """Describe Front/Back/Left/Right template keys for a product type."""
    from loomrun_api import mockup_compose

    gt = catalog_garment_type(product_type)
    items: list[dict[str, str]] = []
    for view in DEFAULT_VIEWS:
        tmpl = mockup_compose.get_template(gt, view)
        if not tmpl:
            continue
        items.append(
            {
                "view": view,
                "template_key": tmpl["key"],
                "label": VIEW_LABELS.get(view, view.title()),
                "garment_type": gt,
            }
        )
    return items
