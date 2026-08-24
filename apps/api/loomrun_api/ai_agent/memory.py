"""Persistent per-organization memory for Loomrun AI.

Learns durable facts (owner, goals, products, preferences, etc.) from chat
and injects them into later turns. Scoped strictly by organization_id.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from loomrun_api.config import settings
from loomrun_api.llm_client import LlmError, chat_messages
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta

logger = logging.getLogger(__name__)

# Canonical keys we encourage the extractor to use (others allowed if snake_case).
KNOWN_FACT_KEYS = (
    "org_owner",
    "org_goal",
    "org_mission",
    "industry",
    "products",
    "target_customers",
    "primary_markets",
    "brand_voice",
    "preferred_language",
    "sales_process_notes",
    "pricing_notes",
    "whatsapp_preferences",
    "key_contacts",
    "constraints",
)

_MAX_FACT_VALUE_LEN = 500
_MAX_FACTS = 40
_MAX_SUMMARY_LEN = 2000
_EXTRACT_MODEL_FALLBACK = "openai/gpt-4o-mini"

_EXTRACT_SYSTEM = """You extract durable organization memory from a Loomrun CRM chat turn.
Return ONLY valid JSON with this shape:
{
  "summary": "optional updated 1-3 sentence org summary, or null to keep existing",
  "facts": { "snake_case_key": "value", ... },
  "forget": ["keys_to_remove_if_user_corrected"]
}

Rules:
- Only store durable org-level facts: owner/founder, goals, industry, products, markets,
  brand voice, language preference, sales process, pricing style, key contacts, constraints.
- Do NOT store one-off lead actions, temporary IDs, passwords, or full chat logs.
- Prefer short values. Use empty facts {} if nothing new.
- If the user corrects a prior fact, put the old key in forget and set the new value in facts.
- Keys must be lowercase snake_case.
"""


def _as_facts_dict(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in raw.items():
        if not isinstance(k, str):
            continue
        key = k.strip().lower().replace(" ", "_")
        if not key or not re.match(r"^[a-z][a-z0-9_]{0,63}$", key):
            continue
        if v is None:
            continue
        val = str(v).strip()
        if not val:
            continue
        out[key] = val[:_MAX_FACT_VALUE_LEN]
        if len(out) >= _MAX_FACTS:
            break
    return out


def format_memory_block(summary: str, facts: dict[str, str]) -> str:
    if not summary and not facts:
        return "(No persistent memory yet — learn durable org facts from conversation.)"
    lines: list[str] = []
    if summary:
        lines.append(summary.strip())
    if facts:
        lines.append("Facts:")
        for key in sorted(facts.keys()):
            lines.append(f"- {key}: {facts[key]}")
    return "\n".join(lines)


async def get_org_memory(organization_id: str) -> dict[str, Any]:
    row = await prisma.aiorgmemory.find_unique(where={"organizationId": organization_id})
    if not row:
        return {
            "summary": "",
            "facts": {},
            "formatted": format_memory_block("", {}),
            "updated_at": None,
        }
    facts = _as_facts_dict(row.facts)
    summary = (row.summary or "").strip()
    return {
        "summary": summary,
        "facts": facts,
        "formatted": format_memory_block(summary, facts),
        "updated_at": row.updatedAt.isoformat() if row.updatedAt else None,
        "last_extracted_at": row.lastExtractedAt.isoformat() if row.lastExtractedAt else None,
    }


async def upsert_org_memory(
    *,
    organization_id: str,
    summary: str | None = None,
    facts_patch: dict[str, str] | None = None,
    forget_keys: list[str] | None = None,
) -> dict[str, Any]:
    existing = await prisma.aiorgmemory.find_unique(where={"organizationId": organization_id})
    current_facts = _as_facts_dict(existing.facts if existing else {})
    current_summary = (existing.summary or "").strip() if existing else ""

    if forget_keys:
        for key in forget_keys:
            current_facts.pop(str(key).strip().lower(), None)

    if facts_patch:
        current_facts.update(_as_facts_dict(facts_patch))
        # Cap size: keep most recently patched keys preferentially by re-adding patch last
        if len(current_facts) > _MAX_FACTS:
            keys = list(current_facts.keys())
            for drop in keys[: len(current_facts) - _MAX_FACTS]:
                if drop not in (facts_patch or {}):
                    current_facts.pop(drop, None)

    if summary is not None and summary.strip():
        current_summary = summary.strip()[:_MAX_SUMMARY_LEN]

    now = datetime.now(timezone.utc)
    data = {
        "summary": current_summary,
        "facts": json_meta(current_facts) if current_facts else json_meta({}),
        "lastExtractedAt": now,
    }

    if existing:
        row = await prisma.aiorgmemory.update(
            where={"organizationId": organization_id},
            data=data,
        )
    else:
        row = await prisma.aiorgmemory.create(
            data={
                "organizationId": organization_id,
                **data,
            }
        )

    facts = _as_facts_dict(row.facts)
    return {
        "summary": row.summary or "",
        "facts": facts,
        "formatted": format_memory_block(row.summary or "", facts),
    }


def _parse_extract_json(content: str) -> dict[str, Any]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return {}
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}


async def extract_memory_from_turn(
    *,
    organization_id: str,
    user_message: str,
    assistant_reply: str,
    model: str | None = None,
) -> dict[str, Any] | None:
    """Run a lightweight LLM pass and merge any new durable facts into org memory."""
    user_message = (user_message or "").strip()
    assistant_reply = (assistant_reply or "").strip()
    if not user_message or len(user_message) < 8:
        return None

    current = await get_org_memory(organization_id)
    extract_model = (
        (model or "").strip()
        or (settings.openrouter_default_model or "").strip()
        or _EXTRACT_MODEL_FALLBACK
    )

    payload = {
        "existing_summary": current["summary"],
        "existing_facts": current["facts"],
        "suggested_keys": list(KNOWN_FACT_KEYS),
        "user_message": user_message[:2000],
        "assistant_reply": assistant_reply[:2000],
    }

    try:
        result = await chat_messages(
            messages=[
                {"role": "system", "content": _EXTRACT_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        "Update org memory from this turn if warranted.\n"
                        + json.dumps(payload, ensure_ascii=False)
                    ),
                },
            ],
            model=extract_model,
            temperature=0.1,
        )
    except LlmError as exc:
        logger.warning("Memory extraction LLM failed for org %s: %s", organization_id, exc)
        return None

    parsed = _parse_extract_json(result.get("content") or "")
    facts_raw = parsed.get("facts") if isinstance(parsed.get("facts"), dict) else {}
    facts_patch = _as_facts_dict(facts_raw)
    forget = parsed.get("forget") if isinstance(parsed.get("forget"), list) else []
    forget_keys = [str(k).strip().lower() for k in forget if str(k).strip()]
    summary = parsed.get("summary")
    if summary is not None and not isinstance(summary, str):
        summary = None
    if summary is not None and not summary.strip():
        summary = None

    if not facts_patch and not forget_keys and summary is None:
        return None

    return await upsert_org_memory(
        organization_id=organization_id,
        summary=summary,
        facts_patch=facts_patch or None,
        forget_keys=forget_keys or None,
    )


def schedule_memory_extraction(
    *,
    organization_id: str,
    user_message: str,
    assistant_reply: str,
    model: str | None = None,
) -> None:
    """Fire-and-forget extraction so chat latency is unaffected."""

    async def _run() -> None:
        try:
            await extract_memory_from_turn(
                organization_id=organization_id,
                user_message=user_message,
                assistant_reply=assistant_reply,
                model=model,
            )
        except Exception:
            logger.exception("Background memory extraction failed for org %s", organization_id)

    try:
        asyncio.create_task(_run())
    except RuntimeError:
        logger.warning("No running event loop for memory extraction")
