"""Server-side LLM calls via OpenRouter (chat + optional tool calling)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from loomrun_api.config import settings

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


async def chat_messages(
    *,
    messages: list[dict[str, Any]],
    model: str | None = None,
    temperature: float = 0.2,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict | None = None,
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

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.post(
            OPENROUTER_CHAT_URL,
            json=payload,
            headers=_openrouter_headers(),
        )

    if response.status_code >= 400:
        logger.warning("OpenRouter error %s: %s", response.status_code, response.text[:500])
        raise LlmError(
            "LLM provider request failed",
            status_code=response.status_code,
        )

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
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
        raise LlmError("LLM provider returned empty content")

    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    return {
        "content": content_str,
        "tool_calls": tool_calls,
        "raw_message": message,
        "model": data.get("model", chosen_model),
        "usage": usage,
        "finish_reason": choices[0].get("finish_reason"),
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
