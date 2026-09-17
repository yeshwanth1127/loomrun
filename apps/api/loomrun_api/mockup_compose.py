"""2D garment mockup compositing (TEMPLATE_2D engine)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from PIL import Image

TEMPLATES_DIR = Path(__file__).resolve().parent / "mockup_templates"
_CATALOG_CACHE: dict[str, Any] | None = None
_CATALOG_MTIME: float | None = None

VALID_ENGINES = frozenset({"TEMPLATE_2D"})
# AI reserved for a later worker; reject until wired.
SUPPORTED_ENGINES = frozenset({"TEMPLATE_2D"})


def templates_dir() -> Path:
    return TEMPLATES_DIR


def load_catalog() -> dict[str, Any]:
    """Load catalog.json; reload when the file changes so template updates apply without restart."""
    global _CATALOG_CACHE, _CATALOG_MTIME
    path = TEMPLATES_DIR / "catalog.json"
    mtime = path.stat().st_mtime
    if _CATALOG_CACHE is None or _CATALOG_MTIME != mtime:
        raw = path.read_text(encoding="utf-8")
        _CATALOG_CACHE = json.loads(raw)
        _CATALOG_MTIME = mtime
    return _CATALOG_CACHE


def list_templates() -> list[dict[str, Any]]:
    return list(load_catalog().get("templates") or [])


def get_template(garment_type: str, view: str) -> dict[str, Any] | None:
    gt = garment_type.strip().upper()
    vw = view.strip().upper()
    for t in list_templates():
        if t.get("garment_type") == gt and t.get("view") == vw:
            return t
    return None


def get_template_by_key(key: str) -> dict[str, Any] | None:
    for t in list_templates():
        if t.get("key") == key:
            return t
    return None


def template_image_path(template: dict[str, Any]) -> Path:
    name = template.get("image") or ""
    path = TEMPLATES_DIR / name
    if not path.is_file():
        raise FileNotFoundError(f"Template image missing: {name}")
    return path


def normalize_placement(raw: dict[str, Any] | None) -> dict[str, float]:
    """Placement is relative to the print area: x/y center (0–1), scale (0.05–1), rotation degrees."""
    raw = raw or {}
    x = float(raw.get("x", 0.5))
    y = float(raw.get("y", 0.5))
    scale = float(raw.get("scale", 0.55))
    rotation = float(raw.get("rotation", 0.0))
    x = min(1.0, max(0.0, x))
    y = min(1.0, max(0.0, y))
    scale = min(1.0, max(0.05, scale))
    # Keep rotation in a sane range
    while rotation > 180:
        rotation -= 360
    while rotation < -180:
        rotation += 360
    return {"x": x, "y": y, "scale": scale, "rotation": rotation}


def compose_mockup(
    *,
    template: dict[str, Any],
    design_path: Path,
    placement: dict[str, float],
    out_path: Path,
    garment_color: str | None = None,
) -> None:
    """Overlay design onto garment template using normalized print-area placement."""
    tmpl_path = template_image_path(template)
    base = Image.open(tmpl_path).convert("RGBA")
    if garment_color:
        from loomrun_api.garment_recolor import recolor_garment_image

        base = recolor_garment_image(base, garment_color)
    design = Image.open(design_path).convert("RGBA")

    area = template["print_area"]
    ax, ay, aw, ah = int(area["x"]), int(area["y"]), int(area["w"]), int(area["h"])
    if aw <= 0 or ah <= 0:
        raise ValueError("Invalid print area")

    pl = normalize_placement(placement)
    # Target design width as fraction of print-area width
    target_w = max(1, int(aw * pl["scale"]))
    aspect = design.height / max(1, design.width)
    target_h = max(1, int(target_w * aspect))
    # Cap height so oversized tall logos still fit reasonably
    if target_h > ah:
        target_h = ah
        target_w = max(1, int(target_h / aspect))

    design_resized = design.resize((target_w, target_h), Image.Resampling.LANCZOS)
    if abs(pl["rotation"]) > 0.01:
        design_resized = design_resized.rotate(
            -pl["rotation"],
            expand=True,
            resample=Image.Resampling.BICUBIC,
        )

    cx = ax + pl["x"] * aw
    cy = ay + pl["y"] * ah
    paste_x = int(round(cx - design_resized.width / 2))
    paste_y = int(round(cy - design_resized.height / 2))

    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(design_resized, (paste_x, paste_y), design_resized)
    composed = Image.alpha_composite(base, layer)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    composed.convert("RGBA").save(out_path, format="PNG")
