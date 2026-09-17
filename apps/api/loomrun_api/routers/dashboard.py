from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from loomrun_api.date_filter import apply_created_at, apply_recorded_at, parse_day_param
from loomrun_api.deps import OrgContext, require_roles
from loomrun_api.pnl import compute_pnl
from loomrun_api.prisma_client import prisma
from loomrun_api.services.leads import _group_count
from loomrun_api.services.production import days_until, resolve_order_status
from prisma.enums import LeadStage, PaymentStatus, ProductionActivityType, QuotationStatus

router = APIRouter()

HOT_VALUE_THRESHOLD = 10_000.0


@router.get("/orgs/{org_id}/dashboard/ceo")
async def ceo_dashboard(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    return await build_ceo_dashboard(organization_id=ctx.organization_id, day=day)


async def build_ceo_dashboard(*, organization_id: str, day: str | None = None) -> dict:
    """The CEO dashboard figures, independent of the HTTP layer.

    Extracted so the AI agent reports the same numbers the screen shows rather
    than recomputing them from a different query and quietly disagreeing.
    """
    oid = organization_id
    now = datetime.now(timezone.utc)
    day_rng = parse_day_param(day)

    if day_rng is None:
        overdue_cutoff = now - timedelta(days=2)
        hot_leads = await prisma.lead.count(
            where={
                "organizationId": oid,
                "stage": {"in": [LeadStage.NEGOTIATION, LeadStage.SAMPLE]},
                "estimatedValue": {"gte": HOT_VALUE_THRESHOLD},
            }
        )
        pending_quotations = await prisma.quotation.count(
            where={"organizationId": oid, "status": QuotationStatus.SENT},
        )
        delayed_followups = await prisma.lead.count(
            where={
                "organizationId": oid,
                "nextFollowUpAt": {"lt": overdue_cutoff},
                "stage": {
                    "in": [
                        LeadStage.NEW,
                        LeadStage.CONTACTED,
                        LeadStage.QUALIFICATION,
                        LeadStage.QUOTATION,
                        LeadStage.NEGOTIATION,
                        LeadStage.SAMPLE,
                    ]
                },
            },
        )
        orders = await prisma.productionorder.find_many(
            where={"organizationId": oid},
            order={"updatedAt": "desc"},
            include={"lead": True},
        )
        collections_pending = await prisma.payment.count(
            where={"organizationId": oid, "status": PaymentStatus.PENDING},
        )
        # "All" period: total calls logged (not just today), matching other totals.
        telecaller_calls = await prisma.telecallercalllog.count(
            where={"organizationId": oid},
        )
    else:
        hot_where: dict = {
            "organizationId": oid,
            "stage": {"in": [LeadStage.NEGOTIATION, LeadStage.SAMPLE]},
            "estimatedValue": {"gte": HOT_VALUE_THRESHOLD},
        }
        apply_created_at(hot_where, day)
        hot_leads = await prisma.lead.count(where=hot_where)

        quote_where: dict = {"organizationId": oid, "status": QuotationStatus.SENT}
        apply_created_at(quote_where, day)
        pending_quotations = await prisma.quotation.count(where=quote_where)

        followup_where: dict = {
            "organizationId": oid,
            "nextFollowUpAt": {"lt": day_rng[1]},
            "stage": {
                "in": [
                    LeadStage.NEW,
                    LeadStage.CONTACTED,
                    LeadStage.QUALIFICATION,
                    LeadStage.QUOTATION,
                    LeadStage.NEGOTIATION,
                    LeadStage.SAMPLE,
                ]
            },
        }
        apply_created_at(followup_where, day)
        delayed_followups = await prisma.lead.count(where=followup_where)

        prod_where: dict = {"organizationId": oid}
        apply_created_at(prod_where, day)
        orders = await prisma.productionorder.find_many(
            where=prod_where,
            order={"updatedAt": "desc"},
            include={"lead": True},
        )

        pay_where: dict = {"organizationId": oid, "status": PaymentStatus.PENDING}
        apply_recorded_at(pay_where, day)
        collections_pending = await prisma.payment.count(where=pay_where)

        call_where: dict = {"organizationId": oid}
        apply_created_at(call_where, day)
        telecaller_calls = await prisma.telecallercalllog.count(where=call_where)

    stage_counts: dict[str, int] = {}
    delayed_orders = 0
    on_hold_orders = 0
    active_orders = 0
    completed_orders = 0
    upcoming_dispatches: list[dict] = []
    for o in orders:
        name = o.stage.name if hasattr(o.stage, "name") else str(o.stage)
        stage_counts[name] = stage_counts.get(name, 0) + 1
        status = resolve_order_status(o)
        if status == "DELAYED":
            delayed_orders += 1
        if status == "ON_HOLD":
            on_hold_orders += 1
        if name == "DELIVERED" or status == "COMPLETED":
            completed_orders += 1
        elif status != "CANCELLED":
            active_orders += 1
        days = days_until(getattr(o, "expectedDispatchAt", None))
        if (
            days is not None
            and 0 <= days <= 7
            and name not in ("SHIPPED", "DELIVERED")
            and status not in ("CANCELLED", "COMPLETED")
        ):
            upcoming_dispatches.append(
                {
                    "id": o.id,
                    "order_number": getattr(o, "orderNumber", None),
                    "lead_title": o.lead.title if o.lead else None,
                    "display_name": o.name or (o.lead.title if o.lead else None),
                    "stage": name,
                    "order_status": status,
                    "expected_dispatch_at": (
                        o.expectedDispatchAt.isoformat() if o.expectedDispatchAt else None
                    ),
                    "days_until_dispatch": days,
                }
            )
    upcoming_dispatches.sort(key=lambda x: (x["days_until_dispatch"], x["order_number"] or ""))
    upcoming_dispatches = upcoming_dispatches[:8]
    bottleneck_stage = max(stage_counts, key=stage_counts.get) if stage_counts else None

    # ── Pipeline totals (respect the day filter via createdAt) ──────────────────
    leads_where: dict = {"organizationId": oid}
    apply_created_at(leads_where, day)
    total_leads = await prisma.lead.count(where=leads_where)

    followups_where: dict = {"organizationId": oid, "nextFollowUpAt": {"not": None}}
    apply_created_at(followups_where, day)
    follow_ups = await prisma.lead.count(where=followups_where)

    def _estimated_value_cents(leads: list) -> int:
        total = 0
        for lead in leads:
            if lead.estimatedValue is None:
                continue
            total += int(round(float(lead.estimatedValue) * 100))
        return total

    won_where: dict = {"organizationId": oid, "stage": LeadStage.WON}
    apply_created_at(won_where, day)
    lost_where: dict = {"organizationId": oid, "stage": LeadStage.LOST}
    apply_created_at(lost_where, day)
    won_leads = await prisma.lead.find_many(where=won_where)
    lost_leads = await prisma.lead.find_many(where=lost_where)
    deals_won_count = len(won_leads)
    deals_lost_count = len(lost_leads)
    deals_won_value = _estimated_value_cents(won_leads)
    deals_lost_value = _estimated_value_cents(lost_leads)
    closed_count = deals_won_count + deals_lost_count
    win_rate_percent = (
        round(100.0 * deals_won_count / closed_count, 1) if closed_count else None
    )

    quotations_sent_where: dict = {"organizationId": oid, "sentAt": {"not": None}}
    apply_created_at(quotations_sent_where, day)
    quotations_sent = await prisma.quotation.count(where=quotations_sent_where)

    invoices_created_where: dict = {"organizationId": oid, "invoiceNumber": {"not": None}}
    apply_created_at(invoices_created_where, day)
    invoices_created = await prisma.quotation.count(where=invoices_created_where)

    # "Sent" counts are derived from logged outbound messages, which carry the
    # doc_type of each send (quotation vs invoice).
    outbound_where: dict = {"organizationId": oid}
    apply_created_at(outbound_where, day)
    outbound_msgs = await prisma.outboundmessage.find_many(where=outbound_where)
    invoices_sent = sum(
        1
        for m in outbound_msgs
        if isinstance(m.payload, dict) and m.payload.get("doc_type") == "invoice"
    )

    # ── Integration statuses (live, not hard-coded) ─────────────────────────────
    lead_conns = await prisma.leadconnection.find_many(where={"organizationId": oid})
    lead_conn_by_source = {c.sourceName: c for c in lead_conns}
    connected_lead_sources = sum(1 for c in lead_conns if c.status == "connected")

    gmail_conn = await prisma.automationconnection.find_first(
        where={"organizationId": oid, "serviceName": "GMAIL", "membershipId": None}
    )
    telephony_conn = await prisma.telephonyconfig.find_first(
        where={"organizationId": oid, "isActive": True}
    )

    def _lead_source_status(source: str) -> str:
        c = lead_conn_by_source.get(source)
        return "connected" if c and c.status == "connected" else "disconnected"

    integrations = [
        {
            "key": "whatsapp",
            "label": "WhatsApp",
            "status": _lead_source_status("WHATSAPP"),
            "detail": None,
            "link": "/app/whatsapp",
        },
        {
            "key": "telephony",
            "label": "Telephony",
            "status": "connected" if telephony_conn else "disconnected",
            "detail": telephony_conn.providerName if telephony_conn else None,
            "link": "/app/settings/telephony",
        },
        {
            "key": "gmail",
            "label": "Gmail",
            "status": "connected" if gmail_conn and gmail_conn.status == "connected" else "disconnected",
            "detail": gmail_conn.connectedEmail if gmail_conn and gmail_conn.status == "connected" else None,
            "link": "/app/leads/connections",
        },
        {
            "key": "meta_ads",
            "label": "Meta Ads",
            "status": _lead_source_status("META_ADS"),
            "detail": None,
            "link": "/app/leads/connections",
        },
        {
            "key": "lead_sources",
            "label": "Lead Sources",
            "status": "connected" if connected_lead_sources > 0 else "disconnected",
            "detail": f"{connected_lead_sources} connected" if connected_lead_sources else None,
            "link": "/app/leads/connections",
        },
    ]

    act_where: dict = {"organizationId": oid}
    if day_rng is not None:
        apply_created_at(act_where, day)
    recent_acts = await prisma.productionactivity.find_many(
        where=act_where,
        order={"createdAt": "desc"},
        take=15,
        include={"lead": True, "user": True},
    )
    recent_activity = [
        {
            "id": a.id,
            "type": a.type.name if hasattr(a.type, "name") else str(a.type),
            "body": a.body,
            "lead_id": a.leadId,
            "lead_title": a.lead.title if a.lead else None,
            "user_name": a.user.name if a.user else None,
            "metadata": a.metadata,
            "created_at": a.createdAt.isoformat(),
        }
        for a in recent_acts
    ]
    stage_changes_today = await prisma.productionactivity.count(
        where={
            "organizationId": oid,
            "type": ProductionActivityType.STAGE_CHANGED,
            "createdAt": (
                {"gte": now.replace(hour=0, minute=0, second=0, microsecond=0), "lt": now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)}
                if day_rng is None
                else {"gte": day_rng[0], "lt": day_rng[1]}
            ),
        },
    )

    # ── Expense / P&L summary ───────────────────────────────────────────────────
    expense_where: dict = {"organizationId": oid}
    if day_rng is not None:
        expense_where["incurredAt"] = {"gte": day_rng[0], "lt": day_rng[1]}
    expense_rows = await prisma.expense.find_many(where=expense_where)
    job_cost_total = sum(e.amountCents for e in expense_rows if e.productionOrderId)
    overhead_total = sum(e.amountCents for e in expense_rows if not e.productionOrderId)

    pnl_orders = await prisma.productionorder.find_many(
        where={"organizationId": oid},
        include={"lead": True, "quotation": True, "payments": True, "expenses": True},
        order={"updatedAt": "desc"},
    )
    budget_overrun_count = 0
    margin_sum = 0
    margin_jobs = 0
    revenue_total = 0
    jobs_with_revenue = 0
    collected_total = 0
    budget_total = 0
    jobs_with_budget = 0
    client_pnl: list[dict] = []

    for o in pnl_orders:
        pnl = compute_pnl(order=o)
        stage_name = o.stage.name if hasattr(o.stage, "name") else str(o.stage)
        lead = o.lead
        client_pnl.append(
            {
                "lead_id": o.leadId,
                "lead_title": lead.title if lead else None,
                "company": lead.company if lead else None,
                "production_order_id": o.id,
                "name": o.name,
                "display_name": o.name or (lead.title if lead else None),
                "stage": stage_name,
                "delay_flag": o.delayFlag,
                "revenue_cents": pnl["revenue_cents"],
                "budget_cents": pnl["budget_cents"],
                "actual_cost_cents": pnl["actual_cost_cents"],
                "collected_cents": pnl["collected_cents"],
                "margin_cents": pnl["margin_cents"],
                "budget_variance_cents": pnl["budget_variance_cents"],
                "collection_gap_cents": pnl["collection_gap_cents"],
                "over_budget": pnl["over_budget"],
                "revenue_source": pnl["revenue_source"],
            }
        )
        if pnl["over_budget"]:
            budget_overrun_count += 1
        if pnl["margin_cents"] is not None:
            margin_sum += pnl["margin_cents"]
            margin_jobs += 1
        if pnl["revenue_cents"] is not None:
            revenue_total += pnl["revenue_cents"]
            jobs_with_revenue += 1
        collected_total += pnl["collected_cents"]
        if pnl["budget_cents"] is not None:
            budget_total += pnl["budget_cents"]
            jobs_with_budget += 1

    # Sort clients: over-budget first, then by spend desc
    client_pnl.sort(
        key=lambda row: (
            0 if row["over_budget"] else 1,
            -(row["actual_cost_cents"] or 0),
            (row["display_name"] or row["lead_title"] or "").lower(),
        )
    )

    pipeline_value: dict[str, dict[str, int]] = {}
    valued_leads = await prisma.lead.find_many(
        where={**leads_where, "estimatedValue": {"not": None}},
    )
    for lead in valued_leads:
        stage_name = lead.stage.name if hasattr(lead.stage, "name") else str(lead.stage)
        rec = pipeline_value.setdefault(stage_name, {"count": 0, "value_cents": 0})
        rec["count"] += 1
        rec["value_cents"] += int(round(float(lead.estimatedValue) * 100))

    return {
        "generated_at": now.isoformat(),
        "hot_leads": {"count": hot_leads, "threshold_value": HOT_VALUE_THRESHOLD},
        "total_leads": {"count": total_leads},
        "follow_ups": {"count": follow_ups},
        "deals_won": {"count": deals_won_count, "value_cents": deals_won_value},
        "deals_lost": {"count": deals_lost_count, "value_cents": deals_lost_value},
        "win_rate": {"percent": win_rate_percent, "closed_count": closed_count},
        "quotations_sent": {"count": quotations_sent},
        "invoices_created": {"count": invoices_created},
        "invoices_sent": {"count": invoices_sent},
        "pending_quotations": {"count": pending_quotations},
        "delayed_followups": {"count": delayed_followups, "overdue_days": 2},
        "production_bottlenecks": {
            "by_stage": stage_counts,
            "busiest_stage": bottleneck_stage,
        },
        "order_health": {
            "active": active_orders,
            "delayed": delayed_orders,
            "on_hold": on_hold_orders,
            "completed": completed_orders,
            "upcoming_dispatches": upcoming_dispatches,
        },
        "collections_pending": {"count": collections_pending},
        "telecaller_today": {"calls": telecaller_calls},
        "stage_changes_today": {"count": stage_changes_today},
        "job_cost_total": {"amount_cents": job_cost_total},
        "overhead_total": {"amount_cents": overhead_total},
        "expense_total": {"amount_cents": job_cost_total + overhead_total},
        "budget_overrun_count": {"count": budget_overrun_count},
        "margin_aggregate": {
            "amount_cents": margin_sum,
            "jobs_with_revenue": margin_jobs,
        },
        "pnl_overview": {
            "revenue_cents": revenue_total,
            "jobs_with_revenue": jobs_with_revenue,
            "job_cost_cents": job_cost_total,
            "overhead_cents": overhead_total,
            "expense_cents": job_cost_total + overhead_total,
            "collected_cents": collected_total,
            "budget_cents": budget_total,
            "jobs_with_budget": jobs_with_budget,
            "margin_cents": margin_sum,
            "collection_gap_cents": revenue_total - collected_total if jobs_with_revenue else None,
            "client_count": len(client_pnl),
            "over_budget_count": budget_overrun_count,
        },
        "client_pnl": client_pnl,
        "integrations": integrations,
        "recent_activity": recent_activity,
        "leads_by_source": await _group_count(field="source", where=leads_where),
        "leads_by_stage": await _group_count(field="stage", where=leads_where),
        "funnel": {
            "leads": total_leads,
            "follow_ups": follow_ups,
            "quotations": quotations_sent,
            "orders": len(orders),
            "completed": completed_orders,
        },
        "pipeline_value": pipeline_value,
    }
