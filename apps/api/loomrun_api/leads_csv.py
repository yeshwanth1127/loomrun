"""Flexible lead CSV parsing — arbitrary headers via alias matching."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from loomrun_api.catalog_csv import normalize_header, parse_price, read_csv_table
from prisma.enums import LeadSource, LeadStage

FIELD_ALIASES: dict[str, list[str]] = {
    "title": [
        "title",
        "name",
        "lead_name",
        "contact",
        "contact_name",
        "customer",
        "customer_name",
        "full_name",
        "person",
        "lead",
        "client",
        "client_name",
    ],
    "company": [
        "company",
        "company_name",
        "organisation",
        "organization",
        "org",
        "firm",
        "business",
        "account",
        "account_name",
    ],
    "phone": [
        "phone",
        "phone_number",
        "mobile",
        "mobile_number",
        "whatsapp",
        "whatsapp_number",
        "contact_number",
        "cell",
        "tel",
        "telephone",
    ],
    "email": [
        "email",
        "email_address",
        "e_mail",
        "mail",
    ],
    "city": [
        "city",
        "location",
        "town",
        "place",
        "area",
    ],
    "source": [
        "source",
        "lead_source",
        "origin",
        "channel",
    ],
    "stage": [
        "stage",
        "pipeline",
        "pipeline_stage",
        "status",
        "lead_stage",
    ],
    "product_interest": [
        "product_interest",
        "product",
        "requirement",
        "interest",
        "item",
        "enquiry",
        "inquiry",
    ],
    "quantity_estimate": [
        "quantity_estimate",
        "quantity",
        "qty",
        "volume",
        "pcs",
        "pieces",
    ],
    "notes": [
        "notes",
        "note",
        "remarks",
        "comment",
        "comments",
        "details",
        "description",
    ],
    "estimated_value": [
        "estimated_value",
        "value",
        "est_value",
        "deal_value",
        "amount",
        "budget",
        "potential",
    ],
    "tags": [
        "tags",
        "tag",
        "labels",
        "label",
    ],
    "created_at": [
        "created_at",
        "created",
        "date",
        "lead_date",
        "enquiry_date",
        "inquiry_date",
        "added_on",
    ],
}

SOURCE_ALIASES: dict[str, str] = {
    "meta": "META_ADS",
    "meta_ads": "META_ADS",
    "facebook": "META_ADS",
    "fb": "META_ADS",
    "instagram": "INSTAGRAM",
    "ig": "INSTAGRAM",
    "google": "GOOGLE_ADS",
    "google_ads": "GOOGLE_ADS",
    "indiamart": "INDIAMART",
    "india_mart": "INDIAMART",
    "whatsapp": "WHATSAPP",
    "wa": "WHATSAPP",
    "website": "WEBSITE",
    "web": "WEB",
    "manual": "MANUAL",
    "referral": "REFERRAL",
    "telecaller": "TELECALLER",
    "excel": "OTHER",
    "csv": "OTHER",
    "import": "OTHER",
    "other": "OTHER",
}

STAGE_ALIASES: dict[str, str] = {
    "new": "NEW",
    "fresh": "NEW",
    "open": "NEW",
    "contacted": "CONTACTED",
    "called": "CONTACTED",
    "qualification": "QUALIFICATION",
    "qualified": "QUALIFICATION",
    "requirement": "QUALIFICATION",
    "requirement_collected": "QUALIFICATION",
    "quotation": "QUOTATION",
    "quoted": "QUOTATION",
    "quote": "QUOTATION",
    "negotiation": "NEGOTIATION",
    "negotiating": "NEGOTIATION",
    "sample": "SAMPLE",
    "sample_sent": "SAMPLE",
    "won": "WON",
    "closed": "WON",
    "closed_won": "WON",
    "converted": "WON",
    "lost": "LOST",
    "closed_lost": "LOST",
    "dropped": "LOST",
}

_SOURCE_MEMBERS = set(LeadSource.__members__)
_STAGE_MEMBERS = set(LeadStage.__members__)


def phone_digits(value: str | None) -> str | None:
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if not digits:
        return None
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits or None


def phone_dedupe_key(value: str | None) -> str | None:
    digits = phone_digits(value)
    if not digits:
        return None
    return digits[-10:] if len(digits) >= 10 else digits


def normalize_source(raw: str | None) -> str:
    if not raw:
        return "OTHER"
    key = normalize_header(raw)
    if key in _SOURCE_MEMBERS:
        return key
    return SOURCE_ALIASES.get(key, "OTHER")


def normalize_stage(raw: str | None) -> str:
    if not raw:
        return "NEW"
    key = normalize_header(raw)
    if key in _STAGE_MEMBERS:
        return key
    return STAGE_ALIASES.get(key, "NEW")


def parse_lead_date(value: str | None) -> datetime | None:
    if not value:
        return None
    s = value.strip()
    if not s or s.lower() in {"-", "na", "n/a", "nil", "none"}:
        return None
    for fmt in (
        "%Y-%m-%d",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d/%m/%y",
        "%d-%m-%y",
        "%m/%d/%Y",
    ):
        try:
            dt = datetime.strptime(s[:19], fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def detect_column_mapping(fieldnames: list[str]) -> dict[str, str]:
    norm_to_original: dict[str, str] = {}
    for fn in fieldnames:
        norm = normalize_header(fn)
        if norm and norm not in norm_to_original:
            norm_to_original[norm] = fn

    mapping: dict[str, str] = {}
    used: set[str] = set()
    for canonical, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            orig = norm_to_original.get(alias)
            if orig and orig not in used:
                mapping[canonical] = orig
                used.add(orig)
                break
    return mapping


def _cell(row: dict[str, str], mapping: dict[str, str], field: str) -> str | None:
    col = mapping.get(field)
    if not col:
        return None
    val = (row.get(col) or "").strip()
    return val or None


def parse_lead_rows(
    content: bytes,
) -> tuple[list[dict[str, Any]], dict[str, str], list[str], list[str]]:
    """Parse CSV into lead dicts. Returns (leads, column_mapping, warnings, errors)."""
    errors: list[str] = []
    warnings: list[str] = []
    try:
        fieldnames, rows = read_csv_table(content)
    except ValueError as e:
        return [], {}, [], [str(e)]

    if not rows:
        return [], {}, [], ["No data rows found in CSV"]

    mapping = detect_column_mapping(fieldnames)
    if "title" not in mapping and "company" not in mapping:
        errors.append(
            f"Could not find a name or company column. Headers found: {', '.join(fieldnames)}. "
            "Include a column like name, title, contact, or company."
        )
        return [], mapping, warnings, errors

    if "title" not in mapping:
        warnings.append(f'No name column found — using "{mapping["company"]}" as the lead title')
    if "phone" not in mapping and "email" not in mapping:
        warnings.append("No phone or email column detected; leads will still be imported")

    leads: list[dict[str, Any]] = []
    for row_num, row in enumerate(rows, start=2):
        title = _cell(row, mapping, "title")
        company = _cell(row, mapping, "company")
        if not title:
            title = company
        if not title:
            errors.append(f"Row {row_num}: name is empty")
            continue

        tags_raw = _cell(row, mapping, "tags")
        tags = [t.strip() for t in (tags_raw or "").split(",") if t.strip()]
        if "csv-import" not in {t.lower() for t in tags}:
            tags.append("csv-import")

        value = None
        if "estimated_value" in mapping:
            value = parse_price(_cell(row, mapping, "estimated_value"))

        leads.append(
            {
                "row": row_num,
                "title": title[:200],
                "company": company,
                "phone": _cell(row, mapping, "phone"),
                "email": (_cell(row, mapping, "email") or "").lower() or None,
                "city": _cell(row, mapping, "city"),
                "source": normalize_source(_cell(row, mapping, "source")),
                "stage": normalize_stage(_cell(row, mapping, "stage")),
                "product_interest": _cell(row, mapping, "product_interest"),
                "quantity_estimate": _cell(row, mapping, "quantity_estimate"),
                "notes": _cell(row, mapping, "notes"),
                "estimated_value": value,
                "tags": tags,
                "created_at": parse_lead_date(_cell(row, mapping, "created_at")),
            }
        )

    return leads, mapping, warnings, errors
