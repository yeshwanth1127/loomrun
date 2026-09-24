"""Enforce live CRM reads — models must not answer counts/lists from hints or memory.

Simple count turns can short-circuit via Jev (System One) classification + count_leads.
Ambiguous or low-confidence turns fall through to the full LLM/Qlix tool loop.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from loomrun_api.ai_agent import jev_client
from loomrun_api.ai_agent.tools.registry import ToolContext
from loomrun_api.ai_agent.tools.runtime import dispatch_tool_call
from loomrun_api.config import settings
from loomrun_api.services.leads import user_clock

logger = logging.getLogger(__name__)

# Tools whose JSON result is authoritative for CRM facts on a turn.
CRM_READ_TOOLS = frozenset(
    {
        "count_leads",
        "search_leads",
        "get_lead",
        "list_follow_ups",
        "get_ceo_dashboard",
        "list_production_orders",
        "get_production_order",
        "list_expenses",
        "list_quotations_for_lead",
        "get_quotation",
        "list_calls",
        "list_whatsapp_messages",
    }
)

# Lightweight gates for the LLM-path post-check (not used to fill tool args).
_COUNT_RE = re.compile(r"\b(how many|number of|count of|total)\b", re.I)
_ROSTER_RE = re.compile(
    r"\b(details?|list|names?|who|which|each|every|show me|give me)\b", re.I
)
_STAGE_WORD_RE = re.compile(
    r"\b(won|lost|negotiat\w*|quotation|qualification|contacted|samples?|new)\b",
    re.I,
)

_PIPELINE_STAGES = (
    "NEW",
    "CONTACTED",
    "QUALIFICATION",
    "QUOTATION",
    "NEGOTIATION",
    "SAMPLE",
    "WON",
    "LOST",
)

_CRM_READ_QUESTIONS: dict[str, Any] = {
    "intent": {
        "type": "choice",
        "instructions": (
            "What does the user want for CRM leads? "
            "Pick count_leads for a number only; search_leads for names/list/details; "
            "other_crm for other CRM facts (follow-ups, dashboard, quotations); "
            "not_crm when this is not a CRM data question."
        ),
        "criteria": {
            "count_leads": (
                "User wants how many / a count / total number of leads "
                "(optionally filtered by stage or date)."
            ),
            "search_leads": (
                "User wants a list, names, details, who/which leads, or a roster."
            ),
            "other_crm": (
                "CRM question about follow-ups, dashboard, quotations, calls, "
                "or a single lead lookup — not a plain lead count or roster."
            ),
            "not_crm": "Not asking for live CRM lead facts.",
        },
    },
    "stage": {
        "type": "choice",
        "instructions": (
            "Which sales pipeline stage filters this lead question? "
            "Use NONE when no stage is implied."
        ),
        "criteria": {
            "NONE": "No pipeline stage mentioned or implied.",
            "NEW": "New leads / stage NEW.",
            "CONTACTED": "Contacted stage.",
            "QUALIFICATION": "Qualification stage.",
            "QUOTATION": "Quotation stage.",
            "NEGOTIATION": "Negotiation stage.",
            "SAMPLE": (
                "Sample stage, sample requests, requested for samples, "
                "sampling, SAMPLE board."
            ),
            "WON": "Won / closed-won leads.",
            "LOST": "Lost / closed-lost leads.",
        },
    },
    "time_window": {
        "type": "choice",
        "instructions": (
            "Which time window applies to this lead question? "
            "Use none when no date bound is implied."
        ),
        "criteria": {
            "none": "No time window.",
            "today": "Today / this day.",
            "this_week": "This week / current week.",
            "this_month": "This month / current month.",
        },
    },
}


@dataclass(frozen=True)
class CrmReadPlan:
    intent: str
    stage: str | None
    time_window: str
    confidence: float
    cost_usd: float | None = None


def requires_crm_read_tool(message: str) -> bool:
    """Turn needs a CRM read tool result before the assistant may answer.

    Heuristic post-check for the LLM path only — tool args come from Jev or the model.
    """
    text = (message or "").strip()
    if not text:
        return False
    if _COUNT_RE.search(text):
        return True
    if _ROSTER_RE.search(text) and re.search(r"\bleads?\b", text, re.I):
        return True
    if _ROSTER_RE.search(text) and _STAGE_WORD_RE.search(text):
        return True
    return False


def _month_end(month_start: str) -> str:
    start = date.fromisoformat(month_start)
    if start.month == 12:
        end = date(start.year + 1, 1, 1)
    else:
        end = date(start.year, start.month + 1, 1)
    return end.isoformat()


def count_args_from_plan(plan: CrmReadPlan, *, timezone: str | None) -> dict[str, Any]:
    clock = user_clock(timezone)
    args: dict[str, Any] = {"timezone": clock["timezone"]}
    if plan.stage:
        args["stage"] = plan.stage
    if plan.time_window == "this_month":
        args["updated_after"] = clock["month_start"]
        args["updated_before"] = _month_end(clock["month_start"])
    elif plan.time_window == "this_week":
        args["updated_after"] = clock["week_start"]
    elif plan.time_window == "today":
        args["updated_after"] = clock["today"]
        start = date.fromisoformat(clock["today"])
        args["updated_before"] = (start + timedelta(days=1)).isoformat()
    return args


def search_args_from_plan(plan: CrmReadPlan, *, timezone: str | None) -> dict[str, Any]:
    """Forced search puts a few live rows in front of the model, not a full roster."""
    args = count_args_from_plan(plan, timezone=timezone)
    args["limit"] = 15
    return args


def format_count_reply(
    result: dict[str, Any],
    *,
    stage: str | None,
    time_window: str,
    timezone: str | None,
) -> str:
    clock = user_clock(timezone)
    total = int(result.get("total") or 0)
    in_window = result.get("in_window") if isinstance(result.get("in_window"), dict) else None

    if stage:
        head = f"There are {total} leads currently on the {stage} board"
    else:
        head = f"There are {total} leads"

    if time_window == "this_month" and in_window:
        updated = int(in_window.get("updated") or 0)
        created = int(in_window.get("created") or 0)
        month_label = clock["month_start"][:7]
        tail = (
            f" For {month_label}, {updated} were updated and {created} were created "
            f"in that window (the live board total is still {total})."
        )
        return head + tail + " Say if you want the list."

    return head + ". Say if you want the list."


def _parse_plan(payload: dict[str, Any]) -> CrmReadPlan | None:
    answers = payload.get("answers")
    if not isinstance(answers, dict):
        return None
    intent, intent_conf = jev_client.choice_answer(answers, "intent")
    stage_key, stage_conf = jev_client.choice_answer(answers, "stage")
    window_key, window_conf = jev_client.choice_answer(answers, "time_window")
    if not intent:
        return None

    # Act/escalate uses the weakest of the three answers so a shaky stage does
    # not get applied behind a confident intent.
    confidence = min(intent_conf, stage_conf or intent_conf, window_conf or intent_conf)

    stage: str | None = None
    if stage_key and stage_key.upper() != "NONE":
        upper = stage_key.upper()
        if upper in _PIPELINE_STAGES:
            stage = upper

    time_window = (window_key or "none").lower()
    if time_window not in {"none", "today", "this_week", "this_month"}:
        time_window = "none"

    cost: float | None = None
    usage = payload.get("usage")
    if isinstance(usage, dict) and usage.get("cost_usd") is not None:
        try:
            cost = float(usage["cost_usd"])
        except (TypeError, ValueError):
            cost = None

    return CrmReadPlan(
        intent=intent,
        stage=stage,
        time_window=time_window,
        confidence=confidence,
        cost_usd=cost,
    )


async def classify_crm_read(message: str) -> CrmReadPlan | None:
    """Classify a CRM read turn with Jev. None = fail open to the LLM path."""
    text = (message or "").strip()
    if not text or not settings.jev_ready:
        return None
    try:
        payload = await jev_client.decide(state=text, questions=_CRM_READ_QUESTIONS)
        plan = _parse_plan(payload)
    except jev_client.JevError as exc:
        logger.warning("Jev CRM classify failed open: %s", exc)
        return None
    except Exception:
        logger.exception("Jev CRM classify unexpected error; failing open")
        return None

    if plan is None:
        logger.warning("Jev CRM classify returned unusable answers")
        return None

    logger.info(
        "jev crm classify intent=%s stage=%s window=%s confidence=%.3f cost=%s",
        plan.intent,
        plan.stage or "NONE",
        plan.time_window,
        plan.confidence,
        plan.cost_usd,
    )
    return plan


async def direct_count_reply(
    *, organization_id: str, message: str, timezone: str | None
) -> str | None:
    """High-confidence count via Jev + count_leads; None to use the LLM path."""
    plan = await classify_crm_read(message)
    if plan is None:
        return None
    if plan.intent != "count_leads":
        return None
    if plan.confidence < settings.jev_count_confidence:
        return None

    args = count_args_from_plan(plan, timezone=timezone)
    from loomrun_api.services import leads as lead_svc

    result = await lead_svc.count_leads(organization_id=organization_id, **args)
    return format_count_reply(
        result,
        stage=plan.stage,
        time_window=plan.time_window,
        timezone=timezone,
    )


async def force_crm_read_tool(
    ctx: ToolContext, message: str
) -> tuple[str, dict[str, Any]] | None:
    """Execute the CRM read the model should have called. No chat LLM involved."""
    text = (message or "").strip()
    if not text:
        return None

    plan = await classify_crm_read(text)
    if plan is not None and plan.intent == "search_leads":
        args = search_args_from_plan(plan, timezone=ctx.timezone or None)
        outcome = await dispatch_tool_call(
            ctx=ctx,
            name="search_leads",
            arguments=json.dumps(args),
            propose_writes=False,
        )
        return "search_leads", outcome

    if plan is not None and plan.intent == "count_leads":
        args = count_args_from_plan(plan, timezone=ctx.timezone or None)
        outcome = await dispatch_tool_call(
            ctx=ctx,
            name="count_leads",
            arguments=json.dumps(args),
            propose_writes=False,
        )
        return "count_leads", outcome

    # Fail open without stage guess: if the heuristic says CRM, run bare count_leads.
    if requires_crm_read_tool(text):
        clock = user_clock(ctx.timezone or None)
        args = {"timezone": clock["timezone"]}
        outcome = await dispatch_tool_call(
            ctx=ctx,
            name="count_leads",
            arguments=json.dumps(args),
            propose_writes=False,
        )
        return "count_leads", outcome

    return None
