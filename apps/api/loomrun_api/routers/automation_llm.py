"""LLM proxy for n8n automation workflows — authenticated with LOOMRUN_AUTOMATION_API_KEY."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from loomrun_api.config import settings
from loomrun_api.deps import require_automation_api_key
from loomrun_api.llm_client import LlmError, chat_completion

router = APIRouter()


class AutomationLlmPayload(BaseModel):
    prompt: str = Field(min_length=1, max_length=100_000)
    model: str | None = None
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    organization_id: str | None = None
    organization_slug: str | None = None


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

    try:
        result = await chat_completion(
            prompt=body.prompt.strip(),
            model=body.model,
            temperature=body.temperature,
        )
    except LlmError as exc:
        code = status.HTTP_502_BAD_GATEWAY
        if exc.status_code == 401:
            code = status.HTTP_503_SERVICE_UNAVAILABLE
        raise HTTPException(code, detail=str(exc)) from exc

    return result
