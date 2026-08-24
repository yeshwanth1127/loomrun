import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from exora_mcp_server.token_manager import get_valid_access_token

_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


def _build_raw_message(to: str, subject: str, body: str, html_body: str | None) -> str:
    if html_body:
        msg: MIMEMultipart | MIMEText = MIMEMultipart("alternative")
        msg["to"] = to
        msg["subject"] = subject
        msg.attach(MIMEText(body, "plain"))
        msg.attach(MIMEText(html_body, "html"))
    else:
        msg = MIMEText(body, "plain")
        msg["to"] = to
        msg["subject"] = subject
    return base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")


async def gmail_send(
    org_id: str,
    to: str,
    subject: str,
    body: str,
    html_body: str | None = None,
) -> dict:
    token = await get_valid_access_token(org_id, "GMAIL")
    raw = _build_raw_message(to, subject, body, html_body)

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{_BASE}/messages/send",
            headers={"Authorization": f"Bearer {token}"},
            json={"raw": raw},
        )
        resp.raise_for_status()
        data = resp.json()

    return {"status": "sent", "message_id": data.get("id"), "thread_id": data.get("threadId")}


async def gmail_read(
    org_id: str,
    query: str = "in:inbox",
    max_results: int = 10,
) -> list[dict]:
    token = await get_valid_access_token(org_id, "GMAIL")

    async with httpx.AsyncClient() as client:
        list_resp = await client.get(
            f"{_BASE}/messages",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": query, "maxResults": min(max_results, 50)},
        )
        list_resp.raise_for_status()
        messages = list_resp.json().get("messages", [])

        results: list[dict] = []
        for msg in messages:
            detail_resp = await client.get(
                f"{_BASE}/messages/{msg['id']}",
                headers={"Authorization": f"Bearer {token}"},
                params={"format": "metadata", "metadataHeaders": ["From", "To", "Subject", "Date"]},
            )
            if detail_resp.status_code != 200:
                continue
            data = detail_resp.json()
            headers = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}
            results.append({
                "id": data["id"],
                "thread_id": data.get("threadId"),
                "from": headers.get("From"),
                "to": headers.get("To"),
                "subject": headers.get("Subject"),
                "date": headers.get("Date"),
                "snippet": data.get("snippet"),
                "label_ids": data.get("labelIds", []),
            })

    return results
