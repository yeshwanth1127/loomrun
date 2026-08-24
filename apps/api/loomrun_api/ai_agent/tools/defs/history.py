"""Past-chat search tool for the agent."""

from __future__ import annotations

from typing import Any

from loomrun_api.ai_agent.conversations import search_messages
from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool


@register_tool(
    name="search_past_chats",
    description=(
        "Search the transcript of previous Loomrun AI CHAT CONVERSATIONS — what "
        "was said in this assistant's earlier sessions. Use ONLY when the user "
        "asks what was discussed before, or for chat history by date/keyword. "
        "This does NOT search business records: it cannot find a lead, customer, "
        "quotation or order, and it returns nothing useful for 'find/move/update "
        "<person or company>'. To find a lead by name use search_leads."
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
