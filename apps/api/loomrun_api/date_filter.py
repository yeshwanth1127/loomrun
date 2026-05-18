from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status


def parse_day_param(day: str | None) -> tuple[datetime, datetime] | None:
    """Return UTC [start, end) for a calendar day, or None when day is omitted or 'all'."""
    if not day or day.strip().lower() == "all":
        return None
    try:
        start = datetime.strptime(day.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Invalid day format; use YYYY-MM-DD or all",
        ) from e
    return start, start + timedelta(days=1)


def apply_created_at(where: dict, day: str | None) -> dict:
    rng = parse_day_param(day)
    if rng:
        where["createdAt"] = {"gte": rng[0], "lt": rng[1]}
    return where


def apply_recorded_at(where: dict, day: str | None) -> dict:
    rng = parse_day_param(day)
    if rng:
        where["recordedAt"] = {"gte": rng[0], "lt": rng[1]}
    return where


def day_label(day: str | None) -> str:
    rng = parse_day_param(day)
    return rng[0].date().isoformat() if rng else "all"
