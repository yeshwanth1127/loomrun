from datetime import datetime, timedelta, timezone

import httpx

from exora_mcp_server.token_manager import get_valid_access_token

_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


async def calendar_create_event(
    org_id: str,
    title: str,
    start_time: str,
    end_time: str,
    description: str = "",
    attendees: list[str] | None = None,
    location: str = "",
    tz: str = "Asia/Kolkata",
) -> dict:
    token = await get_valid_access_token(org_id, "GOOGLE_CALENDAR")

    event: dict = {
        "summary": title,
        "description": description,
        "location": location,
        "start": {"dateTime": start_time, "timeZone": tz},
        "end": {"dateTime": end_time, "timeZone": tz},
    }
    if attendees:
        event["attendees"] = [{"email": a} for a in attendees]

    params = {"sendUpdates": "all"} if attendees else {}

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _CALENDAR_BASE,
            headers={"Authorization": f"Bearer {token}"},
            json=event,
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "event_id": data["id"],
        "title": data.get("summary"),
        "start": data.get("start"),
        "end": data.get("end"),
        "attendees": [a.get("email") for a in data.get("attendees", [])],
        "meet_link": data.get("hangoutLink"),
        "html_link": data.get("htmlLink"),
    }


async def calendar_list_events(
    org_id: str,
    days_ahead: int = 7,
    max_results: int = 20,
) -> list[dict]:
    token = await get_valid_access_token(org_id, "GOOGLE_CALENDAR")

    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(days=days_ahead)).isoformat()

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            _CALENDAR_BASE,
            headers={"Authorization": f"Bearer {token}"},
            params={
                "timeMin": time_min,
                "timeMax": time_max,
                "maxResults": min(max_results, 100),
                "singleEvents": "true",
                "orderBy": "startTime",
            },
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])

    return [
        {
            "event_id": item["id"],
            "title": item.get("summary"),
            "start": item.get("start"),
            "end": item.get("end"),
            "description": item.get("description"),
            "location": item.get("location"),
            "attendees": [a.get("email") for a in item.get("attendees", [])],
            "meet_link": item.get("hangoutLink"),
            "html_link": item.get("htmlLink"),
        }
        for item in items
    ]
