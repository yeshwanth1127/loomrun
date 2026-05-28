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


async def sync_meta_leads_job(_ctx: dict, org_id: str) -> dict:
    from datetime import datetime, timezone
    from loomrun_api.meta_client import (
        fetch_lead_forms, fetch_leads_from_form, map_lead_fields, parse_field_data
    )
    from loomrun_api.prisma_json import json_meta
    from prisma.enums import LeadActivityType, LeadSource

    db = Prisma()
    await db.connect()
    created = 0
    skipped = 0
    try:
        connection = await db.leadconnection.find_first(
            where={"organizationId": org_id, "sourceName": "META_ADS", "status": "connected"}
        )
        if not connection:
            return {"status": "no_connection"}

        creds = connection.credentials or {}
        pages = creds.get("pages", [])

        for page in pages:
            page_id = page.get("page_id")
            page_token = page.get("page_access_token")
            if not page_id or not page_token:
                continue

            try:
                forms = await fetch_lead_forms(page_id, page_token)
            except Exception as exc:
                logger.warning("Could not fetch forms for page %s: %s", page_id, exc)
                continue

            for form in forms:
                form_id = form["id"]
                form_name = form.get("name")
                try:
                    leads = await fetch_leads_from_form(form_id, page_token)
                except Exception as exc:
                    logger.warning("Could not fetch leads for form %s: %s", form_id, exc)
                    continue

                for lead_data in leads:
                    leadgen_id = lead_data.get("id")
                    if not leadgen_id:
                        continue

                    existing = await db.lead.find_first(
                        where={"organizationId": org_id, "metaLeadgenId": leadgen_id}
                    )
                    if existing:
                        skipped += 1
                        continue

                    flat = parse_field_data(lead_data.get("field_data", []))
                    mapped = map_lead_fields(flat)

                    campaign_id = lead_data.get("campaign_id")
                    campaign_name = lead_data.get("campaign_name")
                    adset_id = lead_data.get("adset_id")
                    adset_name = lead_data.get("adset_name")
                    ad_id = lead_data.get("ad_id")
                    ad_name = lead_data.get("ad_name")

                    score = 30
                    if mapped.get("phone") and mapped.get("email"):
                        score += 15
                    elif mapped.get("phone") or mapped.get("email"):
                        score += 8
                    if mapped.get("product_interest"):
                        score += 10
                    if mapped.get("city"):
                        score += 5
                    score = min(score, 100)

                    source_parts = []
                    if campaign_name:
                        source_parts.append(f"campaign:{campaign_name}")
                    if ad_name:
                        source_parts.append(f"ad:{ad_name}")

                    lead = await db.lead.create(
                        data={
                            "organizationId": org_id,
                            "title": mapped["title"],
                            "source": LeadSource.META_ADS,
                            "phone": mapped.get("phone"),
                            "email": mapped.get("email"),
                            "city": mapped.get("city"),
                            "company": mapped.get("company"),
                            "productInterest": mapped.get("product_interest"),
                            "quantityEstimate": mapped.get("quantity_estimate"),
                            "leadScore": score,
                            "sourceDetail": ", ".join(source_parts) if source_parts else None,
                            "tags": [],
                            "lastActivityAt": datetime.now(timezone.utc),
                            "metaLeadgenId": leadgen_id,
                            "metaPageId": page_id,
                            "metaFormId": str(form_id),
                            "metaAdId": str(ad_id) if ad_id else None,
                            "metaAdsetId": str(adset_id) if adset_id else None,
                            "metaCampaignId": str(campaign_id) if campaign_id else None,
                            "metaCampaignName": campaign_name,
                            "metaAdsetName": adset_name,
                            "metaAdName": ad_name,
                            "metaFormName": form_name,
                        }
                    )
                    await db.leadactivity.create(
                        data={
                            "leadId": lead.id,
                            "type": LeadActivityType.SYSTEM,
                            "body": f"Lead imported from Meta Ads history{f' · {campaign_name}' if campaign_name else ''}",
                            "metadata": json_meta({"leadgen_id": leadgen_id, "form_id": form_id, "campaign_id": campaign_id}),
                        }
                    )
                    created += 1

        await db.leadconnection.update_many(
            where={"organizationId": org_id, "sourceName": "META_ADS"},
            data={"leadsCount": {"increment": created}, "lastSync": datetime.now(timezone.utc)},
        )
        logger.info("Meta sync org=%s created=%d skipped=%d", org_id, created, skipped)
        return {"status": "done", "created": created, "skipped": skipped}
    finally:
        await db.disconnect()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions = [generate_quotation_pdf_job, process_outbound_whatsapp, check_lead_call_needed, sync_meta_leads_job]
