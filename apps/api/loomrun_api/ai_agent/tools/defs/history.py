"""Past-chat search tool for the agent."""

from __future__ import annotations

from typing import Any

from loomrun_api.ai_agent.conversations import search_messages
from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool


@register_tool(
    name="search_past_chats",
    description=(
        "WHEN: search previous Loomrun AI chat transcripts by keyword or day. "
        "NOT: finding a lead, customer, quotation or order (use search_leads / "
        "get_*). RETURNS: matching chat snippets."
    ),
    parameters={
        "query": {"type": "string", "description": "Keyword to search in past messages"},
        "day": {
            "type": "string",
            "description": "Optional YYYY-MM-DD to limit to that UTC day, or omit for all",
        },
        "limit": {"type": "integer", "default": 15},
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def search_past_chats(
    ctx: ToolContext,
    query: str | None = None,
    day: str | None = None,
    limit: int = 15,
    **_: Any,
) -> dict:
    return await search_messages(
        organization_id=ctx.organization_id,
        query=query,
        day=day,
        limit=limit,
    )
