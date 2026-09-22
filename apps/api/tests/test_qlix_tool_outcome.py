"""Tests for parsing Qlix tool completion frames."""

from loomrun_api.qlix.chat import _extract_tool_outcome


def test_extract_tool_outcome_structured_content():
    name, outcome = _extract_tool_outcome(
        {
            "tool": {
                "name": "update_lead",
                "structured_content": {
                    "status": "ok",
                    "result": {"id": "l1", "title": "Shivu S"},
                },
            }
        }
    )
    assert name == "update_lead"
    assert outcome == {
        "status": "ok",
        "result": {"id": "l1", "title": "Shivu S"},
    }


def test_extract_tool_outcome_bare_result_dict():
    name, outcome = _extract_tool_outcome(
        {
            "tool": {"name": "create_quotation"},
            "result": {"id": "q1", "number": "Q-2026-00001"},
        }
    )
    assert name == "create_quotation"
    assert outcome == {"status": "ok", "result": {"id": "q1", "number": "Q-2026-00001"}}
