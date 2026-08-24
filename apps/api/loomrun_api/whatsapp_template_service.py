"""Automatic WhatsApp greeting for newly-created leads.

When a brand-new lead is created (from any source), `greet_new_lead` builds a
message from the org's GREETING template and sends it over WhatsApp — the same
Baileys-then-Meta path the composer uses. Controlled per-org by
`Organization.autoGreetNewLeads` and guarded so a lead is greeted at most once.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta
from loomrun_api.whatsapp_template_defaults import backfill_org_whatsapp_templates
from prisma.enums import (
    LeadActivityType,
    OutboundChannel,
    OutboundMessageStatus,
    WhatsAppTemplateCategory,
)

logger = logging.getLogger(__name__)

# Only greet leads that were just created. This is a safety net so a bulk
# import or any re-run can never message a lead that already existed — the
# greeting is for genuinely new, real-time leads only.
GREETING_MAX_LEAD_AGE = timedelta(minutes=10)


def apply_template_vars(body: str, lead_title: str | None, lead_company: str | None, org_name: str | None) -> str:
    """Server-side equivalent of the web `applyVars`: fill {name}, {company}, {org}."""
    name = lead_title or "there"
    return (
        body.replace("{name}", name)
        .replace("{company}", lead_company or name)
        .replace("{org}", org_name or "our team")
    )


async def _already_greeted(db, lead_id: str) -> bool:
    rows = await db.outboundmessage.find_many(
        where={"leadId": lead_id, "channel": OutboundChannel.WHATSAPP},
    )
    return any(isinstance(r.payload, dict) and r.payload.get("kind") == "greeting" for r in rows)


async def greet_new_lead(db, org_id: str, lead_id: str) -> bool:
    """Send the org's greeting to a new lead. Returns True if a message was sent.

    `db` is whichever connected Prisma client the caller holds (the shared global
    in the API process, or a job-local client inside ARQ workers). Best-effort:
    never raises — failures are logged and, when possible, left QUEUED for retry.
    """
    try:
        lead = await db.lead.find_first(where={"id": lead_id, "organizationId": org_id})
        if not lead or not lead.phone:
            return False

        # Skip anything that isn't a freshly-created lead (no greeting for
        # already-synced / historical leads).
        created_at = lead.createdAt
        if created_at is not None:
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - created_at > GREETING_MAX_LEAD_AGE:
                return False

        org = await db.organization.find_unique(where={"id": org_id})
        if not org or not org.autoGreetNewLeads:
            return False

        if await _already_greeted(db, lead_id):
            return False

        tmpl = await db.whatsapptemplate.find_first(
            where={"organizationId": org_id, "category": WhatsAppTemplateCategory.GREETING}
        )
        if not tmpl:
            await backfill_org_whatsapp_templates(db, org_id)
            tmpl = await db.whatsapptemplate.find_first(
                where={"organizationId": org_id, "category": WhatsAppTemplateCategory.GREETING}
            )
        if not tmpl:
            return False

        message = apply_template_vars(tmpl.body, lead.title, lead.company, org.name)

        # Deliver now via the org's Baileys session if connected, else Meta Cloud API.
        from loomrun_api import baileys_client
        from loomrun_api.whatsapp_client import send_whatsapp_text

        if await baileys_client.is_connected(org_id):
            sent = await baileys_client.send_text(org_id, lead.phone, message)
        else:
            sent = await send_whatsapp_text(lead.phone, message)

        await db.outboundmessage.create(
            data={
                "organizationId": org_id,
                "leadId": lead_id,
                "channel": OutboundChannel.WHATSAPP,
                "payload": json_meta({"text": message, "kind": "greeting"}),
                "status": OutboundMessageStatus.SENT if sent else OutboundMessageStatus.QUEUED,
                "attempts": 1 if sent else 0,
                "lastError": None if sent else "Immediate greeting send failed — queued for retry",
            }
        )
        await db.leadactivity.create(
            data={
                "leadId": lead_id,
                "type": LeadActivityType.WHATSAPP,
                "body": "Automatic greeting sent",
            }
        )
        return sent
    except Exception:
        logger.exception("greet_new_lead failed org=%s lead=%s", org_id, lead_id)
        return False


def schedule_greeting(org_id: str, lead_id: str) -> None:
    """Fire-and-forget greeting from a request/webhook handler (uses shared `prisma`)."""
    asyncio.create_task(greet_new_lead(prisma, org_id, lead_id))
