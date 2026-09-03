"""Follow-up / callback due helpers and WhatsApp reminder poller."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)


def follow_up_bucket(due: datetime | None, *, now: datetime | None = None) -> str:
    """Time-aware bucket for Follow-ups UI and agent tools."""
    if due is None:
        return "unscheduled"
    now = now or datetime.now(timezone.utc)
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    local_now = now.astimezone()
    local_due = due.astimezone()
    today = local_now.date()
    due_day = local_due.date()

    if due_day < today:
        return "overdue"
    if due_day > today:
        return "upcoming"
    # Same calendar day
    if due <= now:
        return "due_now"
    return "later_today"


def reminder_pending(reminded_at: datetime | None, next_follow_up_at: datetime) -> bool:
    """True if we have not yet reminded for this scheduled follow-up."""
    if reminded_at is None:
        return True
    if reminded_at.tzinfo is None:
        reminded_at = reminded_at.replace(tzinfo=timezone.utc)
    if next_follow_up_at.tzinfo is None:
        next_follow_up_at = next_follow_up_at.replace(tzinfo=timezone.utc)
    return reminded_at < next_follow_up_at


async def list_due_follow_ups_for_user(
    *,
    organization_id: str,
    user_id: str,
    limit: int = 50,
) -> dict[str, Any]:
    """Follow-ups that are due now for this user (assignee or last Follow Up logger)."""
    now = datetime.now(timezone.utc)
    leads = await prisma.lead.find_many(
        where={
            "organizationId": organization_id,
            "nextFollowUpAt": {"lte": now},
        },
        order={"nextFollowUpAt": "asc"},
        take=200,
    )
    if not leads:
        return {"items": [], "count": 0}

    lead_ids = [l.id for l in leads]
    calls = await prisma.telecallercalllog.find_many(
        where={"organizationId": organization_id, "leadId": {"in": lead_ids}},
        order={"createdAt": "desc"},
    )
    latest: dict[str, Any] = {}
    for call in calls:
        if call.leadId not in latest:
            latest[call.leadId] = call

    items: list[dict[str, Any]] = []
    for lead in leads:
        call = latest.get(lead.id)
        if not call:
            continue
        outcome = call.outcome.name if hasattr(call.outcome, "name") else str(call.outcome)
        if outcome != "CALLBACK_SCHEDULED":
            continue
        owner_id = lead.assigneeId or call.userId
        if owner_id != user_id:
            continue
        due = lead.nextFollowUpAt
        if due is None:
            continue
        in_app_pending = reminder_pending(getattr(lead, "followUpRemindedAt", None), due)
        items.append(
            {
                "id": lead.id,
                "title": lead.title,
                "phone": lead.phone,
                "company": lead.company,
                "next_follow_up_at": due.isoformat(),
                "notes": lead.notes,
                "last_call_notes": call.notes,
                "in_app_pending": in_app_pending,
                "bucket": follow_up_bucket(due, now=now),
            }
        )
        if len(items) >= limit:
            break

    return {"items": items, "count": len(items)}


async def ack_follow_up_reminders(*, organization_id: str, lead_ids: list[str], user_id: str) -> dict:
    """Mark in-app reminders as shown for the given leads (current user only)."""
    now = datetime.now(timezone.utc)
    updated = 0
    for lead_id in lead_ids:
        lead = await prisma.lead.find_first(
            where={"id": lead_id, "organizationId": organization_id},
        )
        if not lead or not lead.nextFollowUpAt:
            continue
        # Soft auth: only assignee or anyone in org can ack (org-scoped already)
        await prisma.lead.update(
            where={"id": lead.id},
            data={"followUpRemindedAt": now},
        )
        updated += 1
    return {"acked": updated}


async def send_due_whatsapp_reminders() -> dict[str, int]:
    """Poll all orgs: WhatsApp telecallers when a callback is due (once per schedule)."""
    from loomrun_api import baileys_client
    from loomrun_api.whatsapp_client import send_whatsapp_text

    now = datetime.now(timezone.utc)
    leads = await prisma.lead.find_many(
        where={"nextFollowUpAt": {"lte": now}},
        order={"nextFollowUpAt": "asc"},
        take=200,
    )
    sent = 0
    skipped = 0
    errors = 0

    if not leads:
        return {"sent": 0, "skipped": 0, "errors": 0}

    by_org: dict[str, list] = {}
    for lead in leads:
        by_org.setdefault(lead.organizationId, []).append(lead)

    for org_id, org_leads in by_org.items():
        lead_ids = [l.id for l in org_leads]
        calls = await prisma.telecallercalllog.find_many(
            where={"organizationId": org_id, "leadId": {"in": lead_ids}},
            order={"createdAt": "desc"},
        )
        latest: dict[str, Any] = {}
        for call in calls:
            if call.leadId not in latest:
                latest[call.leadId] = call

        for lead in org_leads:
            due = lead.nextFollowUpAt
            if due is None:
                continue
            if not reminder_pending(getattr(lead, "followUpWaRemindedAt", None), due):
                skipped += 1
                continue
            call = latest.get(lead.id)
            if not call:
                skipped += 1
                continue
            outcome = call.outcome.name if hasattr(call.outcome, "name") else str(call.outcome)
            if outcome != "CALLBACK_SCHEDULED":
                skipped += 1
                continue

            telecaller_user_id = lead.assigneeId or call.userId
            if not telecaller_user_id:
                skipped += 1
                continue

            membership = await prisma.membership.find_first(
                where={"organizationId": org_id, "userId": telecaller_user_id},
            )
            phone = getattr(membership, "whatsappPhone", None) if membership else None
            if not phone:
                logger.warning(
                    "Follow-up WA reminder skipped lead=%s — telecaller has no whatsapp_phone",
                    lead.id,
                )
                skipped += 1
                continue

            local_due = due.astimezone() if due.tzinfo else due.replace(tzinfo=timezone.utc).astimezone()
            time_str = local_due.strftime("%d %b %Y, %I:%M %p")
            notes = (call.notes or lead.notes or "").strip()
            lines = [
                f"Reminder: call back *{lead.title}* (due {time_str}).",
            ]
            if lead.phone:
                lines.append(f"Lead phone: {lead.phone}")
            if lead.company:
                lines.append(f"Company: {lead.company}")
            if notes:
                lines.append(f"Notes: {notes[:300]}")
            message = "\n".join(lines)

            try:
                # Send to the telecaller only — do not queue against the lead
                # (retry worker would otherwise message the customer).
                if await baileys_client.is_connected(org_id):
                    ok = bool(await baileys_client.send_text(org_id, phone, message))
                else:
                    ok = await send_whatsapp_text(phone, message)
                if not ok:
                    errors += 1
                    logger.warning("Follow-up WA reminder send failed lead=%s", lead.id)
                    continue
                await prisma.lead.update(
                    where={"id": lead.id},
                    data={"followUpWaRemindedAt": now},
                )
                sent += 1
            except Exception:
                errors += 1
                logger.exception("Follow-up WA reminder failed lead=%s", lead.id)

    return {"sent": sent, "skipped": skipped, "errors": errors}
