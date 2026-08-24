"""Allowlisted OpenRouter models for Loomrun AI chat."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status

from loomrun_api.config import settings

# Curated catalog — id must match OpenRouter model slugs.
# Labels are what the UI shows.
_DEFAULT_CATALOG: list[dict[str, str]] = [
    {"id": "openai/gpt-4o-mini", "label": "GPT-4o Mini", "provider": "OpenAI"},
    {"id": "openai/gpt-4o", "label": "GPT-4o", "provider": "OpenAI"},
    {"id": "openai/gpt-4.1-mini", "label": "GPT-4.1 Mini", "provider": "OpenAI"},
    {"id": "openai/gpt-4.1", "label": "GPT-4.1", "provider": "OpenAI"},
    {"id": "anthropic/claude-sonnet-4", "label": "Claude Sonnet 4", "provider": "Anthropic"},
    {"id": "anthropic/claude-3.5-sonnet", "label": "Claude 3.5 Sonnet", "provider": "Anthropic"},
    {"id": "google/gemini-2.5-flash", "label": "Gemini 2.5 Flash", "provider": "Google"},
    {"id": "google/gemini-2.5-pro", "label": "Gemini 2.5 Pro", "provider": "Google"},
    {"id": "deepseek/deepseek-chat-v3-0324", "label": "DeepSeek V3", "provider": "DeepSeek"},
]


def _catalog_from_env() -> list[dict[str, str]] | None:
    raw = (getattr(settings, "openrouter_chat_models", None) or "").strip()
    if not raw:
        return None
    items: list[dict[str, str]] = []
    for part in raw.split(","):
        model_id = part.strip()
        if not model_id:
            continue
        # Optional "id|Label" form
        if "|" in model_id:
            mid, label = model_id.split("|", 1)
            items.append({"id": mid.strip(), "label": label.strip() or mid.strip(), "provider": ""})
        else:
            short = model_id.split("/")[-1]
            items.append({"id": model_id, "label": short, "provider": model_id.split("/")[0]})
    return items or None


def list_chat_models() -> list[dict[str, str]]:
    env_list = _catalog_from_env()
    catalog = list(env_list) if env_list else list(_DEFAULT_CATALOG)
    default = (settings.openrouter_default_model or "").strip()
    if default and not any(m["id"] == default for m in catalog):
        catalog.insert(
            0,
            {
                "id": default,
                "label": default.split("/")[-1],
                "provider": default.split("/")[0] if "/" in default else "",
            },
        )
    return catalog


def default_chat_model() -> str:
    default = (settings.openrouter_default_model or "").strip()
    allowed = {m["id"] for m in list_chat_models()}
    if default and default in allowed:
        return default
    models = list_chat_models()
    return models[0]["id"] if models else "openai/gpt-4o-mini"


def resolve_chat_model(requested: str | None) -> str:
    """Return an allowlisted model id. Raises 400 if request is outside the list."""
    allowed = {m["id"] for m in list_chat_models()}
    chosen = (requested or "").strip() or default_chat_model()
    if chosen not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Model not allowed: {chosen}. Choose one of the available chat models.",
        )
    return chosen


def models_payload() -> dict[str, Any]:
    models = list_chat_models()
    default = default_chat_model()
    return {
        "default": default,
        "items": models,
    }
