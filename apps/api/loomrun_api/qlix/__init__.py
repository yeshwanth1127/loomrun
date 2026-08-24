"""Qlix integration — one Qlix workspace, agent and AI Brain per Loomrun org.

Loomrun provisions the tenant, keeps the Brain in sync with CRM data, and
exposes its own CRM tools to the agent over MCP. Qlix runs the agent loop.
"""

from loomrun_api.qlix.client import QlixError

__all__ = ["QlixError"]
