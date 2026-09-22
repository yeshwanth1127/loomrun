"""Lead read/write tools."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool
from loomrun_api.services import leads as lead_svc
from loomrun_api.services import telecaller as call_svc

_STAGES = "NEW, CONTACTED, QUALIFICATION, QUOTATION, NEGOTIATION, SAMPLE, WON, LOST"


def _update_summary(args: dict[str, Any]) -> str:
    parts = [f"Update lead {args.get('lead_id', '?')}"]
    if args.get("stage"):
        parts.append(f"stage→{args['stage']}")
    if args.get("assignee_id"):
        parts.append("reassign")
    if args.get("next_follow_up_at"):
        parts.append(f"follow-up {args['next_follow_up_at']}")
    if args.get("title"):
        parts.append(f"title={args['title']}")
    return " · ".join(parts)


def _create_summary(args: dict[str, Any]) -> str:
    return f"Create lead “{args.get('title', '?')}”" + (
        f" ({args['company']})" if args.get("company") else ""
    )


@register_tool(
    name="search_leads",
    description=(
        "WHEN: find a set of leads — lists, 'who/which', 'latest', stage "
        "filters (including WON/LOST). NOT: a count-only question (use "
        "count_leads), one already-identified lead's full record (use get_lead), "
        "or quotations for a lead (use list_quotations_for_lead after you have "
        "a lead id). NEEDS: nothing required; pass stage, search text, sort. "
        "Never ask the user for an internal id. RETURNS: short cards "
        "(id, title, company, phone, city, stage, status, product_interest, "
        "created_at, updated_at) plus `total`. Call get_lead for notes/activities. "
        "Stage/assignee are the live board: `total`/`items` are who is in that "
        "state now. Date bounds without a stage filter created/updated records. "
        "Both together keep the live roster and add `in_window.created` / "
        "`in_window.updated`. Report both; never treat a window count as how "
        "many ARE in the stage."
    ),
    parameters={
        "search": {"type": "string", "description": "Name, phone, company, or email substring"},
        "stage": {"type": "string", "description": f"Pipeline stage: {_STAGES}"},
        "assignee_id": {"type": "string", "description": "Filter by assignee user id"},
        "limit": {"type": "integer", "description": "Max results (1-50)", "default": 20},
        "sort": {
            "type": "string",
            "enum": list(lead_svc.LEAD_SORTS),
            "description": (
                "Result order. 'newest' (default) = most recently created first — "
                "use this for the latest/newest lead. 'oldest' = earliest created. "
                "'recently_updated' = most recently edited. 'highest_value' = "
                "largest estimated value. 'highest_score' = best lead score."
            ),
            "default": lead_svc.DEFAULT_LEAD_SORT,
        },
        **lead_svc.DATE_BOUND_PARAMETERS,
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def search_leads(
    ctx: ToolContext,
    search: str | None = None,
    stage: str | None = None,
    assignee_id: str | None = None,
    limit: int = 20,
    sort: str | None = None,
    created_after: str | None = None,
    created_before: str | None = None,
    updated_after: str | None = None,
    updated_before: str | None = None,
    timezone: str | None = None,
    **_: Any,
) -> dict:
    return await lead_svc.search_leads(
        organization_id=ctx.organization_id,
        search=search,
        stage=stage,
        assignee_id=assignee_id,
        limit=limit,
        sort=sort,
        created_after=created_after,
        created_before=created_before,
        updated_after=updated_after,
        updated_before=updated_before,
        timezone=timezone or ctx.timezone,
    )


@register_tool(
    name="count_leads",
    description=(
        "WHEN: the user asks how many leads, optionally in a stage or date "
        "window. NOT: a roster or names (use search_leads); quotations; "
        "dashboard KPIs (use get_ceo_dashboard). NEEDS: nothing required. "
        "RETURNS: `total` plus `by_stage` and `by_status` for the same filter. "
        "Never treat search_leads item length as the organisation total. "
        "When listing everyone in a stage, pass limit=50 (or higher) — "
        "default limit truncates and `count` can be less than `total`. "
        "Stage is live: `total` is who is in that stage now. Date bounds "
        "without a stage filter the created/updated window. Both together "
        "keep `total` as the live board and add `in_window.created` / "
        "`in_window.updated`. Report both; never treat a window count as how "
        "many ARE in the stage."
    ),
    parameters={
        "stage": {"type": "string", "description": f"Optional pipeline stage: {_STAGES}"},
        **lead_svc.DATE_BOUND_PARAMETERS,
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def count_leads(
    ctx: ToolContext,
    stage: str | None = None,
    created_after: str | None = None,
    created_before: str | None = None,
    updated_after: str | None = None,
    updated_before: str | None = None,
    timezone: str | None = None,
    **_: Any,
) -> dict:
    return await lead_svc.count_leads(
        organization_id=ctx.organization_id,
        stage=stage,
        created_after=created_after,
        created_before=created_before,
        updated_after=updated_after,
        updated_before=updated_before,
        timezone=timezone or ctx.timezone,
    )


@register_tool(
    name="list_follow_ups",
    description=(
        "WHEN: the user asks about follow-ups or callbacks — the Follow-ups "
        "screen. NOT: looking up a lead by name (search_leads / get_lead), a "
        "stage roster, or call history (list_calls). NEEDS: nothing. RETURNS: "
        "short lead cards plus follow_up_bucket and last_call_outcome. A "
        "follow-up is a lead whose most recent call ended in CALLBACK_SCHEDULED, "
        "not merely next_follow_up_at."
    ),
    parameters={
        "limit": {"type": "integer", "description": "Max rows (1-100)", "default": 50},
    },
    kind="read",
    modes=("minimal", "advanced"),
)
async def list_follow_ups(ctx: ToolContext, limit: int = 50, **_: Any) -> dict:
    return await lead_svc.list_follow_ups(
        organization_id=ctx.organization_id, limit=limit
    )


@register_tool(
    name="get_lead",
    description=(
        "WHEN: full details of one lead you already identified (notes, "
        "activities, assignee). NOT: a list or 'who is WON' (search_leads); a "
        "count (count_leads). NEEDS: lead_id — a lead id OR the customer/company "
        "name. If you do not have one, call search_leads first. Never ask the "
        "user for an internal id. RETURNS: the full lead record."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Lead id, or the lead/company name"},
    },
    kind="read",
    modes=("minimal", "advanced"),
    required=["lead_id"],
)
async def get_lead(ctx: ToolContext, lead_id: str, **_: Any) -> dict:
    return await lead_svc.get_lead(organization_id=ctx.organization_id, lead_id=lead_id)


@register_tool(
    name="create_lead",
    description=(
        "WHEN: add someone who is not already in the CRM. NOT: updating an "
        "existing lead (update_lead); creating a duplicate after a name lookup "
        "failed (search_leads instead). NEEDS: title (name). RETURNS: the new lead."
    ),
    parameters={
        "title": {"type": "string", "description": "Lead / contact name"},
        "company": {"type": "string"},
        "phone": {"type": "string"},
        "email": {"type": "string"},
        "city": {"type": "string"},
        "product_interest": {"type": "string"},
        "quantity_estimate": {"type": "string"},
        "notes": {"type": "string"},
        "stage": {"type": "string", "description": f"Initial stage ({_STAGES}), default NEW"},
        "assignee_id": {"type": "string", "description": "Team member user id to assign"},
        "next_follow_up_at": {
            "type": "string",
            "description": "ISO-8601 datetime for follow-up",
        },
        "estimated_value": {"type": "number"},
        "source": {
            "type": "string",
            "description": "Lead source enum e.g. MANUAL, WHATSAPP, REFERRAL",
        },
    },
    kind="write",
    modes=("advanced",),
    required=["title"],
    summary_fn=_create_summary,
)
async def create_lead(
    ctx: ToolContext,
    title: str,
    company: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    city: str | None = None,
    product_interest: str | None = None,
    quantity_estimate: str | None = None,
    notes: str | None = None,
    stage: str | None = None,
    assignee_id: str | None = None,
    next_follow_up_at: str | None = None,
    estimated_value: float | None = None,
    source: str | None = None,
    **_: Any,
) -> dict:
    follow_up = None
    if next_follow_up_at:
        follow_up = datetime.fromisoformat(next_follow_up_at.replace("Z", "+00:00"))
    return await lead_svc.create_lead(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        title=title,
        company=company,
        phone=phone,
        email=email,
        city=city,
        product_interest=product_interest,
        quantity_estimate=quantity_estimate,
        notes=notes,
        stage=stage or "NEW",
        assignee_id=assignee_id,
        next_follow_up_at=follow_up,
        estimated_value=estimated_value,
        source=source or "MANUAL",
        activity_body="Lead created via Loomrun AI",
        activity_metadata={"source": "loomrun_ai"},
    )


@register_tool(
    name="update_lead",
    description=(
        "WHEN: change an EXISTING lead — sales stage, assignee, or contact "
        "fields. Sales stages: NEW, CONTACTED, QUALIFICATION, QUOTATION, "
        "NEGOTIATION, SAMPLE, WON, LOST. NOT: quotation line edits "
        "(update_quotation); scheduling a follow-up that appears on the "
        "Follow-ups screen (schedule_follow_up). NOT: factory steps like CUTTING "
        "(update_production_order). NEEDS: lead_id (id or customer/company name). "
        "Never ask the user for an internal id. RETURNS: the updated lead."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Lead id, or the lead/company name"},
        "stage": {"type": "string", "description": f"New stage: {_STAGES}"},
        "assignee_id": {"type": "string", "description": "Assign to this user id"},
        "next_follow_up_at": {
            "type": "string",
            "description": (
                "ISO-8601 follow-up time. Does NOT add the lead to the Follow-ups "
                "list by itself — use schedule_follow_up instead."
            ),
        },
        "title": {"type": "string"},
        "company": {"type": "string"},
        "phone": {"type": "string"},
        "email": {"type": "string"},
        "city": {"type": "string"},
        "notes": {"type": "string"},
        "product_interest": {"type": "string"},
        "quantity_estimate": {"type": "string"},
        "estimated_value": {"type": "number"},
        "lead_status": {"type": "string", "description": "ACTIVE, WON, or LOST status enum"},
    },
    kind="write",
    modes=("advanced",),
    required=["lead_id"],
    summary_fn=_update_summary,
)
async def update_lead(
    ctx: ToolContext,
    lead_id: str,
    stage: str | None = None,
    assignee_id: str | None = None,
    next_follow_up_at: str | None = None,
    title: str | None = None,
    company: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    city: str | None = None,
    notes: str | None = None,
    product_interest: str | None = None,
    quantity_estimate: str | None = None,
    estimated_value: float | None = None,
    lead_status: str | None = None,
    **_: Any,
) -> dict:
    follow_up = None
    if next_follow_up_at:
        follow_up = datetime.fromisoformat(next_follow_up_at.replace("Z", "+00:00"))
    return await lead_svc.update_lead(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        lead_id=lead_id,
        stage=stage,
        assignee_id=assignee_id,
        next_follow_up_at=follow_up,
        title=title,
        company=company,
        phone=phone,
        email=email,
        city=city,
        notes=notes,
        product_interest=product_interest,
        quantity_estimate=quantity_estimate,
        estimated_value=estimated_value,
        lead_status=lead_status,
        activity_source="loomrun_ai",
    )


@register_tool(
    name="schedule_follow_up",
    description=(
        "WHEN: schedule a callback/follow-up that must appear on the Follow-ups "
        "screen. NOT: bare next_follow_up_at on update_lead (that date alone is "
        "invisible there). NEEDS: lead_id (id or name) and at (ISO-8601). "
        "Never ask the user for an internal id."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Lead id, or the lead/company name"},
        "at": {"type": "string", "description": "ISO-8601 datetime for the follow-up"},
        "notes": {"type": "string"},
    },
    kind="write",
    modes=("advanced",),
    required=["lead_id", "at"],
    summary_fn=lambda a: f"Schedule follow-up for {a.get('lead_id', '?')} at {a.get('at', '?')}",
)
async def schedule_follow_up(
    ctx: ToolContext,
    lead_id: str,
    at: str,
    notes: str | None = None,
    **_: Any,
) -> dict:
    when = datetime.fromisoformat(at.replace("Z", "+00:00"))
    return await call_svc.log_call(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        lead_id=lead_id,
        outcome="CALLBACK_SCHEDULED",
        notes=notes or "Follow-up scheduled via Loomrun AI",
        next_call_at=when,
    )
