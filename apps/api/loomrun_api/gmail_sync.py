"""
Gmail inbox sync — polls Gmail History API per org, matches inbound emails to leads,
and creates LeadActivity records so emails appear in the lead timeline.
"""

import logging
import re
from datetime import datetime, timezone

import httpx

from loomrun_api.google_client import get_valid_org_token
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta

logger = logging.getLogger(__name__)

_GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
_MAX_TRACKED_IDS = 500  # cap on processed message IDs stored in credentials


def _extract_email(from_header: str) -> str | None:
    match = re.search(r"<([^>]+)>", from_header)
    if match:
        return match.group(1).strip().lower()
    if "@" in from_header:
        return from_header.strip().lower()
    return None


async def _get_profile_history_id(token: str, client: httpx.AsyncClient) -> str | None:
    resp = await client.get(
        f"{_GMAIL_BASE}/profile",
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code != 200:
        return None
    return str(resp.json().get("historyId", ""))


async def sync_org_gmail(org_id: str) -> int:
    """Sync inbox for one org. Returns number of new lead activities created."""
    try:
        token = await get_valid_org_token(org_id, "GMAIL")
    except ValueError as exc:
        logger.debug("Gmail sync skipped for org %s: %s", org_id, exc)
        return 0

    conn = await prisma.automationconnection.find_first(
        where={"organizationId": org_id, "serviceName": "GMAIL"}
    )
    if not conn:
        return 0

    creds: dict = conn.credentials if isinstance(conn.credentials, dict) else {}
    stored_history_id: str | None = creds.get("gmail_history_id")
    processed_ids: list[str] = creds.get("gmail_processed_ids", [])

    activities_created = 0

    async with httpx.AsyncClient(timeout=20.0) as client:
        # ── First sync: establish baseline cursor ──────────────────────────────
        if not stored_history_id:
            history_id = await _get_profile_history_id(token, client)
            if not history_id:
                return 0
            updated = {
                **creds,
                "gmail_history_id": history_id,
                "gmail_last_sync": datetime.now(timezone.utc).isoformat(),
            }
            await prisma.automationconnection.update(
                where={"id": conn.id},
                data={"credentials": json_meta(updated)},
            )
            logger.info("Gmail baseline set for org %s (historyId=%s)", org_id, history_id)
            return 0

        # ── Fetch history since last cursor ────────────────────────────────────
        history_resp = await client.get(
            f"{_GMAIL_BASE}/history",
            headers={"Authorization": f"Bearer {token}"},
            params={"startHistoryId": stored_history_id, "historyTypes": "messageAdded"},
        )

        if history_resp.status_code == 404:
            # historyId too old — reset baseline
            history_id = await _get_profile_history_id(token, client)
            if history_id:
                updated = {**creds, "gmail_history_id": history_id}
                await prisma.automationconnection.update(
                    where={"id": conn.id}, data={"credentials": json_meta(updated)}
                )
            return 0

        if history_resp.status_code != 200:
            logger.warning("Gmail history error org %s: %s", org_id, history_resp.text[:200])
            return 0

        history_data = history_resp.json()
        new_history_id = str(history_data.get("historyId", stored_history_id))
        histories = history_data.get("history", [])

        # Collect new INBOX message IDs (skip Sent)
        new_msg_ids: list[str] = []
        for h in histories:
            for added in h.get("messagesAdded", []):
                msg = added.get("message", {})
                if "INBOX" in msg.get("labelIds", []):
                    mid = msg["id"]
                    if mid not in processed_ids:
                        new_msg_ids.append(mid)

        # ── Process each new message ───────────────────────────────────────────
        for msg_id in new_msg_ids:
            detail_resp = await client.get(
                f"{_GMAIL_BASE}/messages/{msg_id}",
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "format": "metadata",
                    "metadataHeaders": ["From", "Subject", "Date"],
                },
            )
            if detail_resp.status_code != 200:
                continue

            data = detail_resp.json()
            hdrs = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}
            from_header = hdrs.get("From", "")
            subject = hdrs.get("Subject", "(no subject)")
            snippet = data.get("snippet", "")
            sender_email = _extract_email(from_header)

            if not sender_email:
                continue

            lead = await prisma.lead.find_first(
                where={"organizationId": org_id, "email": sender_email}
            )
            if not lead:
                continue

            await prisma.leadactivity.create(
                data={
                    "leadId": lead.id,
                    "type": "EMAIL",
                    "body": f"Email received — {subject}\n\n{snippet}",
                    "metadata": json_meta({
                        "direction": "inbound",
                        "from": from_header,
                        "subject": subject,
                        "snippet": snippet,
                        "gmail_message_id": msg_id,
                        "gmail_thread_id": data.get("threadId"),
                    }),
                }
            )
            activities_created += 1
            logger.info(
                "Email activity created: lead=%s subject=%r org=%s",
                lead.id, subject, org_id,
            )
            processed_ids.append(msg_id)

        # ── Persist updated cursor + processed IDs ─────────────────────────────
        updated_creds = {
            **creds,
            "gmail_history_id": new_history_id,
            "gmail_last_sync": datetime.now(timezone.utc).isoformat(),
            "gmail_processed_ids": processed_ids[-_MAX_TRACKED_IDS:],
        }
        await prisma.automationconnection.update(
            where={"id": conn.id},
            data={"credentials": json_meta(updated_creds)},
        )

    return activities_created


async def sync_all_gmail() -> None:
    """Run Gmail inbox sync for every org that has Gmail connected."""
    connections = await prisma.automationconnection.find_many(
        where={"serviceName": "GMAIL", "status": "connected"}
    )
    for conn in connections:
        try:
            count = await sync_org_gmail(conn.organizationId)
            if count:
                logger.info(
                    "Gmail sync: %d new activities for org %s", count, conn.organizationId
                )
        except Exception:
            logger.exception("Gmail sync failed for org %s", conn.organizationId)
