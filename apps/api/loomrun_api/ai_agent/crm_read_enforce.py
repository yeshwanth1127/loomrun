"""Enforce live CRM reads — models must not answer counts/lists from hints or memory."""

from __future__ import annotations

import json
import re
from datetime import date, timedelta
from typing import Any

from loomrun_api.ai_agent.tools.registry import ToolContext
from loomrun_api.ai_agent.tools.runtime import dispatch_tool_call
from loomrun_api.services.leads import user_clock

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

_COUNT_RE = re.compile(r"\b(how many|number of|count of|total)\b", re.I)
_ROSTER_RE = re.compile(
    r"\b(details?|list|names?|who|which|each|every|show me|give me)\b", re.I
)
_STAGE_HINTS: tuple[tuple[str, str], ...] = (
    (r"\bwon\b", "WON"),
    (r"\blost\b", "LOST"),
    (r"\bnegotiat", "NEGOTIATION"),
    (r"\bquotation\b", "QUOTATION"),
    (r"\bqualification\b", "QUALIFICATION"),
    (r"\bcontacted\b", "CONTACTED"),
    (r"\bsample\b", "SAMPLE"),
    (r"\bnew leads?\b|\bstage new\b", "NEW"),
)

_MONTH_RE = re.compile(r"\bthis month\b", re.I)
_WEEK_RE = re.compile(r"\bthis week\b", re.I)
_TODAY_RE = re.compile(r"\btoday\b", re.I)


def extract_stage(message: str) -> str | None:
    text = (message or "").lower()
    for pattern, stage in _STAGE_HINTS:
        if re.search(pattern, text):
            return stage
    return None


def is_direct_count_query(message: str) -> bool:
    """Pure count question — safe to answer from count_leads without an LLM."""
    text = (message or "").strip()
    if not text or len(text) > 280:
        return False
    if not _COUNT_RE.search(text):
        return False
    if _ROSTER_RE.search(text):
        return False
    return True


def requires_crm_read_tool(message: str) -> bool:
    """Turn needs a CRM read tool result before the assistant may answer."""
    text = (message or "").strip()
    if not text:
        return False
    if is_direct_count_query(text):
        return True
    if _COUNT_RE.search(text):
        return True
    if _ROSTER_RE.search(text) and extract_stage(text):
        return True
    if _ROSTER_RE.search(text) and re.search(r"\bleads?\b", text, re.I):
        return True
    return False


def _month_end(month_start: str) -> str:
    start = date.fromisoformat(month_start)
    if start.month == 12:
        end = date(start.year + 1, 1, 1)
    else:
        end = date(start.year, start.month + 1, 1)
    return end.isoformat()


def infer_count_leads_args(message: str, *, timezone: str | None) -> dict[str, Any]:
    clock = user_clock(timezone)
    args: dict[str, Any] = {"timezone": clock["timezone"]}
    stage = extract_stage(message)
    if stage:
        args["stage"] = stage
    text = message or ""
    if _MONTH_RE.search(text):
        args["updated_after"] = clock["month_start"]
        args["updated_before"] = _month_end(clock["month_start"])
    elif _WEEK_RE.search(text):
        args["updated_after"] = clock["week_start"]
    elif _TODAY_RE.search(text):
        args["updated_after"] = clock["today"]
        start = date.fromisoformat(clock["today"])
        args["updated_before"] = (start + timedelta(days=1)).isoformat()
    return args


def format_count_reply(message: str, result: dict[str, Any], *, timezone: str | None) -> str:
    clock = user_clock(timezone)
    total = int(result.get("total") or 0)
    stage = extract_stage(message)
    in_window = result.get("in_window") if isinstance(result.get("in_window"), dict) else None

    if stage:
        head = f"There are {total} leads currently on the {stage} board"
    else:
        head = f"There are {total} leads"

    if _MONTH_RE.search(message or "") and in_window:
        updated = int(in_window.get("updated") or 0)
        created = int(in_window.get("created") or 0)
        month_label = clock["month_start"][:7]
        tail = (
            f" For {month_label}, {updated} were updated and {created} were created "
            f"in that window (the live board total is still {total})."
        )
        return head + tail + " Say if you want the list."

    return head + ". Say if you want the list."


async def direct_count_reply(
    *, organization_id: str, message: str, timezone: str | None
) -> str | None:
    """Run count_leads server-side for a simple count question; None if not applicable."""
    if not is_direct_count_query(message):
        return None
    args = infer_count_leads_args(message, timezone=timezone)
    from loomrun_api.services import leads as lead_svc

    result = await lead_svc.count_leads(organization_id=organization_id, **args)
    return format_count_reply(message, result, timezone=timezone)


def infer_search_leads_args(message: str, *, timezone: str | None) -> dict[str, Any]:
    args = infer_count_leads_args(message, timezone=timezone)
    # The forced read exists to put *some* live rows in front of the model, not
    # a full roster. 50 rows serialises to ~21,770 chars and gets re-sent on
    # every later loop iteration; `total` still carries the real figure.
    args["limit"] = 15
    args.pop("stage", None)
    stage = extract_stage(message)
    if stage:
        args["stage"] = stage
    return args


async def force_crm_read_tool(
    ctx: ToolContext, message: str
) -> tuple[str, dict[str, Any]] | None:
    """Execute the CRM read the model should have called. No LLM involved."""
    text = (message or "").strip()
    if is_direct_count_query(text) or _COUNT_RE.search(text):
        args = infer_count_leads_args(text, timezone=ctx.timezone or None)
        outcome = await dispatch_tool_call(
            ctx=ctx,
            name="count_leads",
            arguments=json.dumps(args),
            propose_writes=False,
        )
        return "count_leads", outcome

    if _ROSTER_RE.search(text) and (extract_stage(text) or re.search(r"\bleads?\b", text, re.I)):
        args = infer_search_leads_args(text, timezone=ctx.timezone or None)
        outcome = await dispatch_tool_call(
            ctx=ctx,
            name="search_leads",
            arguments=json.dumps(args),
            propose_writes=False,
        )
        return "search_leads", outcome
    return None
