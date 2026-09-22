"""Intent-matched CRM tool packs — same list for local fallback and Qlix enqueue."""

from __future__ import annotations

from loomrun_api.ai_agent.tools import defs as _defs  # noqa: F401
from loomrun_api.ai_agent.tools.registry import (
    openai_tools_for_message,
    select_tool_names_for_message,
)
from loomrun_api.ai_agent.tools.registry import get_tool


def test_won_leads_question_gets_leads_pack_not_quotations():
    names = select_tool_names_for_message(
        "How many leads are WON this month? Give me the complete details",
        mode="advanced",
        role="OWNER",
    )
    assert names is not None
    assert "search_leads" in names
    assert "count_leads" in names
    assert "get_lead" in names
    assert "list_quotations_for_lead" not in names


def test_open_ended_question_uses_full_catalog():
    names = select_tool_names_for_message(
        "what should I do today?", mode="advanced", role="OWNER"
    )
    assert names is None


def test_openai_tools_for_message_never_sends_empty_list():
    tools = openai_tools_for_message("advanced", role="OWNER", message="how many leads")
    assert tools
    names = {t["function"]["name"] for t in tools}
    assert "search_leads" in names
    assert "count_leads" in names
    assert "list_quotations_for_lead" not in names
    assert "list_team_members" not in names
    assert "search_past_chats" not in names


def test_team_question_gets_list_team_members():
    names = select_tool_names_for_message(
        "who is assigned to Kanniga",
        mode="advanced",
        role="OWNER",
    )
    assert names is not None
    assert "list_team_members" in names


def test_search_leads_does_not_tell_the_model_to_date_filter_a_stage():
    spec = get_tool("search_leads")
    assert spec is not None
    assert "in_window.created" in spec.description
    assert "won this month" not in spec.description.lower()


def test_search_leads_exposes_date_bounds():
    spec = get_tool("search_leads")
    assert spec is not None
    props = spec.parameters
    assert "created_after" in props
    assert "updated_after" in props
    assert "timezone" in props
    assert "list_quotations_for_lead" in spec.description or "NOT:" in spec.description


def test_quotation_edit_question_gets_update_quotation():
    names = select_tool_names_for_message(
        "change the quotation line description on Q-2026-00005 to cotton tshirts",
        mode="advanced",
        role="OWNER",
    )
    assert names is not None
    assert "update_quotation" in names
    assert "get_quotation" in names


def test_schedule_follow_up_pack():
    names = select_tool_names_for_message(
        "schedule a follow up for gani s on 23rd september",
        mode="advanced",
        role="OWNER",
    )
    assert names is not None
    assert "schedule_follow_up" in names


def test_update_quotation_tool_registered():
    spec = get_tool("update_quotation")
    assert spec is not None
    assert spec.kind == "write"
    assert "update_lead" in spec.description
