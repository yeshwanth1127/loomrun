"""LLM proxy for n8n automation workflows — authenticated with LOOMRUN_AUTOMATION_API_KEY."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from loomrun_api.ai_usage import debit_ai_usage, parse_usage_dict, require_ai_capacity
from loomrun_api.config import settings
from loomrun_api.deps import require_automation_api_key
from loomrun_api.entitlements import get_org_entitlements, is_access_locked
from loomrun_api.llm_client import LlmError, chat_completion
from loomrun_api.logging_setup import kv, sanitize_log_text
from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)

router = APIRouter()


class AutomationLlmPayload(BaseModel):
    prompt: str = Field(min_length=1, max_length=100_000)
    model: str | None = None
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    organization_id: str | None = None
    organization_slug: str | None = None


async def _resolve_org(body: AutomationLlmPayload):
    if body.organization_id:
        return await prisma.organization.find_unique(where={"id": body.organization_id})
    slug = (body.organization_slug or "").strip()
    if slug:
        return await prisma.organization.find_unique(where={"slug": slug})
    return None


@router.post("/automation/llm/chat")
async def automation_llm_chat(
    body: AutomationLlmPayload,
    _: None = Depends(require_automation_api_key),
) -> dict:
    """Run a chat completion using Loomrun's server-side OpenRouter key."""
    if not settings.llm_ready:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM is not configured. Set OPENROUTER_API_KEY on the Loomrun server.",
        )

    org = await _resolve_org(body)
    ents = None
    if org:
        if is_access_locked(org):
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED,
                detail="Organization trial has expired. Upgrade to continue automation LLM.",
            )
        ents = get_org_entitlements(org)
        if ents.ai_chat is False:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="AI is not available on this organization's plan.",
            )
        await require_ai_capacity(
            org.id,
            ents=ents,
            org_created_at=org.createdAt,
        )
    elif not body.organization_id and not body.organization_slug:
        # Legacy callers without org context still work but are not preferred.
        pass
    else:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Organization not found for automation LLM metering.",
        )

    logger.info(
        "automation llm chat %s",
        kv(
            org=getattr(org, "id", None),
            model=body.model,
            prompt_len=len(body.prompt),
            prompt=(
                sanitize_log_text(body.prompt, limit=1500)
                if settings.log_ai_messages
                else None
            ),
        ),
    )

    try:
        result = await chat_completion(
            prompt=body.prompt.strip(),
            model=body.model,
            temperature=body.temperature,
        )
    except LlmError as exc:
        logger.warning(
            "automation llm failed %s",
            kv(org=getattr(org, "id", None), error=str(exc), status=exc.status_code),
        )
        code = status.HTTP_502_BAD_GATEWAY
        if exc.status_code == 401:
            code = status.HTTP_503_SERVICE_UNAVAILABLE
        raise HTTPException(code, detail=str(exc)) from exc

    if org and ents is not None:
        prompt_tokens, completion_tokens = parse_usage_dict(result.get("usage"))
        usage = await debit_ai_usage(
            org.id,
            ents=ents,
            source="automation",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            model=result.get("model") or body.model,
            org_created_at=org.createdAt,
        )
        return {**result, "usage_windows": usage}

    return result
