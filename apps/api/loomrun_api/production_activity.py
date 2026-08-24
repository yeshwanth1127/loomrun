from prisma import Prisma
from prisma.enums import ProductionActivityType

from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta


async def log_production_activity(
    *,
    organization_id: str,
    production_order_id: str,
    lead_id: str,
    user_id: str | None,
    activity_type: ProductionActivityType,
    body: str,
    metadata: dict | None = None,
    db: Prisma | None = None,
) -> None:
    client = db or prisma
    await client.productionactivity.create(
        data={
            "organizationId": organization_id,
            "productionOrderId": production_order_id,
            "leadId": lead_id,
            "userId": user_id,
            "type": activity_type,
            "body": body,
            "metadata": json_meta(metadata),
        }
    )


def stage_label(stage: str) -> str:
    return stage.replace("_", " ").title()
