import logging

from arq.connections import RedisSettings

from loomrun_api.config import settings
from loomrun_api.pdf import brand_pdf_kwargs_from_org, render_quotation_pdf
from loomrun_api.prisma_client import prisma as db

logger = logging.getLogger(__name__)


async def generate_quotation_pdf_job(_ctx: dict, quotation_id: str) -> str | None:
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
    from loomrun_api.document_template_service import layout_from_json, resolve_template_for_render

    doc_type = "Invoice" if q.invoiceNumber else "Quotation"
    tmpl = await resolve_template_for_render(
        q.organizationId,
        doc_type,
        q.templateId,
        prefer_quotation_template=bool(q.invoiceNumber),
    )
    layout = layout_from_json(tmpl.layout) if tmpl else None
    rel = render_quotation_pdf(
        quotation_id=q.id,
        org_id=q.organizationId,
        number=q.number,
        lines=lines,
        lead_title=q.lead.title if q.lead else "",
        doc_type=doc_type,
        invoice_number=q.invoiceNumber,
        layout=layout,
        org=q.organization,
        lead=q.lead,
        subtotal=float(q.subtotal),
        tax=float(q.tax),
        total=float(q.total),
        invoiced_at=q.invoicedAt,
        created_at=q.createdAt,
        **brand_pdf_kwargs_from_org(q.organization),
    )
    await db.quotation.update(where={"id": quotation_id}, data={"pdfUrl": rel, "pdfJobId": None})
    return rel


async def process_outbound_whatsapp(_ctx: dict) -> int:
    """Send queued WhatsApp outbound messages.

    Routes via the org's self-hosted Baileys session when connected, otherwise
    falls back to the Meta Cloud API.
    """
    from loomrun_api import baileys_client
    from loomrun_api.whatsapp_client import send_whatsapp_text
    from prisma.enums import OutboundChannel, OutboundMessageStatus

    pending = await db.outboundmessage.find_many(
        where={"status": OutboundMessageStatus.QUEUED, "channel": OutboundChannel.WHATSAPP},
        take=50,
        include={"lead": True},
    )
    # Cache per-org Baileys connectivity for this batch.
    baileys_ready: dict[str, bool] = {}
    count = 0
    for msg in pending:
        phone = msg.lead.phone if msg.lead else None
        text = (msg.payload or {}).get("text") if isinstance(msg.payload, dict) else None

        if phone and text:
            org_id = msg.organizationId
            if org_id not in baileys_ready:
                baileys_ready[org_id] = await baileys_client.is_connected(org_id)
            if baileys_ready[org_id]:
                sent = await baileys_client.send_text(org_id, phone, text)
            else:
                sent = await send_whatsapp_text(phone, text)
            new_status = OutboundMessageStatus.SENT if sent else OutboundMessageStatus.FAILED
            last_error = None if sent else "API send failed"
        else:
            new_status = OutboundMessageStatus.FAILED
            last_error = "Missing phone or message text"

        await db.outboundmessage.update(
            where={"id": msg.id},
            data={"status": new_status, "attempts": msg.attempts + 1, "lastError": last_error},
        )
        count += 1
    return count


async def check_lead_call_needed(_ctx: dict, lead_id: str, org_id: str) -> str:
    """
    Check if a lead needs an automated AI call (5-min fallback).

    Fires 5 minutes after lead creation. If no human-initiated call has been logged,
    triggers an automated call via the org's active AI call provider.
    """
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

        from prisma.enums import CallOutcome
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


async def sync_meta_leads_job(_ctx: dict, org_id: str) -> dict:
    """ARQ / compatibility wrapper; sync logic lives in meta_sync.sync_org."""
    from loomrun_api.meta_sync import sync_org

    return await sync_org(org_id)


async def sync_indiamart_leads_job(_ctx: dict, org_id: str) -> dict:
    """
    ARQ job: pull IndiaMart leads for one org.
    Dispatched on-demand (e.g. from the Sync Now endpoint when running under ARQ).
    The main-process polling loop calls indiamart_client.sync_org() directly instead.
    """
    from datetime import datetime, timedelta, timezone

    from loomrun_api.indiamart_client import fetch_leads, map_record
    from loomrun_api.prisma_json import json_meta
    from prisma.enums import LeadActivityType, LeadSource

    connection = await db.leadconnection.find_first(
        where={"organizationId": org_id, "sourceName": "INDIAMART", "status": "connected"}
    )
    if not connection:
        return {"status": "no_connection"}

    crm_key = (connection.credentials or {}).get("api_key")
    if not crm_key:
        return {"status": "no_api_key"}

    now = datetime.now(timezone.utc)
    start = connection.lastSync or (now - timedelta(hours=24))

    try:
        records = await fetch_leads(crm_key, start, now)
    except Exception as exc:
        logger.warning("IndiaMart API error org=%s: %s", org_id, exc)
        return {"status": "api_error", "error": str(exc)}

    created = 0
    skipped = 0
    for raw in records:
        r = map_record(raw)
        if not r["query_id"]:
            continue
        existing = await db.lead.find_first(
            where={"organizationId": org_id, "indiamartQueryId": r["query_id"]}
        )
        if existing:
            skipped += 1
            continue

        score = 25
        if r["phone"] and r["email"]:
            score += 15
        elif r["phone"] or r["email"]:
            score += 8
        if r["product"]:
            score += 10
        if r["city"]:
            score += 5
        score = min(score, 100)

        lead = await db.lead.create(
            data={
                "organizationId": org_id,
                "title": r["name"] or "IndiaMart Inquiry",
                "source": LeadSource.INDIAMART,
                "phone": r["phone"],
                "email": r["email"],
                "city": r["city"],
                "company": r["company"],
                "productInterest": r["product"],
                "notes": r["message"],
                "leadScore": score,
                "indiamartQueryId": r["query_id"],
                "tags": [],
                "lastActivityAt": now,
            }
        )
        await db.leadactivity.create(
            data={
                "leadId": lead.id,
                "type": LeadActivityType.SYSTEM,
                "body": f"Lead imported from IndiaMart{' · ' + r['product'] if r['product'] else ''}",
                "metadata": json_meta({"query_id": r["query_id"]}),
            }
        )
        # No auto-greeting here: bulk IndiaMart sync. Live new inquiries are
        # greeted via the poll path (indiamart_client.upsert_lead).
        created += 1

    await db.leadconnection.update_many(
        where={"organizationId": org_id, "sourceName": "INDIAMART"},
        data={"leadsCount": {"increment": created}, "lastSync": now},
    )
    logger.info("IndiaMart ARQ sync org=%s created=%d skipped=%d", org_id, created, skipped)
    return {"status": "done", "created": created, "skipped": skipped}


async def _worker_startup(_ctx: dict) -> None:
    # A standalone arq worker is a separate process from the FastAPI app, so
    # it needs to connect the shared client itself; when these jobs run
    # in-process (main.py's poller, the lead-creation callback) the app's
    # lifespan has already connected it.
    if not db.is_connected():
        await db.connect()


async def _worker_shutdown(_ctx: dict) -> None:
    if db.is_connected():
        await db.disconnect()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    on_startup = _worker_startup
    on_shutdown = _worker_shutdown
    functions = [
        generate_quotation_pdf_job,
        process_outbound_whatsapp,
        check_lead_call_needed,
        sync_meta_leads_job,
        sync_indiamart_leads_job,
    ]
