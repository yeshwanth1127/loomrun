from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma
from prisma.enums import LeadStage, PaymentStatus, QuotationStatus

router = APIRouter()

HOT_VALUE_THRESHOLD = 10_000.0


@router.get("/orgs/{org_id}/dashboard/ceo")
async def ceo_dashboard(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    oid = ctx.organization_id
    now = datetime.now(timezone.utc)
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
    stage_counts: dict[str, int] = {}
    for o in orders:
        name = o.stage.name if hasattr(o.stage, "name") else str(o.stage)
        stage_counts[name] = stage_counts.get(name, 0) + 1
    bottleneck_stage = max(stage_counts, key=stage_counts.get) if stage_counts else None

    collections_pending = await prisma.payment.count(
        where={"organizationId": oid, "status": PaymentStatus.PENDING},
    )

    start_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_day = start_day + timedelta(days=1)
    telecaller_calls = await prisma.telecallercalllog.count(
        where={
            "organizationId": oid,
            "createdAt": {"gte": start_day, "lt": end_day},
        },
    )

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
