"""Persisted Loomrun AI conversations (org-scoped, date-queryable)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from loomrun_api.date_filter import apply_created_at
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta


def _serialize_message(m) -> dict[str, Any]:
    meta = m.metadata if isinstance(getattr(m, "metadata", None), dict) else None
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "model": m.model,
        "metadata": meta,
        "created_at": m.createdAt.isoformat() if m.createdAt else None,
    }


def _serialize_conversation(c, *, include_messages: bool = False) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": c.id,
        "organization_id": c.organizationId,
        "user_id": c.userId,
        "title": c.title,
        "created_at": c.createdAt.isoformat() if c.createdAt else None,
        "updated_at": c.updatedAt.isoformat() if c.updatedAt else None,
    }
    if include_messages:
        msgs = getattr(c, "messages", None) or []
        data["messages"] = [_serialize_message(m) for m in msgs]
        data["message_count"] = len(data["messages"])
    return data


def _title_from_message(text: str) -> str:
    cleaned = " ".join((text or "").strip().split())
    if not cleaned:
        return "New chat"
    return (cleaned[:72] + "…") if len(cleaned) > 72 else cleaned


async def create_conversation(
    *,
    organization_id: str,
    user_id: str,
    title: str | None = None,
) -> dict[str, Any]:
    row = await prisma.aiconversation.create(
        data={
            "organizationId": organization_id,
            "userId": user_id,
            "title": (title or "New chat").strip()[:120] or "New chat",
        }
    )
    return _serialize_conversation(row, include_messages=True) | {"messages": []}


async def list_conversations(
    *,
    organization_id: str,
    day: str | None = None,
    limit: int = 50,
    search: str | None = None,
) -> dict[str, Any]:
    where: dict = {"organizationId": organization_id}
    # Filter by conversation updated day (activity), with created_at fallback via apply_created_at on updatedAt
    if day and day != "all":
        # apply_created_at mutates where with createdAt — use updatedAt for "activity on day"
        try:
            from datetime import date as date_cls, timedelta

            d = date_cls.fromisoformat(day)
            start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
            end = start + timedelta(days=1)
            where["updatedAt"] = {"gte": start, "lt": end}
        except ValueError:
            apply_created_at(where, day)

    take = max(1, min(int(limit or 50), 100))
    rows = await prisma.aiconversation.find_many(
        where=where,
        order={"updatedAt": "desc"},
        take=take,
    )

    items = [_serialize_conversation(c) for c in rows]
    if search:
        q = search.strip().lower()
        if q:
            # Prefer title match first; optionally scan recent message content
            title_hits = [i for i in items if q in (i.get("title") or "").lower()]
            if title_hits:
                items = title_hits
            else:
                msg_hits = await prisma.aimessage.find_many(
                    where={
                        "conversation": {"organizationId": organization_id},
                        "content": {"contains": search, "mode": "insensitive"},
                    },
                    order={"createdAt": "desc"},
                    take=40,
                )
                conv_ids = []
                seen = set()
                for m in msg_hits:
                    if m.conversationId not in seen:
                        seen.add(m.conversationId)
                        conv_ids.append(m.conversationId)
                if conv_ids:
                    found = await prisma.aiconversation.find_many(
                        where={"organizationId": organization_id, "id": {"in": conv_ids}},
                        order={"updatedAt": "desc"},
                    )
                    items = [_serialize_conversation(c) for c in found]

    return {"items": items, "count": len(items), "day": day or "all"}


async def get_conversation(
    *,
    organization_id: str,
    conversation_id: str,
) -> dict[str, Any]:
    row = await prisma.aiconversation.find_first(
        where={"id": conversation_id, "organizationId": organization_id},
        include={"messages": {"order_by": {"createdAt": "asc"}}},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return _serialize_conversation(row, include_messages=True)


async def ensure_conversation(
    *,
    organization_id: str,
    user_id: str,
    conversation_id: str | None,
) -> str:
    if conversation_id:
        row = await prisma.aiconversation.find_first(
            where={"id": conversation_id, "organizationId": organization_id},
        )
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        return row.id
    created = await create_conversation(organization_id=organization_id, user_id=user_id)
    return created["id"]


async def append_message(
    *,
    conversation_id: str,
    role: str,
    content: str,
    model: str | None = None,
    metadata: dict | None = None,
    set_title_from_user: bool = False,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "conversationId": conversation_id,
        "role": role,
        "content": content,
        "model": model,
    }
    if metadata is not None:
        data["metadata"] = json_meta(metadata)

    msg = await prisma.aimessage.create(data=data)

    update: dict[str, Any] = {"updatedAt": datetime.now(timezone.utc)}
    if set_title_from_user and role == "user":
        conv = await prisma.aiconversation.find_unique(where={"id": conversation_id})
        if conv and (not conv.title or conv.title == "New chat"):
            update["title"] = _title_from_message(content)

    await prisma.aiconversation.update(where={"id": conversation_id}, data=update)
    return _serialize_message(msg)


async def search_messages(
    *,
    organization_id: str,
    query: str | None = None,
    day: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    where: dict[str, Any] = {"conversation": {"organizationId": organization_id}}
    if query and query.strip():
        where["content"] = {"contains": query.strip(), "mode": "insensitive"}
    if day and day != "all":
        try:
            from datetime import date as date_cls, timedelta

            d = date_cls.fromisoformat(day)
            start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
            end = start + timedelta(days=1)
            where["createdAt"] = {"gte": start, "lt": end}
        except ValueError:
            pass

    take = max(1, min(int(limit or 20), 50))
    rows = await prisma.aimessage.find_many(
        where=where,
        order={"createdAt": "desc"},
        take=take,
        include={"conversation": True},
    )
    items = []
    for m in rows:
        items.append(
            {
                **_serialize_message(m),
                "conversation_id": m.conversationId,
                "conversation_title": m.conversation.title if m.conversation else None,
            }
        )
    return {"items": items, "count": len(items)}


async def delete_conversation(*, organization_id: str, conversation_id: str) -> None:
    row = await prisma.aiconversation.find_first(
        where={"id": conversation_id, "organizationId": organization_id},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    await prisma.aiconversation.delete(where={"id": conversation_id})
