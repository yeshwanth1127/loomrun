"""Standalone expenses shared by HTTP routers and the AI agent."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from loomrun_api.pnl import serialize_expense
from loomrun_api.prisma_client import prisma
from loomrun_api.services.leads import resolve_lead


def _label(value: str | None, *, field: str, required: bool = True) -> str | None:
    text = " ".join(str(value or "").split())
    if not text:
        if required:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{field} is required")
        return None
    return text


async def list_expenses(
    *, organization_id: str, category: str | None = None, limit: int = 50
) -> dict[str, Any]:
    where: dict[str, Any] = {"organizationId": organization_id}
    if category:
        where["category"] = {"equals": category.strip(), "mode": "insensitive"}
    total = await prisma.expense.count(where=where)
    rows = await prisma.expense.find_many(
        where=where,
        order={"incurredAt": "desc"},
        take=max(1, min(int(limit or 50), 100)),
        include={"createdBy": True},
    )
    total_cents = sum(r.amountCents or 0 for r in rows)
    return {
        "items": [serialize_expense(r) for r in rows],
        "count": len(rows),
        "total": total,
        "listed_total_cents": total_cents,
    }


async def create_expense(
    *,
    organization_id: str,
    user_id: str,
    category: str,
    amount_cents: int,
    subcategory: str | None = None,
    description: str | None = None,
    vendor: str | None = None,
    lead_id: str | None = None,
) -> dict[str, Any]:
    if amount_cents <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="amount_cents must be greater than zero"
        )
    data: dict[str, Any] = {
        "organizationId": organization_id,
        "category": _label(category, field="category"),
        "subcategory": _label(subcategory, field="subcategory", required=False),
        "amountCents": amount_cents,
        "description": description,
        "vendor": vendor,
        "incurredAt": datetime.now(timezone.utc),
        "createdById": user_id,
    }
    if lead_id:
        lead = await resolve_lead(organization_id=organization_id, lead_id=lead_id)
        data["leadId"] = lead.id
    row = await prisma.expense.create(data=data, include={"createdBy": True})
    return serialize_expense(row)


async def delete_expense(*, organization_id: str, expense_id: str) -> dict[str, Any]:
    row = await prisma.expense.find_first(
        where={"id": expense_id, "organizationId": organization_id}
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense not found")
    await prisma.expense.delete(where={"id": expense_id})
    return {"id": expense_id, "deleted": True}
