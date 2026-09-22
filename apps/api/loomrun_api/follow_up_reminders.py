"""Follow-up / callback due helpers and WhatsApp reminder poller."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)

# In-app advance reminders: one toast per window before the scheduled call.
IN_APP_REMINDER_OFFSETS_MINUTES: tuple[int, ...] = (60, 30, 5)


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


def active_reminder_offset(
    due: datetime,
    *,
    now: datetime | None = None,
    acked_offsets: list[int] | None = None,
    offsets: tuple[int, ...] = IN_APP_REMINDER_OFFSETS_MINUTES,
) -> int | None:
    """Return the advance offset (minutes) that should notify now, if any.

    Uses exclusive descending windows so a short schedule (e.g. 20 min out)
    only fires the applicable nearer reminders, never a late "1 hour" toast.
    """
    now = now or datetime.now(timezone.utc)
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    remaining_minutes = (due - now).total_seconds() / 60.0
    if remaining_minutes <= 0:
        return None

    acked = set(acked_offsets or [])
    for i, offset in enumerate(offsets):
        next_smaller = offsets[i + 1] if i + 1 < len(offsets) else 0
        if next_smaller < remaining_minutes <= offset:
            if offset in acked:
                return None
            return offset
    return None


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _owned_callback_leads(
    *,
    organization_id: str,
    user_id: str,
    leads: list[Any],
) -> list[tuple[Any, Any]]:
    """Filter to CALLBACK_SCHEDULED leads owned by this user (assignee or last logger)."""
    if not leads:
        return []
    lead_ids = [l.id for l in leads]
    calls = await prisma.telecallercalllog.find_many(
        where={"organizationId": organization_id, "leadId": {"in": lead_ids}},
        order={"createdAt": "desc"},
    )
    latest: dict[str, Any] = {}
    for call in calls:
        if call.leadId not in latest:
            latest[call.leadId] = call

    owned: list[tuple[Any, Any]] = []
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
        if lead.nextFollowUpAt is None:
            continue
        owned.append((lead, call))
    return owned


async def list_due_follow_ups_for_user(
    *,
    organization_id: str,
    user_id: str,
    limit: int = 50,
) -> dict[str, Any]:
    """Due follow-ups (badge) plus pending advance in-app reminders (toasts)."""
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(minutes=max(IN_APP_REMINDER_OFFSETS_MINUTES))

    leads = await prisma.lead.find_many(
        where={
            "organizationId": organization_id,
            "nextFollowUpAt": {"lte": horizon},
        },
        order={"nextFollowUpAt": "asc"},
        take=200,
    )
    owned = await _owned_callback_leads(
        organization_id=organization_id,
        user_id=user_id,
        leads=leads,
    )

    due_items: list[dict[str, Any]] = []
    reminder_items: list[dict[str, Any]] = []

    for lead, call in owned:
        due = _ensure_utc(lead.nextFollowUpAt)
        acked = list(getattr(lead, "followUpRemindedOffsets", None) or [])
        base = {
            "id": lead.id,
            "title": lead.title,
            "phone": lead.phone,
            "company": lead.company,
            "next_follow_up_at": due.isoformat(),
            "notes": lead.notes,
            "last_call_notes": call.notes,
            "bucket": follow_up_bucket(due, now=now),
        }

        if due <= now:
            due_items.append(base)
        else:
            offset = active_reminder_offset(due, now=now, acked_offsets=acked)
            if offset is not None:
                reminder_items.append(
                    {
                        **base,
                        "offset_minutes": offset,
                        "in_app_pending": True,
                    }
                )

        if len(due_items) + len(reminder_items) >= limit * 2:
            break

    return {
        "items": due_items[:limit],
        "count": len(due_items[:limit]),
        "reminders": reminder_items[:limit],
    }


async def ack_follow_up_reminders(
    *,
    organization_id: str,
    user_id: str,
    lead_ids: list[str] | None = None,
    reminders: list[dict[str, Any]] | None = None,
) -> dict:
    """Mark advance reminder offsets (and legacy due acks) as shown."""
    now = datetime.now(timezone.utc)
    updated = 0

    # New shape: [{ lead_id, offset_minutes }]
    for rem in reminders or []:
        lead_id = rem.get("lead_id") or rem.get("id")
        offset = rem.get("offset_minutes")
        if not lead_id or offset is None:
            continue
        try:
            offset_int = int(offset)
        except (TypeError, ValueError):
            continue
        if offset_int not in IN_APP_REMINDER_OFFSETS_MINUTES:
            continue
        lead = await prisma.lead.find_first(
            where={"id": str(lead_id), "organizationId": organization_id},
        )
        if not lead or not lead.nextFollowUpAt:
            continue
        existing = list(getattr(lead, "followUpRemindedOffsets", None) or [])
        if offset_int in existing:
            continue
        existing.append(offset_int)
        await prisma.lead.update(
            where={"id": lead.id},
            data={
                "followUpRemindedOffsets": existing,
                "followUpRemindedAt": now,
            },
        )
        updated += 1

    # Legacy: mark whole schedule reminded (due-now ack)
    for lead_id in lead_ids or []:
        lead = await prisma.lead.find_first(
            where={"id": lead_id, "organizationId": organization_id},
        )
        if not lead or not lead.nextFollowUpAt:
            continue
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
