"""Date-bound parsing and compact list cards for CRM search/list tools."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from loomrun_api.services.leads import (
    LEAD_CARD_FIELDS,
    apply_created_updated_filters,
    apply_dates_unless_live,
    calendar_window,
    clock_instructions,
    compact_lead,
    has_live_state_filter,
    parse_iso_bound,
    user_clock,
    window_facet_wheres,
)
from loomrun_api.qlix.chat import _with_crm_preamble


def test_parse_iso_bound_date_only_before_is_next_midnight():
    dt = parse_iso_bound(
        "2026-09-30", field="created_before", exclusive_end=True, tz_name="UTC"
    )
    assert dt == datetime(2026, 10, 1, tzinfo=timezone.utc)


def test_parse_iso_bound_date_only_after_is_start_of_day():
    dt = parse_iso_bound("2026-09-01", field="created_after", tz_name="UTC")
    assert dt == datetime(2026, 9, 1, tzinfo=timezone.utc)


def test_parse_iso_bound_kolkata_date_is_not_utc_midnight():
    dt = parse_iso_bound("2026-09-01", field="created_after", tz_name="Asia/Kolkata")
    assert dt == datetime(2026, 8, 31, 18, 30, tzinfo=timezone.utc)


def test_parse_iso_bound_defaults_to_asia_kolkata():
    dt = parse_iso_bound("2026-09-01", field="created_after")
    assert dt == datetime(2026, 8, 31, 18, 30, tzinfo=timezone.utc)


def test_parse_iso_bound_rejects_junk():
    with pytest.raises(HTTPException) as exc:
        parse_iso_bound("last week", field="created_after")
    assert exc.value.status_code == 400


def test_apply_created_updated_filters_sets_prisma_range():
    where: dict = {}
    apply_created_updated_filters(
        where,
        created_after="2026-09-01",
        created_before="2026-09-30",
        timezone="UTC",
    )
    created = where["createdAt"]
    assert created["gte"] == datetime(2026, 9, 1, tzinfo=timezone.utc)
    assert created["lt"] == datetime(2026, 10, 1, tzinfo=timezone.utc)


def test_compact_lead_drops_notes_and_meta():
    row = {key: key for key in LEAD_CARD_FIELDS}
    row["notes"] = "private"
    row["meta_ad_name"] = "ad"
    card = compact_lead(row, {"assignee_name": "Raghu"})
    assert "notes" not in card
    assert "meta_ad_name" not in card
    assert card["title"] == "title"
    assert card["assignee_name"] == "Raghu"


def test_user_clock_exposes_today_and_month_start():
    clock = user_clock(
        "UTC", now=datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
    )
    assert clock["timezone"] == "UTC"
    assert clock["today"] == "2026-09-21"
    assert clock["month_start"] == "2026-09-01"
    assert clock["week_start"] == "2026-09-21"  # Monday


def test_preamble_has_no_numeric_hints():
    text = _with_crm_preamble(
        "who is WON",
        None,
        timezone="Asia/Kolkata",
    )
    assert "by_status" not in text
    assert "by_stage=" not in text
    assert "leads_total" not in text
    assert "MUST call count_leads" in text
    assert "Never ask the user for an internal id" in text
    assert "who is WON" in text
    assert "User local now:" in text
    assert "Asia/Kolkata" in text
    assert "this_month_from=" in text
    assert "LIVE board" in text
    assert "in_window.created" in text


def test_live_state_filter_detects_stage_not_search():
    assert has_live_state_filter({"organizationId": "o", "stage": "WON"})
    assert has_live_state_filter({"organizationId": "o", "assigneeId": "u"})
    assert not has_live_state_filter({"organizationId": "o"})
    assert not has_live_state_filter({"organizationId": "o", "OR": []})


def test_apply_dates_unless_live_holds_dates_next_to_stage():
    where = {"organizationId": "o", "stage": "WON"}
    apply_dates_unless_live(where, created_after="2026-09-01", timezone="UTC")
    assert "createdAt" not in where


def test_apply_dates_unless_live_applies_when_no_stage():
    where: dict = {"organizationId": "o"}
    apply_dates_unless_live(where, created_after="2026-09-01", timezone="UTC")
    assert where["createdAt"]["gte"].year == 2026


def test_calendar_window_prefers_created_then_updated():
    after, before = calendar_window(
        created_after="2026-09-01", updated_before="2026-09-30"
    )
    assert after == "2026-09-01"
    assert before == "2026-09-30"


def test_window_facet_wheres_same_span_on_created_and_updated():
    created, updated = window_facet_wheres(
        {"organizationId": "o", "stage": "WON"},
        after="2026-09-01",
        before="2026-09-30",
        timezone="UTC",
    )
    assert created["createdAt"]["gte"].year == 2026
    assert "updatedAt" not in created
    assert updated["updatedAt"]["gte"].year == 2026
    assert "createdAt" not in updated
    assert created["stage"] == "WON"


def test_clock_instructions_do_not_map_this_month_onto_live_stage():
    clock = user_clock("UTC", now=datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc))
    text = clock_instructions(clock)
    assert "this_month_from=2026-09-01" in text
    assert "LIVE board" in text
    assert "in_window.created" in text
