"""Default Sales pipeline stages (mirrors historical LeadStage enum)."""

from __future__ import annotations

DEFAULT_PIPELINE_NAME = "Sales"

# (name, slug, sort_order, kind, probability, system_key)
DEFAULT_STAGES: list[tuple[str, str, int, str, int, str]] = [
    ("New", "new", 0, "OPEN", 10, "NEW"),
    ("Contacted", "contacted", 1, "OPEN", 20, "CONTACTED"),
    ("Requirement Collected", "requirement-collected", 2, "OPEN", 35, "QUALIFICATION"),
    ("Quoted", "quoted", 3, "OPEN", 50, "QUOTATION"),
    ("Negotiation", "negotiation", 4, "OPEN", 65, "NEGOTIATION"),
    ("Sample Sent", "sample-sent", 5, "OPEN", 80, "SAMPLE"),
    ("Won", "won", 6, "WON", 100, "WON"),
    ("Lost", "lost", 7, "LOST", 0, "LOST"),
]
