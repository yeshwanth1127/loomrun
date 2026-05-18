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
    """Mark queued WhatsApp and email outbound rows as SENT (stub transport)."""
    db = Prisma()
    await db.connect()
    try:
        from prisma.enums import OutboundMessageStatus

        pending = await db.outboundmessage.find_many(
            where={"status": OutboundMessageStatus.QUEUED},
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


async def check_lead_call_needed(_ctx: dict, lead_id: str, org_id: str) -> str:
    """
    Check if a lead needs an automated AI call (5-min fallback).

    Fires 5 minutes after lead creation. If no human-initiated call has been logged,
    triggers an automated call via the org's active AI call provider.
    """
    import httpx

    db = Prisma()
    await db.connect()
    try:
        existing_call = await db.telecallercalllog.find_first(
            where={"leadId": lead_id, "organizationId": org_id}
        )
        if existing_call:
            logger.info("Lead %s already has a call log, skipping AI auto-call", lead_id)
            return "skipped"

        lead = await db.lead.find_first(where={"id": lead_id})
        if not lead or not lead.phone:
            logger.warning("Lead %s has no phone number, skipping AI auto-call", lead_id)
            return "no_phone"

        config = await db.telephonyconfig.find_first(
            where={"organizationId": org_id, "providerType": "AI_CALL", "isActive": True}
        )
        if not config:
            logger.warning("Org %s has no active AI call provider configured", org_id)
            return "no_provider"

        from loomrun_api.telephony.resolver import get_active_ai_adapter

        try:
            adapter = get_active_ai_adapter.__wrapped__(org_id)  # call the unwrapped coroutine
            await adapter.initiate_call(
                lead_phone=lead.phone,
                lead_name=lead.title,
                metadata={"lead_id": lead_id, "org_id": org_id}
            )

            from prisma.enums import CallOutcome, LeadStage
            from loomrun_api.lead_call_sync import sync_lead_after_call

            attempt_number = await db.telecallercalllog.count(where={"leadId": lead_id}) + 1
            await db.telecallercalllog.create(
                data={
                    "organizationId": org_id,
                    "leadId": lead_id,
                    "userId": None,
                    "attemptNumber": attempt_number,
                    "outcome": CallOutcome.CONNECTED,
                    "callSource": "AI_AUTO",
                }
            )
            await sync_lead_after_call(
                lead_id=lead_id,
                user_id=None,
                outcome=CallOutcome.CONNECTED,
                notes=None,
                attempt=attempt_number,
                lead_stage=lead.stage,
                logged_by="AI Auto-Call",
                db=db,
            )
            logger.info("AI auto-call initiated for lead %s via %s", lead_id, config.providerName)
            return "initiated"
        except Exception as e:
            logger.error("Failed to initiate AI auto-call for lead %s: %s", lead_id, e)
            return "failed"
    finally:
        await db.disconnect()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions = [generate_quotation_pdf_job, process_outbound_whatsapp, check_lead_call_needed]
