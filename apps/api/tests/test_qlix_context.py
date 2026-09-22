"""The run-context token is the entire tenant boundary for tool execution.

If any of these pass wrongly, one org's agent can act on another org's data,
so they are worth testing directly rather than through the HTTP layer.
"""

from __future__ import annotations

import time

import pytest
from jose import jwt

from loomrun_api.config import settings
from loomrun_api.qlix.context import (
    CONTEXT_HEADER,
    ContextError,
    mint_context,
    tool_context_headers,
    verify_context,
)


def _mint(**overrides):
    kwargs = {
        "organization_id": "org_alpha",
        "user_id": "user_1",
        "role": "OWNER",
        "mode": "advanced",
    }
    kwargs.update(overrides)
    return mint_context(**kwargs)


def test_round_trip_preserves_identity():
    token = _mint(conversation_id="conv_9")
    identity = verify_context(token)
    assert identity["organization_id"] == "org_alpha"
    assert identity["user_id"] == "user_1"
    assert identity["role"] == "OWNER"
    assert identity["mode"] == "advanced"
    assert identity["conversation_id"] == "conv_9"


def test_round_trip_preserves_timezone():
    token = _mint(timezone="Asia/Kolkata")
    identity = verify_context(token)
    assert identity["timezone"] == "Asia/Kolkata"


def test_bearer_prefix_is_tolerated():
    # Qlix forwards the header verbatim, but proxies sometimes normalise it.
    token = _mint()
    assert verify_context(f"Bearer {token}")["organization_id"] == "org_alpha"


@pytest.mark.parametrize("value", [None, "", "   ", "not-a-token"])
def test_missing_or_garbage_is_rejected(value):
    with pytest.raises(ContextError):
        verify_context(value)


def test_tampering_with_the_org_is_rejected():
    """The whole point: an attacker cannot repoint a token at another org."""
    token = _mint()
    payload = jwt.get_unverified_claims(token)
    payload["org"] = "org_victim"
    forged = jwt.encode(payload, "some-other-key", algorithm="HS256")
    with pytest.raises(ContextError):
        verify_context(forged)


def test_a_loomrun_login_token_is_not_a_run_context():
    """Session tokens and tool contexts must not be interchangeable."""
    from loomrun_api.security import create_access_token

    with pytest.raises(ContextError):
        verify_context(create_access_token("user_1"))


def test_expired_token_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "qlix_context_ttl_seconds", 60)
    token = _mint()
    # Sign a token that expired a minute ago rather than sleeping.
    claims = jwt.get_unverified_claims(token)
    claims["exp"] = int(time.time()) - 60
    from loomrun_api.qlix.context import _signing_key

    stale = jwt.encode(claims, _signing_key(), algorithm="HS256")
    with pytest.raises(ContextError):
        verify_context(stale)


def test_token_without_an_org_is_rejected():
    from loomrun_api.qlix.context import TOKEN_TYPE, _signing_key

    claims = {"typ": TOKEN_TYPE, "sub": "user_1", "exp": int(time.time()) + 600}
    token = jwt.encode(claims, _signing_key(), algorithm="HS256")
    with pytest.raises(ContextError):
        verify_context(token)


def test_tool_context_uses_an_x_prefixed_header():
    """Qlix only forwards X-* names; anything else would be silently dropped."""
    headers = tool_context_headers(
        organization_id="org_alpha", user_id="u", role="OWNER", mode="advanced"
    )
    assert list(headers) == [CONTEXT_HEADER]
    assert CONTEXT_HEADER.startswith("X-")
