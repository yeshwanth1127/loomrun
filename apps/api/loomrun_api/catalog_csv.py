"""Flexible catalog CSV parsing — arbitrary headers via alias matching and heuristics."""

from __future__ import annotations

import csv
import io
import re
from typing import Any

# Canonical field -> normalized header aliases (lowercase, underscores)
FIELD_ALIASES: dict[str, list[str]] = {
    "name": [
        "name",
        "product_name",
        "product",
        "item",
        "item_name",
        "title",
        "product_title",
        "service",
        "service_name",
        "material",
        "particular",
        "particulars",
        "item_description_short",
        "goods",
        "article_description",
    ],
    "unit_price": [
        "unit_price",
        "unitprice",
        "price",
        "rate",
        "unit_rate",
        "amount",
        "cost",
        "unit_cost",
        "mrp",
        "selling_price",
        "sell_price",
        "list_price",
        "sale_price",
        "price_inr",
        "price_rs",
        "rs",
        "inr",
        "value",
        "charges",
        "charge",
    ],
    "description": [
        "description",
        "desc",
        "details",
        "product_description",
        "item_description",
        "long_description",
        "remarks",
        "note",
        "notes",
        "specification",
        "spec",
        "specs",
        "about",
    ],
    "sku": [
        "sku",
        "code",
        "product_code",
        "item_code",
        "part_number",
        "part_no",
        "model",
        "model_no",
        "model_number",
        "article",
        "article_no",
        "article_number",
        "barcode",
        "hsn",
        "hsn_code",
        "id",
        "product_id",
        "item_id",
    ],
}


def normalize_header(header: str) -> str:
    h = (header or "").strip().lower()
    h = h.replace("\ufeff", "")
    h = re.sub(r"[^\w\s]", " ", h)
    h = re.sub(r"\s+", "_", h.strip())
    return h


def parse_price(value: Any) -> float | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in {"-", "na", "n/a", "nil", "none"}:
        return None
    # Keep digits, dot, minus; strip currency/grouping
    cleaned = re.sub(r"[^\d.\-]", "", s.replace(",", ""))
    if not cleaned or cleaned in {".", "-", "-."}:
        return None
    try:
        price = float(cleaned)
    except ValueError:
        return None
    return price if price >= 0 else None


def decode_csv_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Could not decode file; use UTF-8 or Windows-1252 encoding")


def read_csv_table(content: bytes) -> tuple[list[str], list[dict[str, str]]]:
    text = decode_csv_text(content)
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")

    fieldnames = [f for f in reader.fieldnames if f is not None]
    rows: list[dict[str, str]] = []
    for raw in reader:
        row = {fn: (raw.get(fn) or "").strip() for fn in fieldnames}
        if any(row.values()):
            rows.append(row)
    return fieldnames, rows


def _score_text_column(rows: list[dict[str, str]], column: str) -> float:
    if not rows:
        return 0.0
    hits = 0
    for row in rows[:50]:
        val = row.get(column, "").strip()
        if not val:
            continue
        if parse_price(val) is None and len(val) >= 2:
            hits += 1
    return hits / min(len(rows), 50)


def _score_price_column(rows: list[dict[str, str]], column: str) -> float:
    if not rows:
        return 0.0
    hits = 0
    for row in rows[:50]:
        if parse_price(row.get(column, "")) is not None:
            hits += 1
    return hits / min(len(rows), 50)


def detect_column_mapping(
    fieldnames: list[str], rows: list[dict[str, str]]
) -> tuple[dict[str, str], list[str]]:
    """
    Map canonical fields (name, unit_price, description, sku) to original CSV headers.
    Returns (mapping, warnings).
    """
    norm_to_original: dict[str, str] = {}
    for fn in fieldnames:
        norm = normalize_header(fn)
        if norm and norm not in norm_to_original:
            norm_to_original[norm] = fn

    mapping: dict[str, str] = {}
    used_originals: set[str] = set()
    warnings: list[str] = []

    for canonical, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            if alias in norm_to_original:
                orig = norm_to_original[alias]
                if orig not in used_originals:
                    mapping[canonical] = orig
                    used_originals.add(orig)
                    break

    available = [fn for fn in fieldnames if fn not in used_originals]

    if "name" not in mapping and available:
        best = max(available, key=lambda c: _score_text_column(rows, c))
        if _score_text_column(rows, best) >= 0.3:
            mapping["name"] = best
            used_originals.add(best)
            warnings.append(f'Using column "{best}" as product name')
            available = [fn for fn in fieldnames if fn not in used_originals]

    if "unit_price" not in mapping and available:
        best = max(available, key=lambda c: _score_price_column(rows, c))
        if _score_price_column(rows, best) >= 0.3:
            mapping["unit_price"] = best
            used_originals.add(best)
            warnings.append(f'Using column "{best}" as unit price')
            available = [fn for fn in fieldnames if fn not in used_originals]

    if "description" not in mapping and available:
        best = max(available, key=lambda c: _score_text_column(rows, c))
        if best and _score_text_column(rows, best) >= 0.3:
            mapping["description"] = best
            used_originals.add(best)
            warnings.append(f'Using column "{best}" as description')

    return mapping, warnings


def parse_catalog_rows(
    content: bytes,
) -> tuple[list[dict[str, Any]], dict[str, str], list[str], list[str]]:
    """
    Parse CSV into catalog item dicts.
    Returns (items, column_mapping, warnings, errors).
    """
    errors: list[str] = []
    try:
        fieldnames, rows = read_csv_table(content)
    except ValueError as e:
        return [], {}, [], [str(e)]

    if not rows:
        return [], {}, [], ["No data rows found in CSV"]

    mapping, warnings = detect_column_mapping(fieldnames, rows)

    if "name" not in mapping:
        errors.append(
            f"Could not find a product name column. Headers found: {', '.join(fieldnames)}. "
            "Include a column like name, product, item, or title."
        )
        return [], mapping, warnings, errors

    if "unit_price" not in mapping:
        errors.append(
            f"Could not find a price column. Headers found: {', '.join(fieldnames)}. "
            "Include a column like price, rate, amount, or mrp."
        )
        return [], mapping, warnings, errors

    name_col = mapping["name"]
    price_col = mapping["unit_price"]
    desc_col = mapping.get("description")
    sku_col = mapping.get("sku")

    items: list[dict[str, Any]] = []
    for row_num, row in enumerate(rows, start=2):
        name = row.get(name_col, "").strip()
        if not name:
            errors.append(f"Row {row_num}: name is empty")
            continue

        unit_price = parse_price(row.get(price_col, ""))
        if unit_price is None:
            raw_price = row.get(price_col, "")
            errors.append(f'Row {row_num}: could not parse price from "{raw_price}"')
            continue

        description = row.get(desc_col, "").strip() if desc_col else None
        if description == "":
            description = None
        sku = row.get(sku_col, "").strip() if sku_col else None
        if sku == "":
            sku = None

        items.append(
            {
                "name": name,
                "unit_price": unit_price,
                "description": description,
                "sku": sku,
            }
        )

    return items, mapping, warnings, errors
