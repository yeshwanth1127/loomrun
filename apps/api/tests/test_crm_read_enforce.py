"""CRM read enforcement — Jev classify + live count_leads."""

from __future__ import annotations

import pytest

from loomrun_api.ai_agent import jev_client
from loomrun_api.ai_agent.crm_read_enforce import (
    CrmReadPlan,
    classify_crm_read,
    count_args_from_plan,
    direct_count_reply,
    format_count_reply,
    requires_crm_read_tool,
    search_args_from_plan,
)


def test_requires_crm_read_tool():
    assert requires_crm_read_tool("give me the details of won leads")
    assert requires_crm_read_tool("How many leads are won")
    assert not requires_crm_read_tool("Schedule a follow-up with Ashwin")


def test_count_args_from_plan_won_this_month():
    plan = CrmReadPlan(
        intent="count_leads",
        stage="WON",
        time_window="this_month",
        confidence=0.9,
    )
    args = count_args_from_plan(plan, timezone="UTC")
    assert args["stage"] == "WON"
    assert args["updated_after"].endswith("-01")
    assert args["updated_before"].endswith("-01")


def test_format_count_reply_uses_total_not_status():
    text = format_count_reply(
        {
            "total": 5,
            "by_status": {"WON": 4, "ACTIVE": 1},
            "in_window": {"updated": 4, "created": 1},
        },
        stage="WON",
        time_window="this_month",
        timezone="UTC",
    )
    assert "5" in text
    assert "WON" in text
    assert "4 were updated" in text


def test_search_args_limit():
    plan = CrmReadPlan(
        intent="search_leads",
        stage="WON",
        time_window="none",
        confidence=0.9,
    )
    args = search_args_from_plan(plan, timezone="Asia/Kolkata")
    assert args["limit"] <= 15
    assert args["stage"] == "WON"


def _fake_jev_payload(
    *,
    intent: str,
    stage: str,
    time_window: str,
    confidence: float,
) -> dict:
    return {
        "model": "jev-1.13.0",
        "answers": {
            "intent": {
                "type": "choice",
                "choice": intent,
                "confidence": confidence,
                "probabilities": {intent: confidence},
            },
            "stage": {
                "type": "choice",
                "choice": stage,
                "confidence": confidence,
                "probabilities": {stage: confidence},
            },
            "time_window": {
                "type": "choice",
                "choice": time_window,
                "confidence": confidence,
                "probabilities": {time_window: confidence},
            },
        },
        "usage": {"input_tokens": 40, "cost_usd": 0.00002},
    }


@pytest.mark.asyncio
async def test_direct_count_reply_samples_uses_stage(monkeypatch):
    calls: list[dict] = []

    async def fake_decide(*, state, questions, model=None):
        assert "samples" in state.lower()
        return _fake_jev_payload(
            intent="count_leads",
            stage="SAMPLE",
            time_window="none",
            confidence=0.95,
        )

    async def fake_count_leads(**kwargs):
        calls.append(kwargs)
        return {"total": 12, "by_stage": {"SAMPLE": 12}}

    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_enabled",
        True,
    )
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.openrouter_api_key",
        "sk-or-test",
    )
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_api_key",
        "",
    )
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_count_confidence",
        0.75,
    )
    monkeypatch.setattr(jev_client, "decide", fake_decide)
    monkeypatch.setattr(
        "loomrun_api.services.leads.count_leads",
        fake_count_leads,
    )

    reply = await direct_count_reply(
        organization_id="org1",
        message="how many requested for samples",
        timezone="UTC",
    )
    assert reply is not None
    assert "12" in reply
    assert "SAMPLE" in reply
    assert calls[0]["organization_id"] == "org1"
    assert calls[0]["stage"] == "SAMPLE"


@pytest.mark.asyncio
async def test_direct_count_reply_low_confidence_falls_open(monkeypatch):
    async def fake_decide(*, state, questions, model=None):
        return _fake_jev_payload(
            intent="count_leads",
            stage="WON",
            time_window="none",
            confidence=0.4,
        )

    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_enabled",
        True,
    )
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.openrouter_api_key",
        "sk-or-test",
    )
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_api_key",
        "",
    )
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_count_confidence",
        0.75,
    )
    monkeypatch.setattr(jev_client, "decide", fake_decide)

    reply = await direct_count_reply(
        organization_id="org1",
        message="How many leads are won",
        timezone="UTC",
    )
    assert reply is None


@pytest.mark.asyncio
async def test_direct_count_reply_jev_down_falls_open(monkeypatch):
    async def fake_decide(*, state, questions, model=None):
        raise jev_client.JevError("boom")

    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_enabled",
        True,
    )
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.openrouter_api_key",
        "sk-or-test",
    )
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_api_key",
        "",
    )
    monkeypatch.setattr(jev_client, "decide", fake_decide)

    reply = await direct_count_reply(
        organization_id="org1",
        message="How many leads are won",
        timezone="UTC",
    )
    assert reply is None


@pytest.mark.asyncio
async def test_classify_crm_read_when_jev_disabled(monkeypatch):
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_enabled",
        False,
    )
    monkeypatch.setattr(
        "loomrun_api.ai_agent.crm_read_enforce.settings.jev_api_key",
        "",
    )
    assert await classify_crm_read("how many won leads") is None
