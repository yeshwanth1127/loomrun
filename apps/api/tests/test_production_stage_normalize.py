"""Factory stage label/enum normalization used by AI tools and HTTP."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from loomrun_api.services.production import (
    looks_like_production_stage,
    normalize_production_stage,
)


def test_normalize_enum_name():
    assert normalize_production_stage("PROCUREMENT") == "PROCUREMENT"
    assert normalize_production_stage("procurement") == "PROCUREMENT"


def test_normalize_ui_label():
    assert normalize_production_stage("Procurement") == "PROCUREMENT"
    assert normalize_production_stage("Quality Check") == "QC"
    assert normalize_production_stage("Ready to Dispatch") == "READY_DISPATCH"
    assert normalize_production_stage("Fabric Check") == "FABRIC_CHECK"


def test_normalize_empty_is_none():
    assert normalize_production_stage(None) is None
    assert normalize_production_stage("") is None
    assert normalize_production_stage("   ") is None


def test_normalize_unknown_raises():
    with pytest.raises(HTTPException) as exc:
        normalize_production_stage("CONTACTED")
    assert exc.value.status_code == 400


def test_looks_like_production_stage():
    assert looks_like_production_stage("Procurement") is True
    assert looks_like_production_stage("CUTTING") is True
    assert looks_like_production_stage("CONTACTED") is False
    assert looks_like_production_stage("WON") is False
