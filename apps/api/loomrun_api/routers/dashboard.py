from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from loomrun_api.date_filter import apply_created_at, apply_recorded_at, parse_day_param
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from prisma.enums import LeadStage, PaymentStatus, QuotationStatus

router = APIRouter()

HOT_VALUE_THRESHOLD = 10_000.0


@router.get("/orgs/{org_id}/dashboard/ceo")
async def ceo_dashboard(
    org_id: str,
    day: str | None = Query(None, description="YYYY-MM-DD or all"),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    oid = ctx.organization_id
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
        )
        collections_pending = await prisma.payment.count(
            where={"organizationId": oid, "status": PaymentStatus.PENDING},
        )
        start_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        telecaller_calls = await prisma.telecallercalllog.count(
            where={
                "organizationId": oid,
                "createdAt": {"gte": start_day, "lt": start_day + timedelta(days=1)},
            },
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
        )

        pay_where: dict = {"organizationId": oid, "status": PaymentStatus.PENDING}
        apply_recorded_at(pay_where, day)
        collections_pending = await prisma.payment.count(where=pay_where)

        call_where: dict = {"organizationId": oid}
        apply_created_at(call_where, day)
        telecaller_calls = await prisma.telecallercalllog.count(where=call_where)

    stage_counts: dict[str, int] = {}
    for o in orders:
        name = o.stage.name if hasattr(o.stage, "name") else str(o.stage)
        stage_counts[name] = stage_counts.get(name, 0) + 1
    bottleneck_stage = max(stage_counts, key=stage_counts.get) if stage_counts else None

    return {
        "generated_at": now.isoformat(),
        "hot_leads": {"count": hot_leads, "threshold_value": HOT_VALUE_THRESHOLD},
        "pending_quotations": {"count": pending_quotations},
        "delayed_followups": {"count": delayed_followups, "overdue_days": 2},
        "production_bottlenecks": {
            "by_stage": stage_counts,
            "busiest_stage": bottleneck_stage,
        },
        "collections_pending": {"count": collections_pending},
        "telecaller_today": {"calls": telecaller_calls},
    }
