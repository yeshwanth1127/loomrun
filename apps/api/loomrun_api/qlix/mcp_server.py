"""Loomrun's CRM exposed to Qlix agents over MCP.

Qlix runs the agent loop but does not execute CRM logic — it calls this server
instead. The tools are generated from Loomrun's existing tool registry, so
adding a tool to ``ai_agent/tools/defs/`` publishes it here automatically.

Identity is taken **only** from the ``X-Loomrun-Context`` header that Qlix
forwards on every tool call, never from tool arguments. An agent therefore has
no way to name a different organization: the signed token decides, and Loomrun
minted it when it started the run.

Mounted into the FastAPI app, so it shares the API's Prisma connection and is
reachable at one public URL.
"""

from __future__ import annotations

import logging
from typing import Any

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers
from fastmcp.tools.tool import Tool, ToolResult

from loomrun_api.ai_agent.tools import defs as _defs  # noqa: F401  (registers tools)
from loomrun_api.ai_agent.tools.registry import ToolContext, ToolSpec, all_tools
from loomrun_api.ai_agent.tools.runtime import dispatch_tool_call
from loomrun_api.qlix.context import CONTEXT_HEADER, ContextError, verify_context
from loomrun_api.prisma_client import prisma
from loomrun_api.entitlements import is_access_locked

logger = logging.getLogger(__name__)


def _read_context() -> dict[str, Any]:
    """Pull the acting identity out of the forwarded request headers."""
    headers = get_http_headers() or {}
    # Header names arrive lower-cased over HTTP/2 and via most proxies.
    raw = headers.get(CONTEXT_HEADER.lower()) or headers.get(CONTEXT_HEADER)
    return verify_context(raw)


class LoomrunCrmTool(Tool):
    """One registry tool, published over MCP."""

    async def run(self, arguments: dict[str, Any]) -> ToolResult:
        try:
            identity = _read_context()
        except ContextError as exc:
            # Fail closed and say why, without leaking whether the org exists.
            logger.warning("Rejected MCP tool call %s: %s", self.name, exc)
            return ToolResult(
                structured_content={
                    "status": "error",
                    "error": "This request is missing a valid Loomrun run context.",
                },
                is_error=True,
            )

        membership = await prisma.membership.find_first(
            where={"organizationId": identity["organization_id"], "userId": identity["user_id"]},
            include={"organization": True},
        )
        if (not membership or not membership.organization
                or membership.organization.suspended or is_access_locked(membership.organization)):
            return ToolResult(structured_content={"status": "error", "error": "Organization access denied"}, is_error=True)
        role = membership.role.name if hasattr(membership.role, "name") else str(membership.role)
        ctx = ToolContext(
            organization_id=identity["organization_id"],
            user_id=identity["user_id"],
            mode=identity["mode"],
            role=role,
        )

        # propose_writes=False because Qlix's JIT layer now owns confirmation:
        # a write tool only reaches us after the user approved it. The registry
        # still re-checks owner-only permissions inside dispatch, so an
        # approved call from the wrong role is refused here too.
        outcome = await dispatch_tool_call(
            ctx=ctx,
            name=self.name,
            arguments=arguments,
            propose_writes=False,
        )

        is_error = outcome.get("status") == "error" or "error" in outcome
        return ToolResult(structured_content=outcome, is_error=bool(is_error))


def _tool_from_spec(spec: ToolSpec) -> LoomrunCrmTool:
    schema = spec.openai_schema()["function"]["parameters"]
    description = spec.description
    if spec.kind == "write":
        description += (
            " This changes data in Loomrun and requires the user's approval "
            "before it runs."
        )
    if spec.owner_only:
        description += " Only the organization Owner may run this."

    return LoomrunCrmTool(
        name=spec.name,
        description=description,
        parameters=schema,
        tags={spec.kind},
    )


def build_mcp_server() -> FastMCP:
    """Publish every registered CRM tool.

    The full catalogue is advertised and plan/role limits are enforced per
    call, rather than varying the advertised list per user. Qlix caches a
    server's tool catalogue for up to five minutes and shares it across that
    workspace's runs, so a per-user list could not be relied on anyway — and
    enforcing at execution is the stronger boundary regardless.
    """
    mcp = FastMCP(
        "loomrun_crm",
        instructions=(
            "Loomrun CRM tools for this organization. The acting organization, "
            "user and role come from the X-Loomrun-Context header supplied by "
            "Loomrun when the run started — never pass an organization id as an "
            "argument. Read tools run immediately; write tools change real "
            "business data and pause for the user's approval."
        ),
    )

    for spec in all_tools():
        mcp.add_tool(_tool_from_spec(spec))

    return mcp


mcp_server = build_mcp_server()
