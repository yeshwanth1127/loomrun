"""AI agent tools package — dynamic registry + runtime."""

from loomrun_api.ai_agent.tools import defs as _defs  # noqa: F401 — auto-register
from loomrun_api.ai_agent.tools.registry import (
    ToolContext,
    all_tools,
    get_tool,
    is_simple_create_lead,
    openai_tools_for_message,
    openai_tools_for_mode,
    register_tool,
    tools_for_mode,
)

__all__ = [
    "ToolContext",
    "all_tools",
    "get_tool",
    "is_simple_create_lead",
    "openai_tools_for_message",
    "openai_tools_for_mode",
    "register_tool",
    "tools_for_mode",
]
