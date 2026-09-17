"""Shared view-type vocabulary for production design assets / mockups."""

from __future__ import annotations

DESIGN_KINDS = frozenset({"SOURCE", "DESIGN"})

VIEW_TYPES: list[tuple[str, str]] = [
    ("FRONT", "Front"),
    ("BACK", "Back"),
    ("LEFT_SLEEVE", "Left Sleeve"),
    ("RIGHT_SLEEVE", "Right Sleeve"),
    ("COLLAR", "Collar"),
    ("LOGO_ARTWORK", "Logo / Artwork"),
    ("FABRIC_TEXTURE", "Fabric / Texture"),
    ("DETAIL", "Detail"),
    ("OTHER", "Other"),
]

VIEW_TYPE_KEYS = frozenset(k for k, _ in VIEW_TYPES)
VIEW_TYPE_LABELS = dict(VIEW_TYPES)

# Generated TEMPLATE_2D mockups use FRONT / BACK — map into our vocabulary.
MOCKUP_VIEW_TO_VIEW_TYPE = {
    "FRONT": "FRONT",
    "BACK": "BACK",
}


def normalize_view_type(raw: str | None) -> str | None:
    if raw is None:
        return None
    key = str(raw).strip().upper().replace(" ", "_").replace("-", "_")
    if not key:
        return None
    if key not in VIEW_TYPE_KEYS:
        raise ValueError(f"Invalid view type: {raw}")
    return key


def normalize_kind(raw: str | None, *, default: str = "SOURCE") -> str:
    key = (raw or default).strip().upper()
    if key not in DESIGN_KINDS:
        raise ValueError(f"Invalid design kind: {raw}")
    return key
