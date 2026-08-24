from fastmcp import FastMCP

from exora_mcp_server.db import get_org_tokens
from exora_mcp_server.tools.calendar import calendar_create_event, calendar_list_events
from exora_mcp_server.tools.gmail import gmail_read, gmail_send

mcp = FastMCP(
    "exora_mcp_server",
    instructions=(
        "Exora MCP Server — Gmail and Google Calendar tools for Loomrun organisations. "
        "Every tool requires `org_id` (the Loomrun organisation ID). "
        "Tokens are fetched from the DB and auto-refreshed; no credentials need to be passed in tool calls. "
        "Use `get_google_connection_status` to confirm a service is connected before calling its tools."
    ),
)


# ── Gmail ──────────────────────────────────────────────────────────────────────

@mcp.tool()
async def tool_gmail_send(
    org_id: str,
    to: str,
    subject: str,
    body: str,
    html_body: str = "",
) -> dict:
    """
    Send an email from the org's connected Gmail account.

    Args:
        org_id:    Loomrun organisation ID.
        to:        Recipient email address.
        subject:   Email subject line.
        body:      Plain-text body.
        html_body: Optional HTML body (falls back to plain text if omitted).
    """
    return await gmail_send(org_id, to, subject, body, html_body or None)


@mcp.tool()
async def tool_gmail_read(
    org_id: str,
    query: str = "in:inbox",
    max_results: int = 10,
) -> list:
    """
    Read emails from the org's connected Gmail inbox.

    Args:
        org_id:      Loomrun organisation ID.
        query:       Gmail search query (default: 'in:inbox'). Supports full Gmail syntax,
                     e.g. 'from:buyer@example.com subject:quotation'.
        max_results: Maximum number of messages to return (max 50).
    """
    return await gmail_read(org_id, query, max_results)


# ── Google Calendar ────────────────────────────────────────────────────────────

@mcp.tool()
async def tool_calendar_create_event(
    org_id: str,
    title: str,
    start_time: str,
    end_time: str,
    description: str = "",
    attendees: list[str] = [],
    location: str = "",
    timezone: str = "Asia/Kolkata",
) -> dict:
    """
    Create a Google Calendar event for the org's connected account.

    Args:
        org_id:      Loomrun organisation ID.
        title:       Event title / summary.
        start_time:  ISO 8601 datetime string, e.g. '2026-06-15T10:00:00+05:30'.
        end_time:    ISO 8601 datetime string, e.g. '2026-06-15T11:00:00+05:30'.
        description: Optional event description.
        attendees:   Optional list of attendee email addresses (invites are sent automatically).
        location:    Optional location string.
        timezone:    IANA timezone name (default 'Asia/Kolkata').
    """
    return await calendar_create_event(
        org_id, title, start_time, end_time, description, attendees or None, location, timezone
    )


@mcp.tool()
async def tool_calendar_list_events(
    org_id: str,
    days_ahead: int = 7,
    max_results: int = 20,
) -> list:
    """
    List upcoming Google Calendar events for the org's connected account.

    Args:
        org_id:      Loomrun organisation ID.
        days_ahead:  How many days ahead to look (default 7).
        max_results: Maximum events to return (max 100).
    """
    return await calendar_list_events(org_id, days_ahead, max_results)


# ── Gmail Inbox Sync ───────────────────────────────────────────────────────────

@mcp.tool()
async def tool_gmail_get_message(org_id: str, message_id: str) -> dict:
    """
    Fetch the full body of a specific Gmail message.

    Args:
        org_id:     Loomrun organisation ID.
        message_id: Gmail message ID (from tool_gmail_read results).
    """
    from exora_mcp_server.token_manager import get_valid_access_token
    import httpx

    token = await get_valid_access_token(org_id, "GMAIL")
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"format": "full"},
        )
        resp.raise_for_status()
        data = resp.json()

    hdrs = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}

    def _get_body(payload: dict) -> str:
        import base64
        parts = payload.get("parts", [])
        if parts:
            for part in parts:
                if part.get("mimeType") == "text/plain":
                    body_data = part.get("body", {}).get("data", "")
                    if body_data:
                        return base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")
        body_data = payload.get("body", {}).get("data", "")
        if body_data:
            return base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")
        return data.get("snippet", "")

    return {
        "id": data["id"],
        "thread_id": data.get("threadId"),
        "from": hdrs.get("From"),
        "to": hdrs.get("To"),
        "subject": hdrs.get("Subject"),
        "date": hdrs.get("Date"),
        "body": _get_body(data.get("payload", {})),
        "snippet": data.get("snippet"),
    }


# ── Status ─────────────────────────────────────────────────────────────────────

@mcp.tool()
async def tool_get_google_connection_status(org_id: str, service_name: str) -> dict:
    """
    Check whether an org has an active Google service connection.

    Args:
        org_id:       Loomrun organisation ID.
        service_name: 'GMAIL' or 'GOOGLE_CALENDAR'.
    """
    if service_name not in ("GMAIL", "GOOGLE_CALENDAR"):
        return {"connected": False, "error": "service_name must be 'GMAIL' or 'GOOGLE_CALENDAR'"}

    creds = await get_org_tokens(org_id, service_name)
    if not creds:
        return {"connected": False, "service": service_name, "org_id": org_id}

    return {
        "connected": True,
        "service": service_name,
        "org_id": org_id,
        "expires_at": creds.get("expires_at"),
        "scopes": creds.get("scopes", []),
    }
