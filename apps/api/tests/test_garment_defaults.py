"""Default garment mockup registry, detection, and recolor (no AI)."""

from loomrun_api.garment_defaults import (
    catalog_garment_type,
    default_views_for_product,
    normalize_hex_color,
    normalize_product_type,
    resolve_product_type_from_text,
)
from loomrun_api.garment_recolor import colored_template_png


def test_normalize_product_type():
    assert normalize_product_type("polo_t_shirt") == "POLO_T_SHIRT"
    assert normalize_product_type("POLO") == "POLO_T_SHIRT"
    assert normalize_product_type("TSHIRT") == "T_SHIRT"
    assert normalize_product_type("nope") is None


def test_resolve_from_product_names():
    assert resolve_product_type_from_text("Men's Polo T-Shirt") == "POLO_T_SHIRT"
    assert resolve_product_type_from_text("Cotton Shorts") == "SHORTS"
    assert resolve_product_type_from_text("Denim Trousers") == "PANTS"
    assert resolve_product_type_from_text("Classic Hoodie") == "HOODIE"
    assert resolve_product_type_from_text("Round Neck Tee") == "T_SHIRT"
    assert resolve_product_type_from_text("Custom Job #12") is None


def test_catalog_mapping_and_views():
    assert catalog_garment_type("POLO_T_SHIRT") == "POLO"
    assert catalog_garment_type("HOODIE") == "HOODIE"
    views = default_views_for_product("POLO_T_SHIRT")
    assert {v["view"] for v in views} >= {"FRONT", "BACK", "LEFT", "RIGHT"}
    by_view = {v["view"]: v["template_key"] for v in views}
    assert by_view["FRONT"] == "polo_front"
    assert by_view["BACK"] == "polo_back"
    assert by_view["LEFT"] == "polo_left"
    assert by_view["RIGHT"] == "polo_right"


def test_normalize_hex():
    assert normalize_hex_color("1e3a5f") == "#1E3A5F"
    assert normalize_hex_color("#ffffff") == "#FFFFFF"


def test_recolor_template_returns_png():
    from loomrun_api.garment_recolor import clear_recolor_cache

    clear_recolor_cache()
    white = colored_template_png("polo_front", "#FFFFFF")
    navy = colored_template_png("polo_front", "#1E3A5F")
    assert white[:8] == b"\x89PNG\r\n\x1a\n"
    assert navy[:8] == b"\x89PNG\r\n\x1a\n"
    assert white != navy
    # White garments must stay light (not black/grey from dark templates)
    from PIL import Image
    import io

    im = Image.open(io.BytesIO(white)).convert("RGBA")
    px = im.load()
    w, h = im.size
    samples = []
    for y in range(h // 3, 2 * h // 3, 10):
        for x in range(w // 3, 2 * w // 3, 10):
            r, g, b, a = px[x, y]
            if a > 200 and not (r > 250 and g > 250 and b > 250):
                samples.append((r + g + b) / 3)
    assert samples
    assert sum(samples) / len(samples) > 180
