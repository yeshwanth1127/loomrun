"""
Gmail automation — reusable send/read helpers built on an org's connected
Gmail account (AutomationConnection serviceName="GMAIL").

Auth is handled by `get_valid_org_token`, which refreshes the access token
when needed. Callers only need the org id.
"""

import base64
import logging
import mimetypes
from dataclasses import dataclass, field
from email.message import EmailMessage

import httpx

from loomrun_api.google_client import get_valid_org_token

logger = logging.getLogger(__name__)

_GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


@dataclass
class Attachment:
    filename: str
    content: bytes
    mime_type: str | None = None


@dataclass
class SentEmail:
    message_id: str
    thread_id: str | None


@dataclass
class ReceivedEmail:
    message_id: str
    thread_id: str | None
    from_address: str
    to_address: str
    subject: str
    snippet: str
    body: str
    date: str
    label_ids: list[str] = field(default_factory=list)


def _b64url_decode(data: str) -> str:
    if not data:
        return ""
    padded = data + "=" * (-len(data) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode()).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _extract_body(payload: dict) -> str:
    """Pull the best-effort text body out of a Gmail message payload."""
    mime = payload.get("mimeType", "")
    body = payload.get("body", {})

    if mime == "text/plain" and body.get("data"):
        return _b64url_decode(body["data"])

    parts = payload.get("parts", [])
    if parts:
        # Prefer text/plain, fall back to text/html, then recurse.
        for part in parts:
            if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
                return _b64url_decode(part["body"]["data"])
        for part in parts:
            if part.get("mimeType") == "text/html" and part.get("body", {}).get("data"):
                return _b64url_decode(part["body"]["data"])
        for part in parts:
            nested = _extract_body(part)
            if nested:
                return nested

    if body.get("data"):
        return _b64url_decode(body["data"])
    return ""


async def send_email(
    org_id: str,
    *,
    to: str,
    subject: str,
    body: str,
    cc: str | None = None,
    bcc: str | None = None,
    html: bool = False,
    attachments: list[Attachment] | None = None,
    reply_to_message_id: str | None = None,
    thread_id: str | None = None,
) -> SentEmail:
    """Send an email from the org's connected Gmail account.

    Set `html=True` to send `body` as HTML. Pass `attachments` to include files.
    Pass `thread_id` (and optionally `reply_to_message_id` for In-Reply-To) to
    reply within an existing thread.
    """
    token = await get_valid_org_token(org_id, "GMAIL")

    message = EmailMessage()
    message["To"] = to
    message["Subject"] = subject
    if cc:
        message["Cc"] = cc
    if bcc:
        message["Bcc"] = bcc
    if reply_to_message_id:
        message["In-Reply-To"] = reply_to_message_id
        message["References"] = reply_to_message_id

    if html:
        message.set_content("This email requires an HTML-capable client.")
        message.add_alternative(body, subtype="html")
    else:
        message.set_content(body)

    for att in attachments or []:
        mime_type = att.mime_type or mimetypes.guess_type(att.filename)[0] or "application/octet-stream"
        maintype, _, subtype = mime_type.partition("/")
        message.add_attachment(
            att.content,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=att.filename,
        )

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    request_body: dict = {"raw": raw}
    if thread_id:
        request_body["threadId"] = thread_id

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{_GMAIL_BASE}/messages/send",
            headers={"Authorization": f"Bearer {token}"},
            json=request_body,
        )
        resp.raise_for_status()
        data = resp.json()

    sent = SentEmail(message_id=data.get("id", ""), thread_id=data.get("threadId"))
    logger.info("Gmail send org=%s to=%r subject=%r id=%s", org_id, to, subject, sent.message_id)
    return sent


async def read_emails(
    org_id: str,
    *,
    query: str | None = None,
    label_ids: list[str] | None = None,
    max_results: int = 20,
) -> list[ReceivedEmail]:
    """Read emails from the org's connected Gmail account.

    `query` accepts Gmail search syntax (e.g. "is:unread from:foo@bar.com").
    `label_ids` filters by label (defaults to INBOX).
    """
    token = await get_valid_org_token(org_id, "GMAIL")
    headers = {"Authorization": f"Bearer {token}"}

    list_params: dict = {"maxResults": max(1, min(max_results, 100))}
    if query:
        list_params["q"] = query
    list_params["labelIds"] = label_ids if label_ids is not None else ["INBOX"]

    emails: list[ReceivedEmail] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        list_resp = await client.get(
            f"{_GMAIL_BASE}/messages",
            headers=headers,
            params=list_params,
        )
        list_resp.raise_for_status()
        message_refs = list_resp.json().get("messages", [])

        for ref in message_refs:
            msg_id = ref.get("id")
            if not msg_id:
                continue
            detail_resp = await client.get(
                f"{_GMAIL_BASE}/messages/{msg_id}",
                headers=headers,
                params={"format": "full"},
            )
            if detail_resp.status_code != 200:
                logger.warning("Gmail read failed org=%s msg=%s: %s", org_id, msg_id, detail_resp.text[:200])
                continue

            data = detail_resp.json()
            payload = data.get("payload", {})
            hdrs = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}

            emails.append(
                ReceivedEmail(
                    message_id=msg_id,
                    thread_id=data.get("threadId"),
                    from_address=hdrs.get("from", ""),
                    to_address=hdrs.get("to", ""),
                    subject=hdrs.get("subject", "(no subject)"),
                    snippet=data.get("snippet", ""),
                    body=_extract_body(payload),
                    date=hdrs.get("date", ""),
                    label_ids=data.get("labelIds", []),
                )
            )

    logger.info("Gmail read org=%s query=%r returned=%d", org_id, query, len(emails))
    return emails


async def get_email(org_id: str, message_id: str) -> ReceivedEmail | None:
    """Fetch a single message (with full body) by its Gmail message id."""
    token = await get_valid_org_token(org_id, "GMAIL")
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            f"{_GMAIL_BASE}/messages/{message_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"format": "full"},
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()

    payload = data.get("payload", {})
    hdrs = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    return ReceivedEmail(
        message_id=message_id,
        thread_id=data.get("threadId"),
        from_address=hdrs.get("from", ""),
        to_address=hdrs.get("to", ""),
        subject=hdrs.get("subject", "(no subject)"),
        snippet=data.get("snippet", ""),
        body=_extract_body(payload),
        date=hdrs.get("date", ""),
        label_ids=data.get("labelIds", []),
    )
