"""Smoke tests for 2D garment mockup compositing."""

from pathlib import Path

from PIL import Image

from loomrun_api import mockup_compose


def test_catalog_has_expected_garments():
    items = mockup_compose.list_templates()
    keys = {t["key"] for t in items}
    for expected in (
        "tshirt_front",
        "tshirt_back",
        "tshirt_left",
        "tshirt_right",
        "polo_front",
        "polo_back",
        "polo_left",
        "polo_right",
        "shirt_left",
        "hoodie_left",
        "pant_front",
        "pant_back",
        "pant_left",
        "shorts_front",
        "shorts_back",
        "shorts_right",
        "denim_pant_front",
        "denim_pant_back",
        "denim_shorts_front",
        "denim_shorts_back",
    ):
        assert expected in keys
    for t in items:
        assert Path(mockup_compose.templates_dir() / t["image"]).is_file()
        pa = t["print_area"]
        assert pa["w"] > 0 and pa["h"] > 0


def test_compose_mockup_writes_png(tmp_path: Path):
    tmpl = mockup_compose.get_template("TSHIRT", "FRONT")
    assert tmpl is not None
    design = tmp_path / "logo.png"
    Image.new("RGBA", (240, 120), (255, 64, 0, 230)).save(design)
    out = tmp_path / "mockup.png"
    mockup_compose.compose_mockup(
        template=tmpl,
        design_path=design,
        placement=mockup_compose.normalize_placement(
            {"x": 0.5, "y": 0.4, "scale": 0.7, "rotation": 12}
        ),
        out_path=out,
    )
    assert out.is_file()
    result = Image.open(out)
    assert result.size == (tmpl["width"], tmpl["height"])


def test_normalize_placement_clamps():
    p = mockup_compose.normalize_placement({"x": 2, "y": -1, "scale": 0.01, "rotation": 400})
    assert p["x"] == 1.0
    assert p["y"] == 0.0
    assert p["scale"] == 0.05
    assert -180 <= p["rotation"] <= 180
