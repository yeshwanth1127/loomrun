"""Run a Loomrun chat turn on the org's Qlix agent.

Qlix owns the agent loop, the tool calls and the approvals; Loomrun still owns
the conversation record, plan limits and usage metering. The turn is written as
an async generator of UI events so the same code serves both the streaming
endpoint and the plain request/response one.

Approvals arrive on the run stream as a ``log`` event whose message is
``jit_approval_pending``, carrying the tool name and arguments. We turn that
into the same pending-action row the old in-process agent produced, so the
existing confirmation card renders unchanged.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from loomrun_api.ai_agent.crm_mutations import mutation_from_result, mutation_from_tool
from loomrun_api.ai_agent.crm_read_enforce import CRM_READ_TOOLS, requires_crm_read_tool
from loomrun_api.ai_agent.tools import pending as pending_store
from loomrun_api.ai_agent.tools.registry import get_tool, select_tool_names_for_message, summarize_args
from loomrun_api.config import settings
from loomrun_api.logging_setup import get_request_id
from loomrun_api.prisma_client import prisma
from loomrun_api.qlix import client as qlix
from loomrun_api.qlix import connection as conn
from loomrun_api.qlix import grants
from loomrun_api.qlix.context import tool_context_headers
from loomrun_api.services import leads as lead_svc

logger = logging.getLogger(__name__)

JIT_MESSAGE = "jit_approval_pending"


async def _newest_lead(organization_id: str) -> dict[str, Any] | None:
    """The most recently created lead, for the run preamble.

    "Which is the latest lead" is asked constantly and answered wrongly when the
    model reaches into Brain context, which has no ordering. One indexed query
    is cheaper than the tool round-trip it replaces, and it removes the guess.
    Never raises — a missing line just means the model must use search_leads.
    """
    try:
        rows = await lead_svc.search_leads(
            organization_id=organization_id, sort="newest", limit=1
        )
        items = rows.get("items") or []
        return items[0] if items else None
    except Exception:
        logger.exception("Could not read the newest lead for org %s", organization_id)
        return None


def _with_crm_preamble(
    message: str,
    newest: dict[str, Any] | None = None,
    timezone: str | None = None,
) -> str:
    """Prefix the turn with authoritative totals and how to read the Brain.

    These instructions ride on every run rather than living only in the agent's
    description, because the description is fixed when the agent is created and
    existing agents never see a later edit to it.
    """
    clock = lead_svc.user_clock(timezone)
    lines = [
        "[Loomrun context — read this before answering. These instructions "
        "override the agent description.",
        "Write tools execute IMMEDIATELY — there is no approval step and no "
        "Confirm button anywhere in this product. Never reply 'please confirm' "
        "or 'I will do it now': call the tool in this same turn and report what "
        "the result says. Answering without calling the tool leaves the data "
        "unchanged and misleads the user.",
        "Brain excerpts are a few similar records, never a roster and never in any "
        "order. Never answer 'latest', 'newest', 'oldest' or 'how many' from them, "
        "and never present a name found there as the most recent one.",
        "For the latest/newest lead use the 'Newest lead' line below, or call "
        "search_leads with sort='newest' and limit=1. Never take it from a Brain "
        "excerpt and never guess a creation date.",
        "For any count or 'how many' question you MUST call count_leads in this "
        "turn and quote its `total`. Never answer a count from memory, Brain, "
        "or this preamble — there are no numeric hints here.",
        lead_svc.clock_instructions(clock),
        "'Stage' means two different things — pick by the VALUE named:",
        "  NEW, CONTACTED, QUALIFICATION, QUOTATION, NEGOTIATION, SAMPLE, WON, "
        "LOST are SALES stages on a lead → call update_lead.",
        "  FABRIC_CHECK, PROCUREMENT, CUTTING, PRINTING, STITCHING, QC, PACKING, "
        "READY_DISPATCH, SHIPPED are FACTORY stages on a production order → call "
        "update_production_order.",
        "For a sales-stage move call update_lead ONCE, passing the name the user "
        "gave as lead_id (it accepts a name, not just an id) plus the new stage. "
        "Do not search first and do not use any list_* tool to find it — if the "
        "name is wrong or ambiguous, update_lead says so and names the candidates. "
        "Never ask the user for a lead id; they do not know it.",
        "Quotation or invoice LINE edits (description, qty, price) → "
        "update_quotation. Never use update_lead product_interest for quote lines.",
        "Schedule a follow-up that appears on the Follow-ups screen → "
        "schedule_follow_up (not bare update_lead next_follow_up_at).",
        "If a tool errors because an id is missing or a name is unknown, call "
        "the matching search_* tool and retry. Never ask the user for an "
        "internal id.",
    ]
    if newest:
        lines.append(
            f"Newest lead (authoritative, by creation date): {newest['title']}"
            + (f" — {newest['company']}" if newest.get("company") else "")
            + f", created {newest['created_at']}, stage {newest['stage']}"
        )
    lines.append("]")
    return "\n".join(lines) + f"\n\n{message}"


async def _ensure_qlix_conversation(
    *, conversation_id: str, api_key: str, agent_id: str
) -> str:
    """Map a Loomrun thread onto a Qlix conversation, creating one if needed."""
    row = await prisma.aiconversation.find_unique(where={"id": conversation_id})
    if row and row.qlixConversationId:
        return row.qlixConversationId

    created = await qlix.create_conversation(api_key, agent_id)
    qlix_conversation_id = str(
        created.get("conversationId") or created.get("id") or ""
    ).strip()
    if not qlix_conversation_id:
        raise qlix.QlixError("Qlix did not return a conversation id")

    await prisma.aiconversation.update(
        where={"id": conversation_id},
        data={"qlixConversationId": qlix_conversation_id},
    )
    return qlix_conversation_id


def _extract_delta(payload: dict[str, Any]) -> str:
    """Pull text out of a delta frame.

    Qlix documents ``data.data`` as "typically a string or {text}", so accept
    both rather than assuming one.
    """
    data = payload.get("data", payload)
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        for key in ("text", "content", "delta"):
            value = data.get(key)
            if isinstance(value, str):
                return value
    return ""


def _extract_tool_call(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    tool = payload.get("tool")
    if not isinstance(tool, dict):
        return "", {}
    name = str(tool.get("name") or "")
    args = tool.get("arguments")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            args = {"_raw": args}
    return name, args if isinstance(args, dict) else {}


def _extract_tool_outcome(payload: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    """Best-effort parse of a completed tool frame into (name, dispatch outcome)."""
    name, _args = _extract_tool_call(payload)
    if not name:
        return "", None

    raw_result: Any = payload.get("result")
    tool = payload.get("tool")
    if raw_result is None and isinstance(tool, dict):
        raw_result = (
            tool.get("result")
            or tool.get("output")
            or tool.get("structured_content")
            or tool.get("structuredContent")
        )

    if isinstance(raw_result, str):
        try:
            raw_result = json.loads(raw_result)
        except json.JSONDecodeError:
            return name, None

    if isinstance(raw_result, dict):
        if "status" in raw_result:
            return name, raw_result
        return name, {"status": "ok", "result": raw_result}
    return name, None


def _summarize(tool_name: str, args: dict[str, Any]) -> str:
    """Describe a proposed write in the user's terms, reusing the registry's wording."""
    spec = get_tool(tool_name)
    if spec:
        return summarize_args(spec, args)
    return f"Run {tool_name.replace('_', ' ')}"


# Frame markers Qlix uses around a tool call. Anything unrecognised is treated
# as the tool still running, which is the safe default for a progress display.
_TOOL_DONE_MARKERS = {
    "tool_call_finished",
    "tool_finished",
    "tool_result",
    "tool_call_completed",
}
_TOOL_ERROR_MARKERS = {"tool_error", "tool_call_failed", "tool_failed"}


def _safe_args(args: dict[str, Any]) -> dict[str, Any]:
    """Small, scalar-only view of a tool's arguments, safe to show in the UI.

    Progress chips should never carry a whole record, and never a value the
    user is not already entitled to see, so this keeps short scalars only.
    """
    out: dict[str, Any] = {}
    for key, value in list(args.items())[:6]:
        if isinstance(value, bool) or isinstance(value, (int, float)):
            out[key] = value
        elif isinstance(value, str) and value:
            out[key] = value[:80]
    return out


def _tool_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Turn a Qlix log/status frame into a tool-activity event, or None.

    Qlix's frame shapes are not contractual, so this reads defensively: a frame
    it does not recognise as a tool call produces nothing at all, rather than a
    progress step the agent never actually ran.
    """
    marker = str(
        payload.get("message") or payload.get("event") or payload.get("status") or ""
    ).strip().lower()
    if marker == JIT_MESSAGE:
        # Already rendered as an approval card; not a progress step.
        return None

    name, args = _extract_tool_call(payload)
    if not name:
        return None

    if marker in _TOOL_ERROR_MARKERS:
        phase = "error"
    elif marker in _TOOL_DONE_MARKERS:
        phase = "done"
    else:
        phase = "running"

    return {
        "type": "tool",
        "tool": {"name": name, "phase": phase, "args": _safe_args(args)},
    }


async def _record_pending(
    *,
    organization_id: str,
    user_id: str,
    api_key: str,
    payload: dict[str, Any],
    run_id: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Turn a JIT event into either an auto-approval or a confirmation card.

    Returns ``(pending_action, auto_approved)`` — exactly one is set.
    """
    jit_request_id = str(payload.get("jitRequestId") or "").strip()
    if not jit_request_id:
        logger.warning("JIT event without a request id on run %s", run_id)
        return None, None

    tool_name, args = _extract_tool_call(payload)
    if not tool_name:
        # Fall back to the scope label so the card still says something true,
        # rather than showing an empty approval.
        tool_name = str(payload.get("scope") or "action")
        args = {}

    summary = _summarize(tool_name, args) or str(payload.get("context") or tool_name)

    # A standing approval for this tool means the user already said yes within
    # the last 24 hours. Approve straight away, but still tell them it happened.
    existing = await grants.find_active(
        organization_id=organization_id, tool=tool_name
    )
    if existing:
        try:
            await qlix.jit_decide(
                api_key, jit_request_id=jit_request_id, approved=True
            )
        except qlix.QlixError as exc:
            # If Qlix would not take the decision, fall back to asking rather
            # than leaving the agent stuck waiting on nobody.
            logger.warning("Auto-approval failed for %s: %s", tool_name, exc)
        else:
            await grants.record_use(existing.id)
            return None, {
                "tool": tool_name,
                "summary": summary,
                "grant_id": existing.id,
                "expires_at": grants.serialize(existing)["expires_at"],
            }

    return (
        await pending_store.create_pending_action(
            organization_id=organization_id,
            user_id=user_id,
            tool=tool_name,
            payload=args,
            summary=summary,
            jit_request_id=jit_request_id,
            qlix_run_id=run_id,
        ),
        None,
    )


async def run_turn(
    *,
    organization_id: str,
    user_id: str,
    role: str,
    mode: str,
    message: str,
    conversation_id: str,
    user_message_id: str,
    model: str | None = None,
    timezone: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield UI events for one turn: delta, pending_action, done, error."""
    connection, api_key = await conn.require_api_key(organization_id)
    agent_id = connection.agentId
    if not agent_id:
        raise qlix.QlixError("This organization has no Qlix agent yet")

    qlix_conversation_id = await _ensure_qlix_conversation(
        conversation_id=conversation_id, api_key=api_key, agent_id=agent_id
    )

    content = _with_crm_preamble(
        message,
        await _newest_lead(organization_id),
        timezone=timezone,
    )

    selected = select_tool_names_for_message(message, mode=mode, role=role)
    # None = no pack match → full catalog and Brain on. A matched pack skips
    # Brain so CRM totals/docs don't compete with the live tools.
    allowed_mcp_tools = sorted(selected) if selected else None
    use_brain = selected is None

    request_id = get_request_id()
    enqueued = await qlix.enqueue_run(
        api_key,
        agent_id=agent_id,
        conversation_id=qlix_conversation_id,
        content=content,
        use_brain=use_brain,
        model=(model or settings.qlix_default_model or None),
        # This is the entire tenant boundary for tool execution: Qlix forwards
        # it on every MCP call and the tool server trusts nothing else.
        tool_context=tool_context_headers(
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            mode=mode,
            conversation_id=conversation_id,
            timezone=timezone,
        ),
        # Stable per-user-message id so a retried enqueue (network blip,
        # client re-send) resolves to the same Qlix run instead of a
        # duplicate one.
        external_run_id=f"loomrun:{conversation_id}:{user_message_id}",
        correlation_id=request_id if request_id != "-" else None,
        allowed_mcp_tools=allowed_mcp_tools,
    )
    run_id = str(enqueued.get("runId") or "").strip()
    if not run_id:
        raise qlix.QlixError("Qlix did not start a run for this message")

    yield {"type": "run", "run_id": run_id}

    text_parts: list[str] = []
    pending_actions: list[dict[str, Any]] = []
    auto_approved: list[dict[str, Any]] = []
    crm_mutations: list[dict[str, Any]] = []
    tools_invoked: set[str] = set()
    final_text = ""
    citations: list[Any] = []

    async for event_name, payload in qlix.stream_run(
        api_key, agent_id=agent_id, run_id=run_id
    ):
        if event_name == "delta":
            chunk = _extract_delta(payload)
            if chunk:
                text_parts.append(chunk)
                yield {"type": "delta", "text": chunk}

        elif event_name == "log":
            if payload.get("message") == JIT_MESSAGE:
                action, auto = await _record_pending(
                    organization_id=organization_id,
                    user_id=user_id,
                    api_key=api_key,
                    payload=payload,
                    run_id=run_id,
                )
                if action:
                    pending_actions.append(action)
                    yield {"type": "pending_action", "action": action}
                elif auto:
                    auto_approved.append(auto)
                    yield {"type": "auto_approved", "action": auto}
            else:
                tool_event = _tool_event(payload)
                if tool_event:
                    t_phase = tool_event.get("tool", {}).get("phase")
                    t_name = tool_event.get("tool", {}).get("name") or ""
                    if t_phase == "done" and t_name:
                        tools_invoked.add(str(t_name))
                    if t_phase == "done":
                        t_name, outcome = _extract_tool_outcome(payload)
                        mutation = (
                            mutation_from_tool(t_name, outcome)
                            if outcome
                            else None
                        )
                        if not mutation and outcome and outcome.get("status") == "ok":
                            result = outcome.get("result")
                            if isinstance(result, dict):
                                mutation = mutation_from_result(t_name, result)
                        if mutation:
                            crm_mutations.append(mutation)
                            yield {"type": "crm_mutation", "mutation": mutation}
                    yield tool_event
                else:
                    yield {"type": "log", "data": payload}

        elif event_name == "status":
            tool_event = _tool_event(payload)
            if tool_event:
                t_phase = tool_event.get("tool", {}).get("phase")
                t_name_evt = tool_event.get("tool", {}).get("name") or ""
                if t_phase == "done" and t_name_evt:
                    tools_invoked.add(str(t_name_evt))
                if t_phase == "done":
                    t_name, outcome = _extract_tool_outcome(payload)
                    mutation = mutation_from_tool(t_name, outcome) if outcome else None
                    if not mutation and outcome and outcome.get("status") == "ok":
                        result = outcome.get("result")
                        if isinstance(result, dict):
                            mutation = mutation_from_result(t_name, result)
                    if mutation:
                        crm_mutations.append(mutation)
                        yield {"type": "crm_mutation", "mutation": mutation}
                yield tool_event
            else:
                yield {"type": "status", "data": payload}

        elif event_name == "done":
            status_value = str(payload.get("status") or "success")
            assistant = payload.get("assistant")
            if isinstance(assistant, dict):
                final_text = str(assistant.get("content") or "")
                raw_citations = assistant.get("citations")
                if isinstance(raw_citations, list):
                    citations = raw_citations
            elif isinstance(assistant, str):
                final_text = assistant

            if status_value == "failed":
                raise qlix.QlixError(str(payload.get("error") or "The agent run failed"))

            if requires_crm_read_tool(message) and not (tools_invoked & CRM_READ_TOOLS):
                raise qlix.QlixError(
                    "CRM read required but Qlix answered without calling a read tool"
                )

            yield {
                "type": "done",
                "status": status_value,
                "text": final_text or "".join(text_parts),
                "citations": citations,
                "pending_actions": pending_actions,
                "auto_approved": auto_approved,
                "crm_mutations": crm_mutations,
                "run_id": run_id,
            }
            return

    # Stream ended without a terminal frame — surface what we have rather than
    # dropping the turn on the floor.
    yield {
        "type": "done",
        "status": "success",
        "text": "".join(text_parts),
        "citations": citations,
        "pending_actions": pending_actions,
        "auto_approved": auto_approved,
        "crm_mutations": crm_mutations,
        "run_id": run_id,
    }


async def collect_turn(**kwargs: Any) -> dict[str, Any]:
    """Run a turn and return only the final result (non-streaming callers)."""
    result: dict[str, Any] = {
        "text": "",
        "citations": [],
        "pending_actions": [],
        "auto_approved": [],
        "crm_mutations": [],
        "run_id": None,
    }
    async for event in run_turn(**kwargs):
        if event["type"] == "run":
            result["run_id"] = event["run_id"]
        elif event["type"] == "done":
            result["text"] = event["text"]
            result["citations"] = event["citations"]
            result["pending_actions"] = event["pending_actions"]
            result["auto_approved"] = event.get("auto_approved") or []
            result["crm_mutations"] = event.get("crm_mutations") or []
    return result


# ── Approvals ─────────────────────────────────────────────────────────────────

async def decide(
    *,
    organization_id: str,
    user_id: str,
    action_id: str,
    approved: bool,
) -> dict[str, Any]:
    """Approve or deny a pending write.

    Approving also opens a 24-hour standing grant for that tool, so the same
    kind of action does not re-prompt for the rest of the day.
    """
    _, api_key = await conn.require_api_key(organization_id)
    row = await pending_store.get_pending_row(
        action_id=action_id, organization_id=organization_id, user_id=user_id
    )
    if row.status != "pending":
        return {"id": row.id, "status": row.status, "decided": False}
    if not row.jitRequestId:
        raise qlix.QlixError("This action did not come from Qlix")

    await qlix.jit_decide(
        api_key, jit_request_id=row.jitRequestId, approved=approved
    )
    await pending_store.set_status(row.id, "confirmed" if approved else "cancelled")

    granted = None
    if approved:
        # Qlix keeps its own conversation-scoped grant after a yes; we let that
        # stand and record our own 24-hour, org-wide, per-tool one on top.
        granted = await grants.grant(
            organization_id=organization_id, tool=row.tool, user_id=user_id
        )

    return {
        "id": row.id,
        "tool": row.tool,
        "status": "confirmed" if approved else "cancelled",
        "decided": True,
        "grant": grants.serialize(granted) if granted else None,
    }


async def stop(*, organization_id: str, run_id: str) -> dict[str, Any]:
    connection, api_key = await conn.require_api_key(organization_id)
    if not connection.agentId:
        raise qlix.QlixError("This organization has no Qlix agent")
    await qlix.stop_run(api_key, agent_id=connection.agentId, run_id=run_id)
    return {"stopped": True, "run_id": run_id}
