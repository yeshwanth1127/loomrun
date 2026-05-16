import logging

from arq.connections import RedisSettings

from loomrun_api.config import settings
from loomrun_api.pdf import brand_pdf_kwargs_from_org, render_quotation_pdf
from prisma import Prisma

logger = logging.getLogger(__name__)


async def generate_quotation_pdf_job(_ctx: dict, quotation_id: str) -> str | None:
    db = Prisma()
    await db.connect()
    try:
        q = await db.quotation.find_unique(
            where={"id": quotation_id},
            include={"lines": True, "lead": True, "organization": True},
        )
        if not q:
            logger.warning("quotation not found for pdf job %s", quotation_id)
            return None
        lines = [
            {
                "description": ln.description,
                "quantity": float(ln.quantity),
                "unit_price": float(ln.unitPrice),
                "line_total": float(ln.lineTotal),
            }
            for ln in (q.lines or [])
        ]
        rel = render_quotation_pdf(
            quotation_id=q.id,
            org_id=q.organizationId,
            number=q.number,
            lines=lines,
            lead_title=q.lead.title if q.lead else "",
            **brand_pdf_kwargs_from_org(q.organization),
        )
        await db.quotation.update(where={"id": quotation_id}, data={"pdfUrl": rel, "pdfJobId": None})
        return rel
    finally:
        await db.disconnect()


async def process_outbound_whatsapp(_ctx: dict) -> int:
    """Mark queued WhatsApp outbound rows as SENT (stub transport)."""
    db = Prisma()
    await db.connect()
    try:
        from prisma.enums import OutboundChannel, OutboundMessageStatus

        pending = await db.outboundmessage.find_many(
            where={
                "channel": OutboundChannel.WHATSAPP,
                "status": OutboundMessageStatus.QUEUED,
            },
            take=50,
        )
        count = 0
        for msg in pending:
            await db.outboundmessage.update(
                where={"id": msg.id},
                data={"status": OutboundMessageStatus.SENT, "attempts": msg.attempts + 1},
            )
            count += 1
        return count
    finally:
        await db.disconnect()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions = [generate_quotation_pdf_job, process_outbound_whatsapp]
