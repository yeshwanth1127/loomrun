"""Thin async client for Jev (System One) via OpenRouter.

Default: POST openrouter.ai/api/v1/systemone with OPENROUTER_API_KEY.
Optional JEV_API_KEY / JEV_BASE_URL override for direct TypeSafe.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from loomrun_api.config import settings

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = httpx.Timeout(8.0, connect=3.0)


class JevError(Exception):
    """Jev request failed or returned an unusable payload."""


def _endpoint_url() -> str:
    base = settings.jev_base_url.rstrip("/")
    path = (settings.jev_path or "systemone").strip().strip("/")
    return f"{base}/{path}"


def _headers() -> dict[str, str]:
    token = settings.jev_bearer_token
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    # OpenRouter ranking headers (harmless on TypeSafe if overridden).
    referer = settings.openrouter_http_referer.strip() or settings.public_api_url.strip()
    if referer:
        headers["HTTP-Referer"] = referer
    title = settings.openrouter_app_title.strip()
    if title:
        headers["X-Title"] = title
    return headers


async def decide(
    *,
    state: str | dict[str, Any] | list[Any],
    questions: dict[str, Any],
    model: str | None = None,
) -> dict[str, Any]:
    """POST state + typed questions; return the full JSON body.

    Raises JevError on HTTP/network/shape failures. Callers that want fail-open
    should catch and escalate to the LLM path.
    """
    if not settings.jev_ready:
        raise JevError("Jev is not configured (JEV_ENABLED + OPENROUTER_API_KEY required)")

    body = {
        "model": model or settings.jev_model,
        "state": state,
        "questions": questions,
    }
    url = _endpoint_url()
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, trust_env=False) as client:
            response = await client.post(url, json=body, headers=_headers())
    except httpx.TimeoutException as exc:
        raise JevError(f"Jev timed out calling {url}") from exc
    except httpx.HTTPError as exc:
        raise JevError(f"Jev network error: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text[:300]
        raise JevError(f"Jev HTTP {response.status_code}: {detail}")

    try:
        payload = response.json()
    except ValueError as exc:
        raise JevError("Jev returned non-JSON") from exc

    if not isinstance(payload, dict):
        raise JevError("Jev response is not an object")
    answers = payload.get("answers")
    if not isinstance(answers, dict):
        raise JevError("Jev response missing answers map")
    return payload


def choice_answer(answers: dict[str, Any], name: str) -> tuple[str | None, float]:
    """Return (winning_key, confidence) for a choice question; (None, 0) if missing."""
    raw = answers.get(name)
    if not isinstance(raw, dict):
        return None, 0.0
    choice = raw.get("choice")
    if choice is None:
        return None, 0.0
    conf = raw.get("confidence")
    try:
        confidence = float(conf) if conf is not None else 0.0
    except (TypeError, ValueError):
        confidence = 0.0
    return str(choice), confidence
