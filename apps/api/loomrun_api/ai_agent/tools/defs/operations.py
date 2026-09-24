"""Production, expenses, telecalling and dashboard tools."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool
from loomrun_api.services import dashboard as dash_svc
from loomrun_api.services import expenses as exp_svc
from loomrun_api.services import production as prod_svc
from loomrun_api.services import telecaller as call_svc
from loomrun_api.services.leads import DATE_BOUND_PARAMETERS

_STAGE_LIST = ", ".join(prod_svc.STAGES)
_OUTCOMES = ", ".join(call_svc.OUTCOMES)


# ── Production ────────────────────────────────────────────────────────────────

@register_tool(
    name="list_production_orders",
    description=(
        "WHEN: list factory jobs — 'what's in production', 'stuck', 'at stitching'. "
        "NOT: listing leads or sales stages (search_leads). NEEDS: nothing required; "
        "optional factory_step. RETURNS: short cards (id, order_number, "
        "display_name, stage, delay, lead). Factory step is live: items are "
        "jobs in that step now. Date bounds without a step filter created/"
        "updated jobs; both together add `in_window` counts. Use "
        "get_production_order for payments, expenses and P&L."
    ),
    parameters={
        "factory_step": {
            "type": "string",
            "description": f"Optional factory-step filter: {_STAGE_LIST}",
        },
        "limit": {"type": "integer", "description": "Max rows (1-100)", "default": 50},
        **DATE_BOUND_PARAMETERS,
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_production_orders(
    ctx: ToolContext,
    factory_step: str | None = None,
    stage: str | None = None,
    limit: int = 50,
    created_after: str | None = None,
    created_before: str | None = None,
    updated_after: str | None = None,
    updated_before: str | None = None,
    timezone: str | None = None,
    **_: Any,
) -> dict:
    return await prod_svc.list_production_orders(
        organization_id=ctx.organization_id,
        stage=factory_step or stage,
        limit=limit,
        created_after=created_after,
        created_before=created_before,
        updated_after=updated_after,
        updated_before=updated_before,
        timezone=timezone or ctx.timezone,
    )


@register_tool(
    name="get_production_order",
    description=(
        "WHEN: full details of one production order (stage, payments, expenses, "
        "P&L). NOT: a factory roster (list_production_orders) or a sales-stage "
        "move (update_lead). NEEDS: order_id (order id or customer/lead name). "
        "Never ask the user for an internal id. RETURNS: the full order."
    ),
    parameters={"order_id": {"type": "string", "description": "Order id, or the lead/company name"}},
    kind="read",
    modes=("minimal", "advanced"),
    required=["order_id"],
)
async def get_production_order(ctx: ToolContext, order_id: str, **_: Any) -> dict:
    return await prod_svc.get_production_order(
        organization_id=ctx.organization_id, order_id=order_id
    )


@register_tool(
    name="create_production_order",
    description=(
        "WHEN: start manufacturing for a lead, beginning at FABRIC_CHECK. NOT: "
        "moving a sales stage (update_lead). NEEDS: lead_id (id or customer/"
        "company name). Never ask the user for an internal id."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Lead id, or the lead/company name"},
        "quotation_id": {"type": "string", "description": "Optional quotation to link"},
    },
    kind="write",
    modes=("advanced",),
    required=["lead_id"],
    summary_fn=lambda a: f"Start production for {a.get('lead_id', '?')}",
)
async def create_production_order(
    ctx: ToolContext, lead_id: str, quotation_id: str | None = None, **_: Any
) -> dict:
    return await prod_svc.create_production_order(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        lead_id=lead_id,
        quotation_id=quotation_id,
    )


@register_tool(
    name="update_production_order",
    description=(
        "WHEN: advance a factory job (cutting, printing, stitching, QC, packing, "
        f"dispatch) or set delay/budget/name. Valid factory steps: {_STAGE_LIST}. "
        "NOT: sales pipeline stages NEW…WON/LOST (those are update_lead). NEEDS: "
        "order_id (id or customer/lead name). Never ask the user for an internal id."
    ),
    parameters={
        "order_id": {"type": "string", "description": "Order id, or the lead/company name"},
        "factory_step": {
            "type": "string",
            "description": f"New factory-floor step: {_STAGE_LIST}",
        },
        "delay_flag": {"type": "boolean", "description": "Mark or clear the delay flag"},
        "budget_cents": {"type": "integer", "description": "Budget in paise/cents"},
        "name": {"type": "string", "description": "Order name"},
    },
    kind="write",
    modes=("advanced",),
    required=["order_id"],
    summary_fn=lambda a: (
        f"Update production {a.get('order_id', '?')}"
        + (
            f" · step→{a.get('factory_step') or a.get('stage')}"
            if (a.get("factory_step") or a.get("stage"))
            else ""
        )
    ),
)
async def update_production_order(
    ctx: ToolContext,
    order_id: str,
    factory_step: str | None = None,
    stage: str | None = None,
    delay_flag: bool | None = None,
    budget_cents: int | None = None,
    name: str | None = None,
    **_: Any,
) -> dict:
    # `stage` still accepted so an older call shape keeps working.
    return await prod_svc.update_production_order(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        order_id=order_id,
        stage=factory_step or stage,
        delay_flag=delay_flag,
        budget_cents=budget_cents,
        name=name,
    )


@register_tool(
    name="record_production_payment",
    description=(
        "WHEN: record a customer payment against a production order. Amounts in "
        "paise (₹1 = 100). NEEDS: order_id (id or customer/lead name) and "
        "amount_cents. Never ask the user for an internal id."
    ),
    parameters={
        "order_id": {"type": "string", "description": "Order id, or the lead/company name"},
        "amount_cents": {"type": "integer", "description": "Amount in paise (₹1 = 100)"},
        "payment_status": {"type": "string", "description": "PENDING, PARTIAL or PAID (default PAID)"},
        "note": {"type": "string"},
    },
    kind="write",
    modes=("advanced",),
    required=["order_id", "amount_cents"],
    summary_fn=lambda a: f"Record payment {a.get('amount_cents', 0) / 100:.2f} on {a.get('order_id', '?')}",
)
async def record_production_payment(
    ctx: ToolContext,
    order_id: str,
    amount_cents: int,
    payment_status: str = "PAID",
    note: str | None = None,
    **_: Any,
) -> dict:
    return await prod_svc.record_production_payment(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        order_id=order_id,
        amount_cents=amount_cents,
        payment_status=payment_status,
        note=note,
    )


@register_tool(
    name="record_production_expense",
    description=(
        "WHEN: add a cost against a production order (feeds its P&L). Amounts in "
        "paise. NEEDS: order_id (id or name), category, amount_cents. Never ask "
        "the user for an internal id."
    ),
    parameters={
        "order_id": {"type": "string", "description": "Order id, or the lead/company name"},
        "category": {"type": "string", "description": "Free-text category, e.g. Production"},
        "subcategory": {"type": "string", "description": "Spend type, e.g. marketing or making"},
        "amount_cents": {"type": "integer", "description": "Amount in paise (₹1 = 100)"},
        "description": {"type": "string"},
        "vendor": {"type": "string"},
    },
    kind="write",
    modes=("advanced",),
    required=["order_id", "category", "amount_cents"],
    summary_fn=lambda a: f"Add {a.get('category', '?')} cost {a.get('amount_cents', 0) / 100:.2f} to {a.get('order_id', '?')}",
)
async def record_production_expense(
    ctx: ToolContext,
    order_id: str,
    category: str,
    amount_cents: int,
    subcategory: str | None = None,
    description: str | None = None,
    vendor: str | None = None,
    **_: Any,
) -> dict:
    return await prod_svc.record_production_expense(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        order_id=order_id,
        category=category,
        subcategory=subcategory,
        amount_cents=amount_cents,
        description=description,
        vendor=vendor,
    )


# ── Expenses ──────────────────────────────────────────────────────────────────

@register_tool(
    name="list_expenses",
    description=(
        "WHEN: list business expenses, optionally by category or date window. "
        "created_after/before filter incurred_at (when the spend happened). "
        "NOT: production-order costs only (those also appear on "
        "get_production_order). RETURNS: short cards (id, category, amount, "
        "vendor, dates)."
    ),
    parameters={
        "category": {"type": "string", "description": "Optional free-text category filter"},
        "limit": {"type": "integer", "description": "Max rows (1-100)", "default": 50},
        **DATE_BOUND_PARAMETERS,
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_expenses(
    ctx: ToolContext,
    category: str | None = None,
    limit: int = 50,
    created_after: str | None = None,
    created_before: str | None = None,
    updated_after: str | None = None,
    updated_before: str | None = None,
    timezone: str | None = None,
    **_: Any,
) -> dict:
    return await exp_svc.list_expenses(
        organization_id=ctx.organization_id,
        category=category,
        limit=limit,
        created_after=created_after,
        created_before=created_before,
        updated_after=updated_after,
        updated_before=updated_before,
        timezone=timezone or ctx.timezone,
    )


@register_tool(
    name="create_expense",
    description=(
        "WHEN: record a business expense. Amounts in paise (₹1 = 100). Optional "
        "lead_id is an id or name. NOT: a production-order cost "
        "(record_production_expense). Never ask the user for an internal id."
    ),
    parameters={
        "category": {"type": "string", "description": "Free-text category, e.g. Production"},
        "subcategory": {"type": "string", "description": "Spend type, e.g. marketing or making"},
        "amount_cents": {"type": "integer", "description": "Amount in paise (₹1 = 100)"},
        "description": {"type": "string"},
        "vendor": {"type": "string"},
        "lead_id": {"type": "string", "description": "Optional lead id or name to attach"},
    },
    kind="write",
    modes=("advanced",),
    required=["category", "amount_cents"],
    summary_fn=lambda a: f"Record {a.get('category', '?')} expense {a.get('amount_cents', 0) / 100:.2f}",
)
async def create_expense(
    ctx: ToolContext,
    category: str,
    amount_cents: int,
    subcategory: str | None = None,
    description: str | None = None,
    vendor: str | None = None,
    lead_id: str | None = None,
    **_: Any,
) -> dict:
    return await exp_svc.create_expense(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        category=category,
        subcategory=subcategory,
        amount_cents=amount_cents,
        description=description,
        vendor=vendor,
        lead_id=lead_id,
    )


@register_tool(
    name="delete_expense",
    description=(
        "WHEN: delete a recorded expense. NEEDS: expense_id from list_expenses. "
        "Never ask the user for an internal id."
    ),
    parameters={"expense_id": {"type": "string"}},
    kind="write",
    modes=("advanced",),
    required=["expense_id"],
    summary_fn=lambda a: f"Delete expense {a.get('expense_id', '?')}",
)
async def delete_expense(ctx: ToolContext, expense_id: str, **_: Any) -> dict:
    return await exp_svc.delete_expense(
        organization_id=ctx.organization_id, expense_id=expense_id
    )


# ── Telecalling ───────────────────────────────────────────────────────────────

@register_tool(
    name="log_call",
    description=(
        "WHEN: record that a PHONE CALL happened with a lead. NOT: changing a "
        "pipeline stage (update_lead) — outcomes are telecaller dispositions, "
        f"not sales stages. Outcomes: {_OUTCOMES}. CALLBACK_SCHEDULED puts the "
        "lead on Follow-ups. NEEDS: lead_id (id or name) and outcome. Never ask "
        "the user for an internal id."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Lead id, or the lead/company name"},
        "outcome": {"type": "string", "description": f"One of: {_OUTCOMES}"},
        "notes": {"type": "string"},
        "duration_seconds": {"type": "integer"},
        "next_call_at": {"type": "string", "description": "ISO-8601 time for the next call"},
    },
    kind="write",
    modes=("advanced",),
    required=["lead_id", "outcome"],
    summary_fn=lambda a: f"Log call on {a.get('lead_id', '?')} · {a.get('outcome', '?')}",
)
async def log_call(
    ctx: ToolContext,
    lead_id: str,
    outcome: str,
    notes: str | None = None,
    duration_seconds: int | None = None,
    next_call_at: str | None = None,
    **_: Any,
) -> dict:
    when = None
    if next_call_at:
        when = datetime.fromisoformat(next_call_at.replace("Z", "+00:00"))
    return await call_svc.log_call(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        lead_id=lead_id,
        outcome=outcome,
        notes=notes,
        duration_seconds=duration_seconds,
        next_call_at=when,
    )


@register_tool(
    name="list_calls",
    description=(
        "WHEN: call history, 'have we called X', calls in a date window. NOT: "
        "the Follow-ups screen (list_follow_ups) or a lead roster. NEEDS: "
        "nothing required; optional lead_id (id or name) and date bounds. "
        "RETURNS: short cards without call notes. Never ask the user for an "
        "internal id."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Optional lead id or name"},
        "limit": {"type": "integer", "description": "Max rows (1-100)", "default": 30},
        **DATE_BOUND_PARAMETERS,
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_calls(
    ctx: ToolContext,
    lead_id: str | None = None,
    limit: int = 30,
    created_after: str | None = None,
    created_before: str | None = None,
    updated_after: str | None = None,
    updated_before: str | None = None,
    timezone: str | None = None,
    **_: Any,
) -> dict:
    return await call_svc.list_calls(
        organization_id=ctx.organization_id,
        lead_id=lead_id,
        limit=limit,
        created_after=created_after,
        created_before=created_before,
        updated_after=updated_after,
        updated_before=updated_before,
        timezone=timezone or ctx.timezone,
    )


# ── Dashboard ─────────────────────────────────────────────────────────────────

@register_tool(
    name="get_ceo_dashboard",
    description=(
        "WHEN: current organisation KPIs — live pipeline size, deals won/lost, "
        "win rate, overdue follow-ups, production, collections. NOT: a lead "
        "roster (search_leads) or how many were created on a date "
        "(count_leads). RETURNS the live pipeline. Headline counts are never "
        "records created today. An optional day only adds "
        "leads_created_on_requested_day; it does not change total_leads."
    ),
    parameters={
        "day": {
            "type": "string",
            "description": (
                "Optional YYYY-MM-DD. Does not filter headline KPIs. When set, "
                "the result also includes leads_created_on_requested_day."
            ),
        },
    },
    kind="read",
    modes=("minimal", "advanced"),
    owner_only=True,
)
async def get_ceo_dashboard(ctx: ToolContext, day: str | None = "all", **_: Any) -> dict:
    # Headline KPIs are the live pipeline. A calendar day used to mean
    # "created that UTC day", so "what needs attention today" came back as
    # total_leads=0 whenever nothing was created that day.
    live = await dash_svc.get_ceo_dashboard(
        organization_id=ctx.organization_id, day="all"
    )
    requested = (day or "all").strip()
    if not requested or requested.lower() == "all":
        live["count_scope"] = "live_pipeline"
        return live

    from loomrun_api.date_filter import parse_day_param
    from loomrun_api.prisma_client import prisma

    created: int | None = None
    try:
        rng = parse_day_param(requested)
    except Exception:
        rng = None
    if rng:
        created = await prisma.lead.count(
            where={
                "organizationId": ctx.organization_id,
                "createdAt": {"gte": rng[0], "lt": rng[1]},
            }
        )
    return {
        "count_scope": "live_pipeline",
        "note": (
            f"total_leads and the other headline counts are the current pipeline, "
            f"not records created on {requested}. leads_created_on_requested_day "
            f"is that slice. Do not report the live total as if it were created that day."
        ),
        "requested_day": requested,
        "leads_created_on_requested_day": created,
        **live,
    }
