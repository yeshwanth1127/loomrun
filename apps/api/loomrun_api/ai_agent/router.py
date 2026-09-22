"""HTTP endpoints for the Loomrun AI agent."""

from __future__ import annotations

import json
import logging

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from loomrun_api.ai_agent import conversations as conv_svc
from loomrun_api.ai_agent.memory import get_org_memory
from loomrun_api.ai_agent.service import (
    cancel_action,
    confirm_action,
    get_ai_status,
    run_chat,
    stream_chat,
)
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.logging_setup import kv, sanitize_log_text
from loomrun_api.config import settings
from loomrun_api.qlix import chat as qlix_chat
from loomrun_api.qlix import grants
from loomrun_api.qlix.client import QlixError

logger = logging.getLogger(__name__)

router = APIRouter()


def _role_name(ctx: OrgContext) -> str:
    role = ctx.membership.role
    return role.name if hasattr(role, "name") else str(role)


class ChatHistoryItem(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatHistoryItem] = Field(default_factory=list)
    model: str | None = Field(default=None, max_length=120)
    conversation_id: str | None = Field(default=None, max_length=64)
    timezone: str | None = Field(default=None, max_length=64)


class CreateConversationBody(BaseModel):
    title: str | None = Field(default=None, max_length=120)


class StopRunBody(BaseModel):
    run_id: str = Field(min_length=1, max_length=200)


@router.get("/orgs/{org_id}/ai/status")
async def ai_status(ctx: OrgContext = Depends(get_org_context)) -> dict:
    return await get_ai_status(ctx.organization_id)


@router.get("/orgs/{org_id}/ai/memory")
async def ai_memory(ctx: OrgContext = Depends(get_org_context)) -> dict:
    return await get_org_memory(ctx.organization_id)


@router.get("/orgs/{org_id}/ai/conversations")
async def list_ai_conversations(
    day: str | None = Query("all", description="YYYY-MM-DD or all"),
    search: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await conv_svc.list_conversations(
        organization_id=ctx.organization_id,
        day=day,
        search=search,
        limit=limit,
    )


@router.post("/orgs/{org_id}/ai/conversations", status_code=status.HTTP_201_CREATED)
async def create_ai_conversation(
    body: CreateConversationBody | None = None,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await conv_svc.create_conversation(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        title=body.title if body else None,
    )


@router.get("/orgs/{org_id}/ai/conversations/{conversation_id}")
async def get_ai_conversation(
    conversation_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await conv_svc.get_conversation(
        organization_id=ctx.organization_id,
        conversation_id=conversation_id,
    )


@router.delete("/orgs/{org_id}/ai/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_conversation(
    conversation_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> None:
    await conv_svc.delete_conversation(
        organization_id=ctx.organization_id,
        conversation_id=conversation_id,
    )


@router.post("/orgs/{org_id}/ai/chat")
async def ai_chat(
    body: ChatBody,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    history = [{"role": h.role, "content": h.content} for h in body.history]
    logger.info(
        "ai chat http %s",
        kv(
            org=ctx.organization_id,
            user=ctx.membership.userId,
            stream=False,
            model=body.model,
            message=(
                sanitize_log_text(body.message, limit=2000)
                if settings.log_ai_messages
                else f"len={len(body.message)}"
            ),
        ),
    )
    return await run_chat(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        role=_role_name(ctx),
        message=body.message,
        history=history,
        model=body.model,
        conversation_id=body.conversation_id,
        timezone=body.timezone,
    )


@router.post("/orgs/{org_id}/ai/chat/stream")
async def ai_chat_stream(
    body: ChatBody,
    ctx: OrgContext = Depends(get_org_context),
) -> StreamingResponse:
    """Same turn as /ai/chat, streamed so the reply appears as it is written."""
    history = [{"role": h.role, "content": h.content} for h in body.history]
    logger.info(
        "ai chat http %s",
        kv(
            org=ctx.organization_id,
            user=ctx.membership.userId,
            stream=True,
            model=body.model,
            conversation=body.conversation_id,
            message=(
                sanitize_log_text(body.message, limit=2000)
                if settings.log_ai_messages
                else f"len={len(body.message)}"
            ),
        ),
    )

    async def _events():
        try:
            async for event in stream_chat(
                organization_id=ctx.organization_id,
                user_id=ctx.membership.userId,
                role=_role_name(ctx),
                message=body.message,
                history=history,
                model=body.model,
                conversation_id=body.conversation_id,
                timezone=body.timezone,
            ):
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except HTTPException as exc:
            # The stream has already begun, so an error has to travel as an
            # event rather than a status code the client will never see.
            logger.warning(
                "ai chat stream http error %s",
                kv(org=ctx.organization_id, detail=exc.detail),
            )
            yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
        except Exception:
            logger.exception("AI chat stream failed for org %s", ctx.organization_id)
            yield f"data: {json.dumps({'type': 'error', 'detail': 'The assistant stopped unexpectedly.'})}\n\n"

    return StreamingResponse(
        _events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Stop nginx buffering the stream into one lump at the end.
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/orgs/{org_id}/ai/runs/stop")
async def ai_stop_run(
    body: StopRunBody,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    try:
        return await qlix_chat.stop(
            organization_id=ctx.organization_id, run_id=body.run_id
        )
    except QlixError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/orgs/{org_id}/ai/grants")
async def ai_list_grants(ctx: OrgContext = Depends(get_org_context)) -> dict:
    """Standing approvals — what the agent can currently do without asking."""
    items = await grants.list_active(ctx.organization_id)
    return {"items": items, "count": len(items), "ttl_hours": grants.GRANT_TTL_HOURS}


@router.delete("/orgs/{org_id}/ai/grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def ai_revoke_grant(
    grant_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> None:
    removed = await grants.revoke(
        organization_id=ctx.organization_id, grant_id=grant_id
    )
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Approval not found")


@router.delete("/orgs/{org_id}/ai/grants", status_code=status.HTTP_200_OK)
async def ai_revoke_all_grants(ctx: OrgContext = Depends(get_org_context)) -> dict:
    """Take back every standing approval at once."""
    removed = await grants.revoke_all(ctx.organization_id)
    return {"revoked": removed}


@router.post("/orgs/{org_id}/ai/actions/{action_id}/confirm")
async def ai_confirm_action(
    action_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await confirm_action(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        role=_role_name(ctx),
        action_id=action_id,
    )


@router.post("/orgs/{org_id}/ai/actions/{action_id}/cancel")
async def ai_cancel_action(
    action_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await cancel_action(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        action_id=action_id,
    )
