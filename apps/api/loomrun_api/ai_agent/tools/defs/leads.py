"""Lead read/write tools."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from loomrun_api.ai_agent.tools.registry import ToolContext, register_tool
from loomrun_api.services import leads as lead_svc

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
        "Search and rank leads in this organization by text, stage, or assignee. "
        "ALWAYS call this for 'latest/newest/most recent lead', 'oldest lead', "
        "'biggest lead' or 'first N leads' — with the matching `sort` and "
        "limit=1 for a single answer. Results are ordered by `sort` "
        "(default newest-first by creation date) and every row carries "
        "`created_at`, so the first item is the answer to a 'latest' question. "
        "Never pick a lead out of background context or a prompt sample and call "
        "it the latest — that context is unordered. Returns up to `limit` rows "
        "(default 20, max 50) plus `total` for the full match count; never treat "
        "the length of `items` as the organisation total."
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
    **_: Any,
) -> dict:
    return await lead_svc.search_leads(
        organization_id=ctx.organization_id,
        search=search,
        stage=stage,
        assignee_id=assignee_id,
        limit=limit,
        sort=sort,
    )


@register_tool(
    name="count_leads",
    description=(
        "Return the organisation-wide lead total plus breakdowns by pipeline stage and "
        "status (ACTIVE/WON/LOST). ALWAYS call this when the user asks how many leads "
        "they have. Do not infer a count from Brain snippets or from search_leads items."
    ),
    parameters={},
    kind="read",
    modes=("minimal", "advanced"),
)
async def count_leads(ctx: ToolContext, **_: Any) -> dict:
    return await lead_svc.count_leads(organization_id=ctx.organization_id)


@register_tool(
    name="list_follow_ups",
    description=(
        "List leads awaiting a follow-up — the exact contents of the Follow-ups "
        "screen. Use this ONLY when the user asks about follow-ups or callbacks: "
        "'any follow ups?', 'follow-ups today', 'who do I need to call back'. It "
        "is NOT a way to look a lead up by name — use search_leads for that, or "
        "pass the name straight to get_lead/update_lead. A follow-up is a "
        "lead whose most recent call ended in CALLBACK_SCHEDULED; this is NOT the "
        "same as a lead having a next_follow_up_at date, so do not answer these "
        "questions from search_leads or from background context — they will "
        "disagree with what the user sees on screen. Returns `total`, per-bucket "
        "counts (overdue / today / upcoming / unscheduled) and the matching leads. "
        "A lead with no date set is still a follow-up: report it under "
        "'no date set', never as 'none'."
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
        "Get one lead, including recent activities and assignee. `lead_id` "
        "accepts either a lead id or the customer/company name — the name is "
        "resolved for you, and an ambiguous one comes back with the choices."
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
        "Create a new lead. Use for someone not already in the CRM. "
        "Required: title (name). Optional: phone, email, company, notes, stage."
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
        "Update an EXISTING lead: move its SALES stage, set follow-up, assign "
        "owner, or change contact fields. This is the tool for 'move X to "
        "<stage>' whenever the stage named is one of NEW, CONTACTED, "
        "QUALIFICATION, QUOTATION, NEGOTIATION, SAMPLE, WON, LOST — factory "
        "stages like CUTTING belong to update_production_order. `lead_id` "
        "accepts either a lead id or the customer/company name, so you do not "
        "need to look the id up first; an ambiguous name "
        "comes back with the matching leads to choose from. If it reports no "
        "match, fix the name — never call create_lead to work around it."
    ),
    parameters={
        "lead_id": {"type": "string", "description": "Lead id, or the lead/company name"},
        "stage": {"type": "string", "description": f"New stage: {_STAGES}"},
        "assignee_id": {"type": "string", "description": "Assign to this user id"},
        "next_follow_up_at": {"type": "string", "description": "ISO-8601 follow-up time"},
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
