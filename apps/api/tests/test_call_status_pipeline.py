"""Regression tests for Call Status → pipeline stage mapping."""

from loomrun_api.call_outcomes import stage_key_for_outcome


def test_closed_not_now_does_not_move_pipeline():
    assert stage_key_for_outcome("CLOSED_NOT_NOW") is None


def test_lost_outcomes_map_to_lost():
    assert stage_key_for_outcome("DEAL_LOST") == "LOST"
    assert stage_key_for_outcome("DEAL_REJECTED_AFTER_SAMPLE") == "LOST"
    assert stage_key_for_outcome("DO_NOT_CONTACT") == "LOST"


def test_won_outcomes_map_to_won():
    assert stage_key_for_outcome("DEAL_WON") == "WON"
    assert stage_key_for_outcome("DEAL_WON_AFTER_SAMPLE") == "WON"


def test_activity_only_statuses_preserve_pipeline():
    for code in (
        "NO_ANSWER",
        "WHATSAPP_SENT",
        "EMAIL_SENT",
        "BUSY",
        "WRONG_NUMBER",
        "NOT_REACHABLE",
        "CALL_BACK_LATER",
        "FOLLOW_UP",
        "CLOSED_NOT_NOW",
    ):
        assert stage_key_for_outcome(code) is None, code
