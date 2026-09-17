"""Tests for design view-type helpers."""

import pytest

from loomrun_api.design_views import normalize_kind, normalize_view_type


def test_normalize_view_type_accepts_canonical():
    assert normalize_view_type("FRONT") == "FRONT"
    assert normalize_view_type("left_sleeve") == "LEFT_SLEEVE"
    assert normalize_view_type("LOGO_ARTWORK") == "LOGO_ARTWORK"
    assert normalize_view_type("fabric-texture") == "FABRIC_TEXTURE"


def test_normalize_view_type_rejects_unknown():
    with pytest.raises(ValueError):
        normalize_view_type("SLEEVE_ONLY")


def test_normalize_kind():
    assert normalize_kind("source") == "SOURCE"
    assert normalize_kind("DESIGN") == "DESIGN"
    with pytest.raises(ValueError):
        normalize_kind("TECHPACK")


def test_view_type_optional_none():
    assert normalize_view_type(None) is None
    assert normalize_view_type("") is None
