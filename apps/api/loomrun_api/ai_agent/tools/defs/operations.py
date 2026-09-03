"""Production, expenses, telecalling and dashboard tools."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool
from loomrun_api.services import dashboard as dash_svc
from loomrun_api.services import expenses as exp_svc
from loomrun_api.services import production as prod_svc
from loomrun_api.services import telecaller as call_svc

_STAGE_LIST = ", ".join(prod_svc.STAGES)
_OUTCOMES = ", ".join(call_svc.OUTCOMES)


# ── Production ────────────────────────────────────────────────────────────────

@register_tool(
    name="list_production_orders",
    description=(
        "List production orders — the Production screen's contents. Use for "
        "'what's in production', 'what's stuck', 'orders at stitching'. Optionally "
        f"filter by stage ({_STAGE_LIST}). Each row carries its stage, delay flag, "
        "payments, expenses and P&L."
    ),
    parameters={
        "factory_step": {
            "type": "string",
            "description": f"Optional factory-step filter: {_STAGE_LIST}",
        },
        "limit": {"type": "integer", "description": "Max rows (1-100)", "default": 50},
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_production_orders(
    ctx: ToolContext,
    factory_step: str | None = None,
    stage: str | None = None,
    limit: int = 50,
    **_: Any,
) -> dict:
    return await prod_svc.list_production_orders(
        organization_id=ctx.organization_id,
        stage=factory_step or stage,
        limit=limit,
    )


@register_tool(
    name="get_production_order",
    description=(
        "Get one production order with its stage, payments, expenses and P&L. "
        "`order_id` accepts the order id OR the customer/lead name."
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
        "Create an order for a lead, beginning at FABRIC_CHECK. "
        "`lead_id` accepts a lead id or the customer/company name. "
        "A lead can have multiple orders."
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
        "Advance a manufacturing job on the FACTORY FLOOR — cutting, printing, "
        "stitching, QC, packing, dispatch — or flag a delay, rename it, or set "
        f"its budget. Valid factory steps: {_STAGE_LIST}. This tool has NOTHING "
        "to do with the sales pipeline: NEW, CONTACTED, QUALIFICATION, QUOTATION, "
        "NEGOTIATION, SAMPLE, WON and LOST are sales stages and belong to "
        "update_lead — never route those here, and never create a production "
        "order in order to change one. `order_id` accepts the order id OR the "
        "customer/lead name."
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
        "Record a customer payment against a production order. Amounts are in the "
        "smallest currency unit (paise), so ₹5,000 is 500000. `order_id` accepts "
        "the order id or the customer/lead name."
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
        "Add a cost against a production order, which feeds its P&L. Amounts are "
        "in paise (₹1 = 100). Category is free text (e.g. Production); subcategory "
        "is the spend type (e.g. marketing, making)."
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
        "List business expenses — the Expenses screen's contents. Optionally "
        "filter by category (free text). Amounts are in paise."
    ),
    parameters={
        "category": {"type": "string", "description": "Optional free-text category filter"},
        "limit": {"type": "integer", "description": "Max rows (1-100)", "default": 50},
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_expenses(
    ctx: ToolContext, category: str | None = None, limit: int = 50, **_: Any
) -> dict:
    return await exp_svc.list_expenses(
        organization_id=ctx.organization_id, category=category, limit=limit
    )


@register_tool(
    name="create_expense",
    description=(
        "Record a business expense. Category is free text (e.g. Production); "
        "subcategory is the spend type (e.g. marketing). Amounts are in "
        "paise (₹1 = 100). Optionally attach it to a lead by id or name."
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
    description="Delete a recorded expense by its id. Get ids from list_expenses.",
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
        "Record that a PHONE CALL happened with a lead, exactly as the Telecaller "
        "screen does. Use this ONLY when someone actually made or took a call. "
        f"Call outcomes: {_OUTCOMES}. Logging CALLBACK_SCHEDULED (Follow Up) is what puts a "
        "lead on the Follow-ups screen. "
        "DO NOT use this tool to change a lead's pipeline stage — call outcomes are "
        "disposition codes for the telecaller log, not pipeline stage names. "
        "To move a lead's stage, call update_lead. "
        "`lead_id` accepts a lead id or the customer name."
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
        "List logged calls, newest first, optionally for one lead (`lead_id` "
        "accepts an id or a name). Use for call history and 'have we called X'."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Optional lead id or name"},
        "limit": {"type": "integer", "description": "Max rows (1-100)", "default": 30},
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_calls(
    ctx: ToolContext, lead_id: str | None = None, limit: int = 30, **_: Any
) -> dict:
    return await call_svc.list_calls(
        organization_id=ctx.organization_id, lead_id=lead_id, limit=limit
    )


# ── Dashboard ─────────────────────────────────────────────────────────────────

@register_tool(
    name="get_ceo_dashboard",
    description=(
        "The CEO dashboard figures: hot leads, deals won, deals lost, win rate, "
        "pending quotations, delayed follow-ups, production bottlenecks, "
        "collections and revenue. Use for "
        "'how are we doing', 'summary', 'today's numbers'. These are the same "
        "numbers the CEO Dashboard screen shows."
    ),
    parameters={
        "day": {"type": "string", "description": "YYYY-MM-DD for one day, or 'all' (default)"},
    },
    kind="read",
    modes=("minimal", "advanced"),
    owner_only=True,
)
async def get_ceo_dashboard(ctx: ToolContext, day: str | None = "all", **_: Any) -> dict:
    return await dash_svc.get_ceo_dashboard(
        organization_id=ctx.organization_id, day=day
    )
