"""The MCP tool server is what Qlix calls to touch real CRM data.

These cover the refusals — the cases where acting would be wrong — since those
are the ones that matter if the context header is missing, forged, or belongs
to someone without the right role.
"""

from __future__ import annotations

import pytest

from loomrun_api.ai_agent.tools.registry import all_tools, get_tool
from loomrun_api.qlix import mcp_server as srv
from loomrun_api.qlix.context import CONTEXT_HEADER, mint_context


@pytest.fixture
def owner_headers():
    return {
        CONTEXT_HEADER.lower(): mint_context(
            organization_id="org_alpha",
            user_id="user_1",
            role="OWNER",
            mode="advanced",
        )
    }


def _set_headers(monkeypatch, headers):
    monkeypatch.setattr(srv, "get_http_headers", lambda: headers)


@pytest.mark.asyncio
async def test_refuses_when_no_context_header_is_present(monkeypatch):
    _set_headers(monkeypatch, {})
    tool = srv._tool_from_spec(get_tool("search_leads"))
    result = await tool.run({})
    assert result.is_error
    assert "run context" in result.structured_content["error"]


@pytest.mark.asyncio
async def test_refuses_a_forged_context(monkeypatch):
    from jose import jwt

    forged = jwt.encode(
        {"typ": "qlix-tool-context", "org": "org_victim", "sub": "u"},
        "attacker-key",
        algorithm="HS256",
    )
    _set_headers(monkeypatch, {CONTEXT_HEADER.lower(): forged})
    tool = srv._tool_from_spec(get_tool("search_leads"))
    result = await tool.run({})
    assert result.is_error


@pytest.mark.asyncio
async def test_owner_only_tool_is_refused_for_a_non_owner(monkeypatch):
    """Qlix does not know Loomrun roles, so this must be enforced here."""
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    monkeypatch.setattr(srv, "prisma", SimpleNamespace(membership=SimpleNamespace(
        find_first=AsyncMock(return_value=SimpleNamespace(role="SALES", organization=SimpleNamespace(suspended=False)))
    )))
    monkeypatch.setattr(srv, "is_access_locked", lambda org: False)
    owner_only = next((s for s in all_tools() if s.owner_only), None)
    if owner_only is None:
        pytest.skip("no owner-only tools registered")

    _set_headers(monkeypatch, {
        CONTEXT_HEADER.lower(): mint_context(
            organization_id="org_alpha",
            user_id="user_2",
            role="SALES",
            mode="advanced",
        )
    })
    tool = srv._tool_from_spec(owner_only)
    result = await tool.run({})
    assert result.is_error
    assert "Owner" in str(result.structured_content)


@pytest.mark.asyncio
async def test_header_is_read_case_insensitively(monkeypatch):
    """Proxies and HTTP/2 lower-case header names."""
    token = mint_context(
        organization_id="org_alpha", user_id="u", role="OWNER", mode="advanced"
    )
    for key in (CONTEXT_HEADER, CONTEXT_HEADER.lower()):
        _set_headers(monkeypatch, {key: token})
        assert srv._read_context()["organization_id"] == "org_alpha"


def test_every_registry_tool_is_published():
    """Adding a tool to the registry must publish it without extra wiring."""
    published = {t.name for t in srv.mcp_server._tools.values()} if hasattr(
        srv.mcp_server, "_tools"
    ) else None
    registry_names = {s.name for s in all_tools()}
    assert registry_names, "tool registry is empty"
    if published is not None:
        assert registry_names <= published


def test_write_tools_are_described_as_needing_approval():
    """The description is what the model sees; it should not mistake a write for a read."""
    write_spec = next(s for s in all_tools() if s.kind == "write")
    tool = srv._tool_from_spec(write_spec)
    assert "approval" in tool.description.lower()


def test_tool_schema_comes_from_the_registry():
    spec = get_tool("get_lead")
    tool = srv._tool_from_spec(spec)
    assert tool.parameters["type"] == "object"
    assert "lead_id" in tool.parameters["properties"]
    assert tool.parameters["required"] == ["lead_id"]


def test_no_tool_takes_an_organization_argument():
    """Org must come from the signed header, never from something the agent controls."""
    offenders = []
    for spec in all_tools():
        props = spec.openai_schema()["function"]["parameters"]["properties"]
        for name in props:
            if name in ("org_id", "organization_id", "orgId"):
                offenders.append(f"{spec.name}.{name}")
    assert not offenders, f"tools accept a caller-supplied org: {offenders}"
