"""Unit tests for follow-up advance reminder windows."""

from datetime import datetime, timedelta, timezone

from loomrun_api.follow_up_reminders import active_reminder_offset


def _due_in(minutes: float) -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=minutes)


def test_active_offset_one_hour_window():
    assert active_reminder_offset(_due_in(45), acked_offsets=[]) == 60
    assert active_reminder_offset(_due_in(60), acked_offsets=[]) == 60
    assert active_reminder_offset(_due_in(61), acked_offsets=[]) is None


def test_active_offset_thirty_minute_window():
    assert active_reminder_offset(_due_in(30), acked_offsets=[]) == 30
    assert active_reminder_offset(_due_in(20), acked_offsets=[]) == 30
    assert active_reminder_offset(_due_in(31), acked_offsets=[]) == 60


def test_active_offset_five_minute_window():
    assert active_reminder_offset(_due_in(5), acked_offsets=[]) == 5
    assert active_reminder_offset(_due_in(3), acked_offsets=[]) == 5
    assert active_reminder_offset(_due_in(5.01), acked_offsets=[]) == 30


def test_active_offset_skips_acked():
    assert active_reminder_offset(_due_in(45), acked_offsets=[60]) is None
    assert active_reminder_offset(_due_in(20), acked_offsets=[30]) is None
    assert active_reminder_offset(_due_in(3), acked_offsets=[5]) is None


def test_active_offset_short_schedule_skips_hour():
    # Scheduled only 20 minutes out → 30-minute window, never a late 60.
    assert active_reminder_offset(_due_in(20), acked_offsets=[]) == 30


def test_active_offset_past_due():
    assert active_reminder_offset(_due_in(-1), acked_offsets=[]) is None
