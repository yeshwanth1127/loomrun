"""The signed run context Qlix forwards to Loomrun's MCP tool server.

Qlix runs the agent but knows nothing about Loomrun orgs, users or roles. When
Loomrun starts a run it mints a short-lived token naming exactly who the run
acts as; Qlix echoes it back on every tool call as ``X-Loomrun-Context``.

That token is the entire tenant boundary for tool execution, so it is signed
and it expires. Nothing about the acting identity is ever taken from tool
arguments — an agent that asks to act on another org simply cannot.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone as utc
from typing import Any

from jose import JWTError, jwt

from loomrun_api.config import settings

ALGORITHM = "HS256"
TOKEN_TYPE = "qlix-tool-context"
CONTEXT_HEADER = "X-Loomrun-Context"


def _signing_key() -> str:
    """Derive a key distinct from the session-token key.

    ``qlix_context_signing_key`` falls back to ``secret_key`` when unset, so we
    derive rather than use it directly — that way a leaked context token can
    never be replayed as a Loomrun login token, and vice versa.
    """
    base = settings.qlix_context_signing_key.encode()
    return hmac.new(base, b"qlix-tool-context-v1", hashlib.sha256).hexdigest()


class ContextError(Exception):
    """The context header was missing, malformed, expired or wrongly signed."""


def mint_context(
    *,
    organization_id: str,
    user_id: str,
    role: str,
    mode: str,
    conversation_id: str | None = None,
    timezone: str | None = None,
) -> str:
    now = datetime.now(utc.utc)
    payload: dict[str, Any] = {
        "typ": TOKEN_TYPE,
        "org": organization_id,
        "sub": user_id,
        "role": role,
        "mode": mode,
        "iat": now,
        "exp": now + timedelta(seconds=max(60, settings.qlix_context_ttl_seconds)),
    }
    if conversation_id:
        payload["conv"] = conversation_id
    tz = (timezone or "").strip()
    if tz:
        payload["tz"] = tz[:64]
    return jwt.encode(payload, _signing_key(), algorithm=ALGORITHM)


def tool_context_headers(**kwargs: Any) -> dict[str, str]:
    """Build the ``toolContext`` map for a run. Qlix only accepts ``X-*`` names."""
    return {CONTEXT_HEADER: mint_context(**kwargs)}


def verify_context(token: str | None) -> dict[str, Any]:
    """Validate an inbound context header and return the acting identity."""
    if not token or not token.strip():
        raise ContextError("Missing Loomrun run context")

    raw = token.strip()
    if raw.lower().startswith("bearer "):
        raw = raw.split(" ", 1)[1].strip()

    try:
        payload = jwt.decode(raw, _signing_key(), algorithms=[ALGORITHM])
    except JWTError as exc:
        # Covers a bad signature and an expired token alike; both mean the same
        # thing to the caller — do not act on this request.
        raise ContextError(f"Invalid or expired run context: {exc}") from exc

    if payload.get("typ") != TOKEN_TYPE:
        raise ContextError("Token is not a Loomrun run context")

    organization_id = str(payload.get("org") or "")
    user_id = str(payload.get("sub") or "")
    if not organization_id or not user_id:
        raise ContextError("Run context is missing an organization or user")

    return {
        "organization_id": organization_id,
        "user_id": user_id,
        "role": str(payload.get("role") or ""),
        "mode": str(payload.get("mode") or "advanced"),
        "conversation_id": payload.get("conv"),
        "timezone": str(payload.get("tz") or ""),
    }
