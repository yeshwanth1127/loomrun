"""Orchestrate Loomrun AI chat turns with plan-based tools and confirmations."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator

from fastapi import HTTPException, status

from loomrun_api.ai_agent.conversations import append_message, ensure_conversation
from loomrun_api.ai_agent.crm_mutations import mutation_from_tool
from loomrun_api.ai_agent.crm_read_enforce import (
    direct_count_reply,
    force_crm_read_tool,
    requires_crm_read_tool,
)
from loomrun_api.ai_agent.knowledge import build_knowledge_pack
from loomrun_api.ai_agent.memory import get_org_memory, schedule_memory_extraction
from loomrun_api.ai_agent.models import models_payload, resolve_chat_model
from loomrun_api.ai_agent.prompts import build_system_prompt, build_write_intent_prompt
from loomrun_api.services.leads import clock_instructions, user_clock
from loomrun_api.ai_agent.tools import pending as pending_store
from loomrun_api.ai_agent.tools.registry import (
    ToolContext,
    get_tool,
    is_simple_create_lead,
    openai_tools_for_message,
)
from loomrun_api.ai_agent.tools.runtime import dispatch_tool_call, execute_confirmed_tool
from loomrun_api.ai_usage import (
    accumulate_usage,
    debit_ai_usage,
    get_ai_windows,
    require_ai_capacity,
)
from loomrun_api.config import settings
from loomrun_api.entitlements import (
    ai_mode_label,
    get_org_entitlements,
    is_access_locked,
    normalize_plan,
    trial_payload,
)
from loomrun_api.llm_client import LlmError, chat_messages
from loomrun_api.logging_setup import kv, sanitize_log_text
from loomrun_api.qlix import chat as qlix_chat
from loomrun_api.qlix import connection as qlix_conn
from loomrun_api.qlix.client import QlixError
from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)

_HISTORY_LIMIT = {"minimal": 6, "advanced": 8}
_MAX_MESSAGE_LEN = 4000
_MAX_TOOL_ITERATIONS = 6
_WRAP_UP_RESULT_CHARS = 800
# Cap on a tool result appended to `messages`. An uncapped search_leads(limit=50)
# is ~21,770 chars and is re-sent on every later iteration of the tool loop.
_MAX_TOOL_RESULT_CHARS = 2500


async def get_ai_status(organization_id: str) -> dict[str, Any]:
    org = await prisma.organization.find_unique(where={"id": organization_id})
    models = models_payload()
    memory = await get_org_memory(organization_id) if org else None
    if not org:
        return {
            "available": False,
            "mode": "disabled",
            "plan": "free",
            "multilingual": False,
            "upgrade_required": True,
            "models": models,
        }
    plan = normalize_plan(org.plan)
    ents = get_org_entitlements(org)
    mode = ai_mode_label(ents)
    usage = await get_ai_windows(organization_id, ents, org_created_at=org.createdAt)
    return {
        "available": ents.ai_chat is not False and not is_access_locked(org),
        "mode": mode,
        "plan": plan,
        "multilingual": ents.ai_multilingual,
        "upgrade_required": is_access_locked(org),
        "trial": trial_payload(org),
        "usage": usage,
        "models": models,
        "memory": {
            "summary": (memory or {}).get("summary") or "",
            "facts": (memory or {}).get("facts") or {},
            "updated_at": (memory or {}).get("updated_at"),
        },
        "agent": {
            "tools_enabled": ents.ai_chat is not False,
            "writes_enabled": ents.ai_chat == "advanced",
            "memory_enabled": True,
        },
        "qlix": await _qlix_status(organization_id),
    }


async def _maybe_mark_qlix_auth_failure(organization_id: str, exc: Exception) -> None:
    if isinstance(exc, QlixError) and exc.unauthorized:
        await qlix_conn.mark_error(organization_id, str(exc))


async def _attach_qlix_key_valid(state: dict[str, Any], row) -> None:
    from loomrun_api.qlix import provisioner as qlix_provisioner

    if not row:
        return
    if row.status == qlix_conn.STATUS_ERROR:
        state["key_valid"] = False
        return
    if row.status != qlix_conn.STATUS_CONNECTED:
        return
    probe = await qlix_provisioner.probe_key(row)
    if probe is not None:
        state["key_valid"] = probe


async def _qlix_status(organization_id: str) -> dict[str, Any]:
    """Whether this org runs on its own Qlix agent, and how its sync is doing."""
    from loomrun_api.qlix import sync as qlix_sync

    if not settings.qlix_enabled:
        # Report it as off rather than probing: the UI then shows the in-house
        # agent as the one answering, which is the truth.
        return {"status": "disabled", "configured": False, "enabled": False}

    row = await qlix_conn.get_connection(organization_id)
    state = qlix_conn.public_state(row)
    state["configured"] = settings.qlix_ready
    if row and row.status == qlix_conn.STATUS_CONNECTED:
        try:
            from loomrun_api.qlix import provisioner as qlix_provisioner

            await qlix_provisioner.mark_backfill_complete_if_drained(organization_id)
            row = await qlix_conn.get_connection(organization_id)
            state = qlix_conn.public_state(row)
            state["configured"] = settings.qlix_ready
            state["sync"] = await qlix_sync.sync_progress(organization_id)
        except Exception:
            logger.exception("Could not read Qlix sync progress for %s", organization_id)
    await _attach_qlix_key_valid(state, row)
    return state


def _tool_result_text(
    payload: dict[str, Any], *, limit: int = _MAX_TOOL_RESULT_CHARS
) -> str:
    """Serialise a tool result, trimming the row list rather than the summary.

    Counts and totals stay intact: several tool descriptions tell the model that
    `total` is authoritative and may exceed the rows returned, so a blind string
    truncation would make it under-report. Drop whole rows off the end instead
    and say how many were kept.
    """
    text = json.dumps(payload, default=str)
    if len(text) <= limit:
        return text

    result = payload.get("result") if isinstance(payload, dict) else None
    for key in ("items", "leads", "rows", "results"):
        rows = (result or {}).get(key) if isinstance(result, dict) else None
        if not isinstance(rows, list) or not rows:
            continue
        kept = list(rows)
        while kept:
            kept.pop()
            trimmed = {
                **payload,
                "result": {
                    **result,
                    key: kept,
                    "_truncated": (
                        f"showing {len(kept)} of {len(rows)} rows to save context; "
                        "any count/total field above remains authoritative"
                    ),
                },
            }
            text = json.dumps(trimmed, default=str)
            if len(text) <= limit:
                return text

    return json.dumps(payload, default=str)[:limit] + "…[truncated]"


async def _begin_turn(
    *,
    organization_id: str,
    user_id: str,
    message: str,
    history: list[dict[str, str]] | None,
    model: str | None,
    conversation_id: str | None,
) -> dict[str, Any]:
    """Validate, gate and open a chat turn.

    Everything here applies whichever agent answers: message limits, trial and
    plan checks, dual AI credit windows (5h + weekly), the conversation record,
    and persisting the user's message. Loomrun keeps owning these even when Qlix
    runs the agent.
    """
    text = (message or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="message is required")
    if len(text) > _MAX_MESSAGE_LEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"message must be at most {_MAX_MESSAGE_LEN} characters",
        )

    chosen_model = resolve_chat_model(model)
    conv_id = await ensure_conversation(
        organization_id=organization_id,
        user_id=user_id,
        conversation_id=conversation_id,
    )

    org = await prisma.organization.find_unique(where={"id": organization_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")

    if is_access_locked(org):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail="Your 14-day free trial has ended. Upgrade to Growth or Scale to continue.",
        )

    plan = normalize_plan(org.plan)
    ents = get_org_entitlements(org)
    if ents.ai_chat is False:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="AI chat is not available on your current plan. Please upgrade.",
        )

    if settings.qlix_enabled:
        # Only meaningful while Qlix owns the turn — the in-process agent has no
        # provisioning step to wait on, so this must not gate it.
        from loomrun_api.qlix.provisioner import chat_blocked_reason

        blocked = await chat_blocked_reason(organization_id)
        if blocked:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=blocked)

    await require_ai_capacity(
        organization_id,
        ents=ents,
        org_created_at=org.createdAt,
    )

    # Prefer persisted conversation history when available. Take the NEWEST
    # rows — ordering ascending with a cap returns the oldest messages in a long
    # thread, which is the opposite of the context the turn needs.
    persisted = await prisma.aimessage.find_many(
        where={"conversationId": conv_id},
        order={"createdAt": "desc"},
        take=40,
    )
    if persisted:
        history = [
            {"role": m.role, "content": m.content}
            for m in reversed(persisted)
            if m.role in ("user", "assistant")
        ]

    user_message = await append_message(
        conversation_id=conv_id,
        role="user",
        content=text,
        set_title_from_user=True,
    )

    logger.info(
        "ai turn start %s",
        kv(
            org=organization_id,
            user=user_id,
            conversation=conv_id,
            model=chosen_model,
            plan=plan,
            mode=str(ents.ai_chat),
            message=sanitize_log_text(text, limit=2000) if settings.log_ai_messages else f"len={len(text)}",
        ),
    )

    return {
        "text": text,
        "chosen_model": chosen_model,
        "conv_id": conv_id,
        "user_message_id": user_message["id"],
        "org": org,
        "plan": plan,
        "ents": ents,
        "mode": str(ents.ai_chat),
        "history": history,
    }


async def _persist_abandoned_turn(
    *,
    organization_id: str,
    conv_id: str,
    final_reply: str,
    pending_actions: list[dict[str, Any]],
    citations: list[Any],
    auto_approved: list[dict[str, Any]],
    ents: Any | None = None,
) -> None:
    """Save a reply whose reader disconnected before the turn could settle.

    Best-effort and deliberately quiet: the caller is already unwinding on a
    cancellation, so anything raised here would replace a normal shutdown with
    a spurious error. Still meters usage when entitlements are available — the
    LLM work already happened.
    """
    try:
        await append_message(
            conversation_id=conv_id,
            role="assistant",
            content=final_reply,
            model="qlix",
            metadata={
                "pending_actions": pending_actions,
                "citations": citations,
                "auto_approved": auto_approved,
                "abandoned": True,
            },
        )
        if ents is not None:
            await debit_ai_usage(
                organization_id,
                ents=ents,
                source="qlix",
                model="qlix",
                conversation_id=conv_id,
            )
    except Exception:
        logger.exception(
            "Could not persist abandoned turn for org %s conversation %s",
            organization_id,
            conv_id,
        )


async def stream_chat(
    *,
    organization_id: str,
    user_id: str,
    role: str,
    message: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
    conversation_id: str | None = None,
    timezone: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a turn's events. Qlix-backed orgs stream token by token.

    Orgs still on the local agent get the same event shape in one piece, so the
    frontend only has to implement one protocol.
    """
    turn = await _begin_turn(
        organization_id=organization_id,
        user_id=user_id,
        message=message,
        history=history,
        model=model,
        conversation_id=conversation_id,
    )
    conv_id = turn["conv_id"]
    mode = turn["mode"]

    yield {"type": "start", "conversation_id": conv_id}

    direct = await direct_count_reply(
        organization_id=organization_id,
        message=turn["text"],
        timezone=timezone,
    )
    if direct:
        logger.info(
            "ai turn path %s",
            kv(org=organization_id, conversation=conv_id, path="direct_count"),
        )
        yield {"type": "delta", "text": direct}
        result = await _finish_turn(
            organization_id=organization_id,
            conv_id=conv_id,
            text=turn["text"],
            final_reply=direct,
            pending_actions=[],
            citations=[],
            auto_approved=[],
            crm_mutations=[],
            model_used="crm",
            no_llm=True,
            chosen_model=turn["chosen_model"],
            mode=mode,
            plan=turn["plan"],
            ents=turn["ents"],
            usage_source="chat",
        )
        yield {"type": "done", **result}
        return

    connection = (
        await qlix_conn.get_connection(organization_id)
        if settings.qlix_enabled
        else None
    )
    can_stream = (
        connection
        and connection.status == qlix_conn.STATUS_CONNECTED
        and bool(qlix_conn.read_api_key(connection))
    )

    if can_stream:
        logger.info(
            "ai turn path %s",
            kv(org=organization_id, conversation=conv_id, path="qlix"),
        )
        text_parts: list[str] = []
        pending_actions: list[dict[str, Any]] = []
        auto_approved: list[dict[str, Any]] = []
        crm_mutations: list[dict[str, Any]] = []
        citations: list[Any] = []
        run_id: str | None = None
        settled = False
        try:
            async for event in qlix_chat.run_turn(
                organization_id=organization_id,
                user_id=user_id,
                role=role,
                mode=mode,
                message=turn["text"],
                conversation_id=conv_id,
                user_message_id=turn["user_message_id"],
                model=model,
                timezone=timezone,
            ):
                kind = event.get("type")
                if kind == "run":
                    run_id = event["run_id"]
                    yield {"type": "run", "run_id": run_id}
                elif kind == "delta":
                    text_parts.append(event["text"])
                    yield {"type": "delta", "text": event["text"]}
                elif kind == "pending_action":
                    pending_actions.append(event["action"])
                    yield {"type": "pending_action", "action": event["action"]}
                elif kind == "auto_approved":
                    auto_approved.append(event["action"])
                    yield {"type": "auto_approved", "action": event["action"]}
                elif kind == "crm_mutation":
                    crm_mutations.append(event["mutation"])
                    yield {"type": "crm_mutation", "mutation": event["mutation"]}
                elif kind == "tool":
                    # Progress only — the UI shows what the agent is doing while
                    # it works. Nothing downstream depends on these.
                    yield {"type": "tool", "tool": event["tool"]}
                elif kind == "done":
                    citations = event["citations"]
                    pending_actions = event["pending_actions"] or pending_actions
                    auto_approved = event.get("auto_approved") or auto_approved
                    crm_mutations = event.get("crm_mutations") or crm_mutations
                    final = event["text"] or "".join(text_parts)
                    result = await _finish_turn(
                        organization_id=organization_id,
                        conv_id=conv_id,
                        text=turn["text"],
                        final_reply=final,
                        pending_actions=pending_actions,
                        citations=citations,
                        auto_approved=auto_approved,
                        crm_mutations=crm_mutations,
                        model_used="qlix",
                        chosen_model=turn["chosen_model"],
                        mode=mode,
                        plan=turn["plan"],
                        ents=turn["ents"],
                        usage_source="qlix",
                    )
                    settled = True
                    yield {"type": "done", **result}
                    return
        except (GeneratorExit, asyncio.CancelledError):
            # The reader went away (tab closed, navigation, network drop). The
            # agent still ran and the org was still billed for it, so persist
            # what it produced instead of losing the turn: otherwise the reply
            # is missing from history and the user sees nothing at all.
            if text_parts and not settled:
                await _persist_abandoned_turn(
                    organization_id=organization_id,
                    conv_id=conv_id,
                    final_reply="".join(text_parts),
                    pending_actions=pending_actions,
                    citations=citations,
                    auto_approved=auto_approved,
                    ents=turn.get("ents"),
                )
            raise
        except (QlixError, qlix_conn.NotConnectedError) as exc:
            await _maybe_mark_qlix_auth_failure(organization_id, exc)
            logger.warning(
                "Qlix stream failed for org %s, falling back to local agent: %s",
                organization_id,
                exc,
            )
        except Exception:
            logger.exception("Unexpected Qlix stream failure for org %s", organization_id)

        if text_parts:
            # Partial text already reached the user; finish that turn rather
            # than re-running it locally and contradicting what they just read.
            result = await _finish_turn(
                organization_id=organization_id,
                conv_id=conv_id,
                text=turn["text"],
                final_reply="".join(text_parts),
                pending_actions=pending_actions,
                citations=citations,
                auto_approved=auto_approved,
                crm_mutations=crm_mutations,
                model_used="qlix",
                chosen_model=turn["chosen_model"],
                mode=mode,
                plan=turn["plan"],
                ents=turn["ents"],
                usage_source="qlix",
            )
            yield {"type": "done", **result}
            return

        yield {"type": "reset"}

    logger.info(
        "ai turn path %s",
        kv(org=organization_id, conversation=conv_id, path="local"),
    )
    local_result: dict[str, Any] = {}
    async for kind, payload in _local_turn_events(
        turn=turn,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        model=model,
        timezone=timezone,
    ):
        if kind == "tool":
            yield {"type": "tool", "tool": payload}
        elif kind == "crm_mutation":
            yield {"type": "crm_mutation", "mutation": payload}
        elif kind == "result":
            local_result = payload
    yield {"type": "done", **local_result}


async def run_chat(
    *,
    organization_id: str,
    user_id: str,
    role: str,
    message: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
    conversation_id: str | None = None,
    timezone: str | None = None,
) -> dict[str, Any]:
    turn = await _begin_turn(
        organization_id=organization_id,
        user_id=user_id,
        message=message,
        history=history,
        model=model,
        conversation_id=conversation_id,
    )
    text = turn["text"]
    chosen_model = turn["chosen_model"]
    conv_id = turn["conv_id"]
    plan = turn["plan"]
    ents = turn["ents"]
    mode = turn["mode"]

    direct = await direct_count_reply(
        organization_id=organization_id,
        message=text,
        timezone=timezone,
    )
    if direct:
        return await _finish_turn(
            organization_id=organization_id,
            conv_id=conv_id,
            text=text,
            final_reply=direct,
            pending_actions=[],
            citations=[],
            auto_approved=[],
            crm_mutations=[],
            model_used="crm",
            no_llm=True,
            chosen_model=chosen_model,
            mode=mode,
            plan=plan,
            ents=ents,
            usage_source="chat",
        )

    # Qlix-backed orgs run the whole turn on their own agent: it holds the
    # knowledge base, calls Loomrun's CRM tools over MCP, and gates writes
    # behind its approval flow. Everything around the turn — plan limits,
    # usage metering, conversation history — stays here.
    qlix_result = await _try_qlix_turn(
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        mode=mode,
        message=text,
        conversation_id=conv_id,
        user_message_id=turn["user_message_id"],
        model=model,
        timezone=timezone,
    )
    if qlix_result is not None:
        return await _finish_turn(
            organization_id=organization_id,
            conv_id=conv_id,
            text=text,
            final_reply=qlix_result["text"],
            pending_actions=qlix_result["pending_actions"],
            citations=qlix_result["citations"],
            auto_approved=qlix_result.get("auto_approved") or [],
            crm_mutations=qlix_result.get("crm_mutations") or [],
            model_used="qlix",
            chosen_model=chosen_model,
            mode=mode,
            plan=plan,
            ents=ents,
            usage_source="qlix",
        )

    return await _run_local_turn(
        turn=turn,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        model=model,
        timezone=timezone,
    )


async def _local_turn_events(
    *,
    turn: dict[str, Any],
    organization_id: str,
    user_id: str,
    role: str,
    model: str | None,
    timezone: str | None = None,
) -> AsyncIterator[tuple[str, Any]]:
    """Loomrun's original in-process agent: OpenRouter plus the tool registry.

    Yields ``("tool", info)`` as each tool runs so the UI can show progress,
    then exactly one ``("result", payload)`` with the finished turn. Callers
    that only want the answer should use :func:`_run_local_turn`.

    Kept as the path for orgs that have not activated a Qlix agent, and as the
    fallback when Qlix is unreachable.
    """
    text = turn["text"]
    chosen_model = turn["chosen_model"]
    conv_id = turn["conv_id"]
    org = turn["org"]
    plan = turn["plan"]
    ents = turn["ents"]
    mode = turn["mode"]
    history = turn["history"]

    # Obvious single-write turns skip the heavy knowledge pack + history so
    # create-lead style requests do not re-pay thousands of prompt tokens.
    simple_write = mode == "advanced" and is_simple_create_lead(text)
    if simple_write:
        system = build_write_intent_prompt(org_name=org.name)
        hist_limit = 0
    else:
        knowledge = await build_knowledge_pack(organization_id=organization_id, mode=mode)
        memory = await get_org_memory(organization_id)
        system = build_system_prompt(
            mode=mode,
            org_name=org.name,
            knowledge=knowledge,
            memory=memory.get("formatted") or "",
        )
        hist_limit = _HISTORY_LIMIT.get(mode, 6)

    clock = user_clock(timezone)
    system = f"{system}\n\n{clock_instructions(clock)}"

    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    # Named `past` rather than `turn`/`role`: both of those are live names in
    # this function (the turn dict and the caller's org role), and rebinding
    # them here left `role` holding a chat role like "user" for the rest of the
    # turn — which is what builds the tool list and the tool context below.
    for past in (history or [])[-hist_limit:]:
        past_role = past.get("role")
        content = (past.get("content") or "").strip()
        if past_role in ("user", "assistant") and content:
            messages.append({"role": past_role, "content": content[:_MAX_MESSAGE_LEN]})
    messages.append({"role": "user", "content": text})

    tools = openai_tools_for_message(mode, role=role, message=text)
    tool_ctx = ToolContext(
        organization_id=organization_id,
        user_id=user_id,
        mode=mode,
        role=role,
        timezone=timezone or "",
    )
    pending_actions: list[dict[str, Any]] = []
    crm_mutations: list[dict[str, Any]] = []
    temperature = 0.3 if mode == "minimal" else 0.4
    model_used: str | None = chosen_model
    final_reply = ""
    citations = []
    token_totals: dict[str, int] = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "cached_tokens": 0,
    }
    write_summaries: list[str] = []

    logger.info(
        "ai local tools %s",
        kv(
            org=organization_id,
            conversation=conv_id,
            simple_write=simple_write,
            tool_count=len(tools),
            tools=",".join(
                sorted(
                    {
                        (t.get("function") or {}).get("name") or "?"
                        for t in tools
                        if isinstance(t, dict)
                    }
                )
            ),
        ),
    )

    # Force the CRM read at most once per turn. `requires_crm_read_tool` tests
    # the unchanged original message, so without this the same read re-fires on
    # every pass — observed running count_leads four times in one turn until the
    # iteration budget was spent, then discarding an answer it already had.
    forced_read_done = False

    try:
        for _ in range(_MAX_TOOL_ITERATIONS):
            result = await chat_messages(
                messages=messages,
                model=chosen_model,
                temperature=temperature,
                tools=tools or None,
                session_id=organization_id,
            )
            model_used = result.get("model") or model_used
            accumulate_usage(token_totals, result.get("usage"))
            tool_calls = result.get("tool_calls") or []
            content = (result.get("content") or "").strip()

            if not tool_calls:
                if not forced_read_done and requires_crm_read_tool(text):
                    forced = await force_crm_read_tool(tool_ctx, text)
                    if forced:
                        forced_read_done = True
                        name, outcome = forced
                        yield (
                            "tool",
                            {
                                "name": name,
                                "phase": "error"
                                if outcome.get("status") == "error"
                                else "done",
                                "args": {},
                            },
                        )
                        messages.append(
                            {
                                "role": "user",
                                "content": (
                                    f"[System: {name} was executed — quote this "
                                    f"result; do not invent CRM facts.]\n"
                                    f"{_tool_result_text(outcome)}"
                                ),
                            }
                        )
                        continue
                final_reply = content
                break

            raw_msg = result.get("raw_message") or {
                "role": "assistant",
                "content": content or None,
                "tool_calls": tool_calls,
            }
            messages.append(raw_msg)

            stop_for_confirmation = False
            executed_write = False
            for tc in tool_calls:
                fn = (tc.get("function") or {}) if isinstance(tc, dict) else {}
                name = fn.get("name") or ""
                args_raw = fn.get("arguments") or "{}"
                tc_id = tc.get("id") or name

                yield ("tool", {"name": name, "phase": "running", "args": {}})
                outcome = await dispatch_tool_call(
                    ctx=tool_ctx,
                    name=name,
                    arguments=args_raw,
                    # No confirmation step: writes execute as soon as the model
                    # asks for them, matching the Qlix path where every tool is
                    # governed "auto". Leaving this True here would make the
                    # local fallback agent behave differently from the primary
                    # one for the same request.
                    propose_writes=False,
                )
                yield (
                    "tool",
                    {
                        "name": name,
                        "phase": "error" if outcome.get("status") == "error" else "done",
                        "args": {},
                    },
                )
                if outcome.get("status") == "needs_confirmation":
                    pa = outcome.get("pending_action")
                    if pa:
                        pending_actions.append(pa)
                    stop_for_confirmation = True
                elif outcome.get("status") == "ok":
                    spec = get_tool(name)
                    if spec and spec.kind == "write":
                        executed_write = True
                        write_summaries.append(
                            f"{name}: {_tool_result_text(outcome)[:_WRAP_UP_RESULT_CHARS]}"
                        )
                        mutation = mutation_from_tool(name, outcome)
                        if mutation:
                            crm_mutations.append(mutation)
                            yield ("crm_mutation", mutation)

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": _tool_result_text(outcome),
                    }
                )

            if stop_for_confirmation or executed_write:
                # Cheap wrap-up: do not re-send the full system+history+tools
                # transcript just to phrase "Done."
                if executed_write and write_summaries:
                    wrap_messages = [
                        {
                            "role": "system",
                            "content": (
                                f'You are Loomrun AI for "{org.name}". '
                                "Reply in one short sentence confirming what you did. "
                                "Only describe changes the tool results actually show — "
                                "never claim a quotation or invoice line changed unless "
                                "update_quotation (or create_quotation) returned ok with "
                                "the new lines. If you only updated the lead, say that."
                            ),
                        },
                        {
                            "role": "user",
                            "content": (
                                f"User asked: {text}\n"
                                f"Tool results:\n" + "\n".join(write_summaries)
                            ),
                        },
                    ]
                else:
                    wrap_messages = messages
                follow = await chat_messages(
                    messages=wrap_messages,
                    model=chosen_model,
                    temperature=0.2,
                    tools=None,
                )
                model_used = follow.get("model") or model_used
                accumulate_usage(token_totals, follow.get("usage"))
                final_reply = (follow.get("content") or "").strip()
                if not final_reply and pending_actions:
                    final_reply = (
                        "I prepared the following action"
                        + ("s" if len(pending_actions) > 1 else "")
                        + " — please confirm to proceed:\n"
                        + "\n".join(f"• {p['summary']}" for p in pending_actions)
                    )
                break
        else:
            final_reply = final_reply or "I hit the tool step limit. Please try a simpler request."

    except LlmError as exc:
        logger.warning(
            "ai turn llm error %s",
            kv(org=organization_id, conversation=conv_id, error=str(exc), status=exc.status_code),
        )
        code = status.HTTP_502_BAD_GATEWAY
        if "not configured" in str(exc).lower():
            code = status.HTTP_503_SERVICE_UNAVAILABLE
        raise HTTPException(code, detail=str(exc)) from exc

    yield (
        "result",
        await _finish_turn(
            organization_id=organization_id,
            conv_id=conv_id,
            text=text,
            final_reply=final_reply,
            pending_actions=pending_actions,
            citations=citations,
            auto_approved=None,
            crm_mutations=crm_mutations,
            model_used=model_used,
            chosen_model=chosen_model,
            mode=mode,
            plan=plan,
            ents=ents,
            prompt_tokens=token_totals["prompt_tokens"],
            completion_tokens=token_totals["completion_tokens"],
            cached_tokens=token_totals.get("cached_tokens", 0),
            usage_source="chat",
        ),
    )


async def _run_local_turn(**kwargs: Any) -> dict[str, Any]:
    """Run the local agent and return only its final result."""
    result: dict[str, Any] = {}
    async for kind, payload in _local_turn_events(**kwargs):
        if kind == "result":
            result = payload
    return result


async def _try_qlix_turn(
    *,
    organization_id: str,
    user_id: str,
    role: str,
    mode: str,
    message: str,
    conversation_id: str,
    user_message_id: str,
    model: str | None,
    timezone: str | None = None,
) -> dict[str, Any] | None:
    """Run the turn on Qlix, or return None to fall back to the local agent.

    Falling back rather than failing is deliberate: a Qlix outage should
    degrade the assistant, not take chat down for the org.
    """
    if not settings.qlix_enabled:
        return None
    connection = await qlix_conn.get_connection(organization_id)
    if (
        not connection
        or connection.status != qlix_conn.STATUS_CONNECTED
        or not qlix_conn.read_api_key(connection)
    ):
        return None

    try:
        return await qlix_chat.collect_turn(
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            mode=mode,
            message=message,
            conversation_id=conversation_id,
            user_message_id=user_message_id,
            model=model,
            timezone=timezone,
        )
    except (QlixError, qlix_conn.NotConnectedError) as exc:
        await _maybe_mark_qlix_auth_failure(organization_id, exc)
        logger.warning(
            "Qlix turn failed for org %s, falling back to local agent: %s",
            organization_id,
            exc,
        )
        return None
    except Exception:
        logger.exception("Unexpected Qlix turn failure for org %s", organization_id)
        return None


async def _finish_turn(
    *,
    organization_id: str,
    conv_id: str,
    text: str,
    final_reply: str,
    pending_actions: list[dict[str, Any]],
    citations: list[Any],
    auto_approved: list[dict[str, Any]] | None,
    crm_mutations: list[dict[str, Any]] | None = None,
    model_used: str | None,
    chosen_model: str,
    mode: str,
    plan: str,
    ents: Any,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    cached_tokens: int = 0,
    usage_source: str = "chat",
    no_llm: bool = False,
) -> dict[str, Any]:
    """Persist the reply and meter the turn — shared by both agent paths."""
    if not final_reply:
        final_reply = (
            "Done." if not pending_actions else "Please confirm the proposed action(s) below."
        )

    metadata: dict[str, Any] = {}
    if pending_actions:
        metadata["pending_actions"] = pending_actions
    if citations:
        metadata["citations"] = citations
    if auto_approved:
        # Persisted, not just streamed: an action taken under a standing
        # approval must still be visible when the conversation is reopened.
        metadata["auto_approved"] = auto_approved
    if crm_mutations:
        metadata["crm_mutations"] = crm_mutations

    await append_message(
        conversation_id=conv_id,
        role="assistant",
        content=final_reply,
        model=model_used,
        metadata=metadata or None,
    )

    source = "qlix" if usage_source == "qlix" or model_used == "qlix" else "chat"
    usage = await debit_ai_usage(
        organization_id,
        ents=ents,
        source=source,  # type: ignore[arg-type]
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        model=model_used or chosen_model,
        conversation_id=conv_id,
        no_llm=no_llm,
    )

    schedule_memory_extraction(
        organization_id=organization_id,
        user_message=text,
        assistant_reply=final_reply,
        model=settings.openrouter_default_model or chosen_model,
    )

    logger.info(
        "ai turn done %s",
        kv(
            org=organization_id,
            conversation=conv_id,
            model=model_used or chosen_model,
            path=source,
            pending_actions=len(pending_actions),
            auto_approved=len(auto_approved or []),
            crm_mutations=len(crm_mutations or []),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            reply=(
                sanitize_log_text(final_reply, limit=2000)
                if settings.log_ai_messages
                else f"len={len(final_reply)}"
            ),
        ),
    )

    return {
        "reply": final_reply,
        "pending_actions": pending_actions,
        "auto_approved": auto_approved or [],
        "crm_mutations": crm_mutations or [],
        "citations": citations,
        "conversation_id": conv_id,
        "mode": mode,
        "plan": plan,
        "multilingual": ents.ai_multilingual,
        "model": model_used,
        "requested_model": chosen_model,
        "usage": usage,
    }


async def confirm_action(
    *,
    organization_id: str,
    user_id: str,
    role: str,
    action_id: str,
) -> dict[str, Any]:
    org = await prisma.organization.find_unique(where={"id": organization_id})
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")
    if is_access_locked(org):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail="Trial expired")

    ents = get_org_entitlements(org)
    mode = ai_mode_label(ents)
    if ents.ai_chat != "advanced":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Confirming actions requires advanced AI (Scale / trial).",
        )

    # Actions raised by a Qlix run are approved in Qlix — the agent is holding
    # the tool call open and will execute it itself once we say yes.
    qlix_reply = await _decide_in_qlix(
        organization_id=organization_id,
        user_id=user_id,
        action_id=action_id,
        approved=True,
    )
    if qlix_reply is not None:
        return qlix_reply

    tool_name, payload = await pending_store.confirm_pending(
        action_id=action_id,
        organization_id=organization_id,
        user_id=user_id,
    )
    outcome = await execute_confirmed_tool(
        organization_id=organization_id,
        user_id=user_id,
        mode=mode,
        role=role,
        tool_name=tool_name,
        args=payload,
    )
    if outcome.get("status") == "error":
        raise HTTPException(
            outcome.get("http_status") or status.HTTP_400_BAD_REQUEST,
            detail=outcome.get("error") or "Action failed",
        )

    result = outcome.get("result") or {}
    reply = f"Done: {tool_name.replace('_', ' ')} completed successfully."
    if isinstance(result, dict):
        if result.get("message"):
            reply = str(result["message"])
        elif result.get("number"):
            reply = f"Created quotation {result['number']}."
        elif result.get("stage"):
            reply = f"Lead updated — stage is now {result['stage']}."
        elif result.get("title") and result.get("id"):
            reply = f"Lead “{result['title']}” saved."
        elif result.get("sent", {}).get("message"):
            reply = str(result["sent"]["message"])
        elif result.get("created", {}).get("number"):
            reply = f"Quotation {result['created']['number']} created and sent."

    mutation = mutation_from_tool(tool_name, outcome)
    return {
        "reply": reply,
        "tool": tool_name,
        "result": result,
        "action_id": action_id,
        "status": "confirmed",
        "crm_mutations": [mutation] if mutation else [],
    }


async def cancel_action(
    *,
    organization_id: str,
    user_id: str,
    action_id: str,
) -> dict[str, Any]:
    qlix_reply = await _decide_in_qlix(
        organization_id=organization_id,
        user_id=user_id,
        action_id=action_id,
        approved=False,
    )
    if qlix_reply is not None:
        return qlix_reply

    return await pending_store.cancel_pending(
        action_id=action_id,
        organization_id=organization_id,
        user_id=user_id,
    )


async def _decide_in_qlix(
    *,
    organization_id: str,
    user_id: str,
    action_id: str,
    approved: bool,
) -> dict[str, Any] | None:
    """Approve or deny in Qlix. Returns None when this action is not Qlix's."""
    row = await prisma.aipendingaction.find_first(
        where={
            "id": action_id,
            "organizationId": organization_id,
            "userId": user_id,
        }
    )
    if not row or not row.jitRequestId:
        return None

    try:
        result = await qlix_chat.decide(
            organization_id=organization_id,
            user_id=user_id,
            action_id=action_id,
            approved=approved,
        )
    except QlixError as exc:
        # Never report success we cannot verify: if Qlix did not record the
        # decision, the agent is still waiting and will time out as a denial.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    if not result.get("decided"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"That action is already {result.get('status', 'resolved')}.",
        )

    tool_label = str(result.get("tool") or "action").replace("_", " ")
    reply = (
        f"Approved — {tool_label} is running now."
        if approved
        else f"Cancelled {tool_label}. Nothing was changed."
    )
    return {
        "reply": reply,
        "tool": result.get("tool"),
        "result": {},
        "action_id": action_id,
        "status": result.get("status"),
    }
