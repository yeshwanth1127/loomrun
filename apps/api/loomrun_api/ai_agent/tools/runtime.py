"""Execute or propose AI tools within an org-scoped ToolContext."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import HTTPException

from loomrun_api.ai_agent.tools import pending as pending_store
from loomrun_api.ai_agent.tools.registry import ToolContext, get_tool, summarize_args

logger = logging.getLogger(__name__)


def _drop_blanks(args: dict[str, Any]) -> dict[str, Any]:
    """Remove arguments the model sent as empty.

    Tool-calling models routinely emit "" or null for optional parameters they
    did not mean to set. Passed through, an empty string reaches an enum lookup
    like ``LeadStage[""]`` and raises KeyError, which the model reports to the
    user as "a technical issue" — the tool looks broken when nothing is wrong.
    None of these tools use "" to mean "clear this field", so dropping is safe;
    an explicit clear has its own parameter where one exists.
    """
    return {
        k: v
        for k, v in args.items()
        if v is not None and not (isinstance(v, str) and not v.strip())
    }


def _parse_args(raw: str | dict | None) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return _drop_blanks(raw)
    try:
        data = json.loads(raw)
        return _drop_blanks(data) if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def dispatch_tool_call(
    *,
    ctx: ToolContext,
    name: str,
    arguments: str | dict | None,
    propose_writes: bool = True,
) -> dict[str, Any]:
    """Run a tool. Write tools return needs_confirmation unless propose_writes=False."""
    spec = get_tool(name)
    if not spec:
        return {"error": f"Unknown tool: {name}"}
    if ctx.mode not in spec.modes:
        return {"error": f"Tool {name} is not available in {ctx.mode} mode"}
    if spec.owner_only and ctx.role != "OWNER":
        # Re-checked here (not just filtered out of the tool list shown to the
        # model) so this also blocks execution of an already-pending action —
        # same fail-closed posture as require_roles("OWNER") on the REST routes.
        return {"error": f"Tool {name} is only available to the organization Owner"}
    if spec.kind == "write" and ctx.mode != "advanced" and propose_writes:
        return {"error": f"Write tool {name} requires advanced AI mode"}

    args = _parse_args(arguments)

    if spec.kind == "write" and propose_writes:
        summary = summarize_args(spec, args)
        pending = await pending_store.create_pending_action(
            organization_id=ctx.organization_id,
            user_id=ctx.user_id,
            tool=name,
            payload=args,
            summary=summary,
        )
        return {
            "status": "needs_confirmation",
            "pending_action": pending,
            "message": (
                f"Proposed action requires user confirmation: {summary}. "
                "Do not claim it is done until confirmed."
            ),
        }

    try:
        result = await spec.handler(ctx, **args)
        return {"status": "ok", "result": result}
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return {"status": "error", "error": detail, "http_status": exc.status_code}
    except TypeError as exc:
        logger.warning("Tool %s bad args: %s", name, exc)
        return {"status": "error", "error": f"Invalid arguments for {name}: {exc}"}
    except Exception as exc:
        logger.exception("Tool %s failed", name)
        return {"status": "error", "error": str(exc)}


async def execute_confirmed_tool(
    *,
    organization_id: str,
    user_id: str,
    mode: str,
    role: str,
    tool_name: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    ctx = ToolContext(organization_id=organization_id, user_id=user_id, mode=mode, role=role)
    return await dispatch_tool_call(
        ctx=ctx,
        name=tool_name,
        arguments=args,
        propose_writes=False,
    )
