"""Unit tests for token-weighted AI credits and weekly window math."""

from datetime import datetime, timedelta, timezone

from loomrun_api.ai_usage import (
    DEFAULT_ESTIMATED_CREDITS,
    ai_usage_bypassed,
    credits_from_tokens,
    parse_usage_dict,
    weekly_period_bounds,
)
from loomrun_api.config import settings


def test_ai_usage_bypassed_respects_allowlist(monkeypatch):
    monkeypatch.setattr(
        settings, "ai_usage_bypass_org_ids", "org_a, org_b"
    )
    assert ai_usage_bypassed("org_a") is True
    assert ai_usage_bypassed("org_b") is True
    assert ai_usage_bypassed("org_c") is False


def test_credits_from_tokens_minimum_and_weighting():
    assert credits_from_tokens(0, 0) == DEFAULT_ESTIMATED_CREDITS
    assert credits_from_tokens(100, 0) == 1
    # 1000 prompt → 1; 1000 completion → 3 effective → ceil(3)=3? wait (0+3000)/1000=3
    assert credits_from_tokens(0, 1000) == 3
    # 500 + 3*500 = 2000 → 2
    assert credits_from_tokens(500, 500) == 2
    # Heavy tool turn
    assert credits_from_tokens(12_000, 4_000) == 24


def test_parse_usage_dict_aliases():
    assert parse_usage_dict(None) == (0, 0)
    assert parse_usage_dict({"prompt_tokens": 10, "completion_tokens": 5}) == (10, 5)
    assert parse_usage_dict({"input_tokens": 7, "output_tokens": 3}) == (7, 3)


def test_weekly_period_bounds_aligned_to_anchor():
    anchor = datetime(2026, 1, 7, 14, 30, tzinfo=timezone.utc)  # Wed
    now = anchor + timedelta(days=3, hours=2)
    start, end = weekly_period_bounds(anchor, now)
    assert start == anchor
    assert end == anchor + timedelta(days=7)

    now2 = anchor + timedelta(days=8)
    start2, end2 = weekly_period_bounds(anchor, now2)
    assert start2 == anchor + timedelta(days=7)
    assert end2 == anchor + timedelta(days=14)
    assert start2 <= now2 < end2
