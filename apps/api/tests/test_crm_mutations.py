"""Tests for CRM mutation hints emitted after agent writes."""

from loomrun_api.ai_agent.crm_mutations import mutation_from_result, mutation_from_tool
from loomrun_api.ai_agent.tools.defs.quotations import _merge_line_updates


def test_mutation_from_update_quotation():
    m = mutation_from_tool(
        "update_quotation",
        {
            "status": "ok",
            "result": {
                "id": "q1",
                "number": "Q-2026-00005",
                "version": 2,
                "message": "Saved as version 2. Previous version 1 kept in history.",
            },
        },
    )
    assert m is not None
    assert m["entity"] == "quotation"
    assert m["action"] == "updated"
    assert m["label"] == "Q-2026-00005"
    assert "version 2" in m["summary"].lower()


def test_mutation_from_delete_quotation():
    m = mutation_from_tool(
        "delete_quotation",
        {
            "status": "ok",
            "result": {
                "id": "q1",
                "number": "Q-2026-00005",
                "deleted": True,
                "message": "Q-2026-00005 deleted",
            },
        },
    )
    assert m is not None
    assert m["entity"] == "quotation"
    assert m["action"] == "deleted"
    assert m["id"] == "q1"
    assert m["label"] == "Q-2026-00005"


def test_mutation_from_schedule_follow_up():
    m = mutation_from_result(
        "schedule_follow_up",
        {"lead_id": "l1", "lead_title": "Gani S", "outcome": "CALLBACK_SCHEDULED"},
    )
    assert m is not None
    assert m["entity"] == "call"
    assert m["id"] == "l1"
    assert "Gani S" in m["summary"]


def test_merge_line_updates_patches_description():
    merged = _merge_line_updates(
        [{"description": "Tshirts", "quantity": 500, "unit_price": 200}],
        lines=None,
        line_updates=[{"match_description": "tshirts", "description": "cotton tshirts"}],
    )
    assert len(merged) == 1
    assert merged[0]["description"] == "cotton tshirts"
    assert merged[0]["quantity"] == 500


def test_merge_line_updates_fuzzy_hyphen_match():
    merged = _merge_line_updates(
        [{"description": "t-shirts", "quantity": 20, "unit_price": 200}],
        lines=None,
        line_updates=[{"match_description": "tshirts", "description": "cotton tshirts"}],
    )
    assert merged[0]["description"] == "cotton tshirts"
    assert merged[0]["quantity"] == 20


def test_merge_lines_inherits_qty_price_when_zeros():
    merged = _merge_line_updates(
        [{"description": "Tshirts", "quantity": 500, "unit_price": 200}],
        lines=[{"description": "cotton tshirts", "quantity": 0, "unit_price": 0}],
        line_updates=None,
    )
    assert merged[0]["description"] == "cotton tshirts"
    assert merged[0]["quantity"] == 500
    assert merged[0]["unit_price"] == 200


def test_merge_line_updates_requires_input():
    try:
        _merge_line_updates([], lines=None, line_updates=None)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "lines or line_updates" in str(exc)
