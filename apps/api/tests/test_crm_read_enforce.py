"""CRM read enforcement — no invented counts."""

from __future__ import annotations

import pytest

from loomrun_api.ai_agent.crm_read_enforce import (
    direct_count_reply,
    format_count_reply,
    infer_count_leads_args,
    is_direct_count_query,
    requires_crm_read_tool,
)


def test_is_direct_count_query():
    assert is_direct_count_query("How many leads are won for this month")
    assert not is_direct_count_query("How many leads are won and give me details")
    assert not is_direct_count_query("What should I do next?")


def test_requires_crm_read_tool():
    assert requires_crm_read_tool("give me the details of won leads")
    assert requires_crm_read_tool("How many leads are won")
    assert not requires_crm_read_tool("Schedule a follow-up with Ashwin")


def test_infer_count_leads_args_won_this_month():
    args = infer_count_leads_args(
        "How many leads are won for this month", timezone="UTC"
    )
    assert args["stage"] == "WON"
    assert args["updated_after"].endswith("-01")
    assert args["updated_before"].endswith("-01")
    assert "updated_after" in args and "updated_before" in args


def test_format_count_reply_uses_total_not_status():
    text = format_count_reply(
        "How many leads are won for this month",
        {
            "total": 5,
            "by_status": {"WON": 4, "ACTIVE": 1},
            "in_window": {"updated": 4, "created": 1},
        },
        timezone="UTC",
    )
    assert "5" in text
    assert "4 were updated" in text


@pytest.mark.asyncio
async def test_direct_count_reply_runs_count_leads(monkeypatch):
    calls: list[dict] = []

    async def fake_count_leads(**kwargs):
        calls.append(kwargs)
        return {
            "total": 5,
            "by_stage": {"WON": 5},
            "in_window": {"updated": 4, "created": 1},
        }

    monkeypatch.setattr(
        "loomrun_api.services.leads.count_leads",
        fake_count_leads,
    )
    reply = await direct_count_reply(
        organization_id="org1",
        message="How many leads are won for this month",
        timezone="UTC",
    )
    assert reply is not None
    assert "5" in reply
    assert calls[0]["organization_id"] == "org1"
    assert calls[0]["stage"] == "WON"
