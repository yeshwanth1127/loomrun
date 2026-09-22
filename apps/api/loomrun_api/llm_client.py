"""Server-side LLM calls via OpenRouter (chat + optional tool calling)."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from loomrun_api.config import settings
from loomrun_api.logging_setup import kv, sanitize_log_text

logger = logging.getLogger(__name__)

OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
REQUEST_TIMEOUT = 90.0


class LlmError(Exception):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def _openrouter_headers() -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key.strip()}",
        "Content-Type": "application/json",
    }
    referer = settings.openrouter_http_referer.strip() or settings.public_api_url.strip()
    if referer:
        headers["HTTP-Referer"] = referer
    title = settings.openrouter_app_title.strip()
    if title:
        headers["X-Title"] = title
    return headers


def _message_preview(messages: list[dict[str, Any]]) -> str:
    """Compact role/content summary of the outbound OpenRouter messages."""
    if not settings.log_ai_messages:
        return f"messages={len(messages)}"
    parts: list[str] = []
    for msg in messages:
        role = msg.get("role") or "?"
        content = msg.get("content")
        if content is None and msg.get("tool_calls"):
            names = []
            for call in msg.get("tool_calls") or []:
                fn = (call.get("function") or {}).get("name")
                if fn:
                    names.append(fn)
            parts.append(f"{role}:[tool_calls:{','.join(names) or 'n'}]")
            continue
        text = content if isinstance(content, str) else str(content or "")
        parts.append(f"{role}:{sanitize_log_text(text, limit=1500)}")
    return " | ".join(parts)


async def chat_messages(
    *,
    messages: list[dict[str, Any]],
    model: str | None = None,
    temperature: float = 0.2,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict | None = None,
    session_id: str | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Multi-turn chat completion via OpenRouter.

    When ``tools`` is provided, may return ``tool_calls`` instead of (or with) content.
    """
    api_key = settings.openrouter_api_key.strip()
    if not api_key:
        raise LlmError("OPENROUTER_API_KEY is not configured on the Loomrun server")
    if not messages:
        raise LlmError("messages must not be empty")

    chosen_model = (model or settings.openrouter_default_model).strip()
    payload: dict[str, Any] = {
        "model": chosen_model,
        "temperature": temperature,
        "messages": messages,
    }
    if tools:
        payload["tools"] = tools
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice
    if max_tokens:
        payload["max_tokens"] = int(max_tokens)
    # Ask for the cached-token breakdown so billing can discount reused prefixes,
    # and pin the provider: OpenRouter only reuses a cached prefix when the
    # request lands on the same provider it was written on.
    payload["usage"] = {"include": True}
    payload["provider"] = {"only": ["openai"], "allow_fallbacks": False}
    if session_id:
        payload["session_id"] = str(session_id)[:256]

    tool_names = [
        (t.get("function") or {}).get("name")
        for t in (tools or [])
        if isinstance(t, dict)
    ]
    tool_names = [n for n in tool_names if n]

    logger.info(
        "openrouter request %s",
        kv(
            model=chosen_model,
            message_count=len(messages),
            tool_count=len(tool_names),
            tools=",".join(tool_names) if tool_names else None,
            preview=_message_preview(messages),
        ),
    )

    started = time.perf_counter()
    # Ignore HTTP(S)_PROXY from the process env — a leaked agent/sandbox proxy
    # has taken Loomrun AI offline before by blocking OpenRouter.
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, trust_env=False) as client:
            response = await client.post(
                OPENROUTER_CHAT_URL,
                json=payload,
                headers=_openrouter_headers(),
            )
    except httpx.HTTPError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        logger.error(
            "openrouter network error %s",
            kv(model=chosen_model, latency_ms=latency_ms, error=type(exc).__name__, detail=str(exc)[:300]),
        )
        raise LlmError(f"LLM provider unreachable: {type(exc).__name__}") from exc

    latency_ms = int((time.perf_counter() - started) * 1000)

    if response.status_code >= 400:
        logger.warning(
            "openrouter error %s",
            kv(
                status=response.status_code,
                model=chosen_model,
                latency_ms=latency_ms,
                body=sanitize_log_text(response.text, limit=500),
            ),
        )
        raise LlmError(
            "LLM provider request failed",
            status_code=response.status_code,
        )

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        logger.warning(
            "openrouter empty choices %s",
            kv(model=chosen_model, latency_ms=latency_ms),
        )
        raise LlmError("LLM provider returned no choices")

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        content_str = content
    elif content is None:
        content_str = ""
    else:
        content_str = str(content)

    tool_calls = message.get("tool_calls") or []
    if not isinstance(tool_calls, list):
        tool_calls = []

    if not content_str.strip() and not tool_calls:
        logger.warning(
            "openrouter empty content %s",
            kv(model=chosen_model, latency_ms=latency_ms),
        )
        raise LlmError("LLM provider returned empty content")

    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    called_tools = [
        ((c.get("function") or {}).get("name") or "?")
        for c in tool_calls
        if isinstance(c, dict)
    ]
    resolved_model = data.get("model", chosen_model)
    finish_reason = choices[0].get("finish_reason")

    reply_preview = None
    if settings.log_ai_messages:
        if content_str.strip():
            reply_preview = sanitize_log_text(content_str, limit=1500)
        elif called_tools:
            reply_preview = f"tool_calls:{','.join(called_tools)}"

    logger.info(
        "openrouter response %s",
        kv(
            model=resolved_model,
            latency_ms=latency_ms,
            finish_reason=finish_reason,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            total_tokens=usage.get("total_tokens"),
            tool_calls=",".join(called_tools) if called_tools else None,
            reply=reply_preview,
        ),
    )

    return {
        "content": content_str,
        "tool_calls": tool_calls,
        "raw_message": message,
        "model": resolved_model,
        "usage": usage,
        "finish_reason": finish_reason,
    }


async def chat_completion(
    *,
    prompt: str,
    model: str | None = None,
    temperature: float = 0.2,
) -> dict[str, Any]:
    return await chat_messages(
        messages=[{"role": "user", "content": prompt}],
        model=model,
        temperature=temperature,
    )
