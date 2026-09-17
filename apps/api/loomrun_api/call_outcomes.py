"""Canonical Call Status labels and helpers for telecaller / Sales.

Mirrors apps/web/src/lib/callStatus.ts — keep both in sync.
Disposition codes are stored on TelecallerCallLog.outcome. Some also advance
LeadStage via systemKey; activity-only statuses never move the pipeline.
"""

from __future__ import annotations

from prisma.enums import CallOutcome

# (value, label, stage_system_key|None, connected, follow_up, requires_date)
_CANONICAL: list[tuple[str, str, str | None, bool, bool, bool]] = [
    # INITIAL CONTACT
    ("CONNECTED_INTERESTED", "Connected - Interested", "CONTACTED", True, False, False),
    ("CONNECTED_NOT_INTERESTED", "Connected - Not Interested", "CONTACTED", True, False, False),
    ("NO_ANSWER", "No Answer", None, False, False, False),
    ("WRONG_NUMBER", "Wrong Number", None, False, False, False),
    ("NOT_REACHABLE", "Not Reachable", None, False, False, False),
    ("BUSY", "Busy", None, False, False, False),
    ("CALL_BACK_LATER", "Call Back Later", None, False, True, False),
    ("WHATSAPP_SENT", "WhatsApp Sent", None, False, False, False),
    ("EMAIL_SENT", "Email Sent", None, False, False, False),
    # FOLLOW UP
    ("FOLLOW_UP", "Follow Up", None, False, True, False),
    ("FOLLOW_UP_DATE_SET", "Follow Up (Date Set)", None, False, True, True),
    # MEETING
    ("PHYSICAL_MEETING_REQUESTED", "Physical Meeting Requested", "QUALIFICATION", False, False, False),
    ("PHYSICAL_MEETING_PENDING", "Physical Meeting Pending", "NEGOTIATION", False, False, False),
    ("PHYSICAL_MEETING_DONE", "Physical Meeting Done", "NEGOTIATION", False, False, False),
    # SAMPLE / PRODUCTION
    ("SAMPLE_REQUESTED", "Sample Requested", "SAMPLE", False, False, False),
    ("SAMPLE_PRODUCTION_IN_PROGRESS", "Sample Production In Progress", "SAMPLE", False, False, False),
    ("SAMPLE_SENT", "Sample Sent", "SAMPLE", False, False, False),
    ("FOLLOW_UP_AFTER_SAMPLE", "Follow Up (After Sample)", "SAMPLE", False, True, True),
    # OUTCOME
    ("DEAL_WON_AFTER_SAMPLE", "Deal Won (After Sample)", "WON", True, False, False),
    ("DEAL_WON", "Deal Won", "WON", True, False, False),
    ("DEAL_REJECTED_AFTER_SAMPLE", "Deal Rejected (After Sample)", "LOST", False, False, False),
    ("DEAL_LOST", "Deal Lost", "LOST", False, False, False),
    # CLOSED / OTHERS
    ("CLOSED_NOT_NOW", "Closed (Not Now)", None, False, False, False),
    ("DO_NOT_CONTACT", "Do Not Contact", "LOST", False, False, False),
]

# Preferred telecaller UI order (canonical only).
TELECALLER_OUTCOMES: list[tuple[str, str]] = [(v, label) for v, label, *_ in _CANONICAL]

OUTCOME_LABELS: dict[str, str] = {v: label for v, label, *_ in _CANONICAL}
# Legacy labels still shown when reading old logs.
OUTCOME_LABELS.update(
    {
        "CONNECTED": "Connected",
        "RINGING_NO_RESPONSE": "Ringing - No Response",
        "SWITCHED_OFF": "Switched Off / Not Reachable",
        "NOT_INTERESTED": "Not Interested",
        "CALLBACK_SCHEDULED": "Follow Up",
        "QUALIFIED": "Qualified",
        "ORDER_CONFIRMED": "Order Confirmed",
    }
)

# Outcome → pipeline systemKey (None = do not move stage for that reason alone).
OUTCOME_STAGE_KEY: dict[str, str | None] = {v: stage for v, _, stage, *_ in _CANONICAL}
OUTCOME_STAGE_KEY.update(
    {
        "CONNECTED": "CONTACTED",
        "NOT_INTERESTED": "CONTACTED",
        "QUALIFIED": "QUALIFICATION",
        "ORDER_CONFIRMED": "WON",
        "CALLBACK_SCHEDULED": None,
        "RINGING_NO_RESPONSE": None,
        "SWITCHED_OFF": None,
        "NO_ANSWER": None,
        "BUSY": None,
        "WRONG_NUMBER": None,
    }
)

CONNECTED_OUTCOME_NAMES = frozenset(
    {v for v, _, _, connected, *_ in _CANONICAL if connected}
    | {"CONNECTED", "QUALIFIED", "ORDER_CONFIRMED"}
)

FOLLOW_UP_OUTCOME_NAMES = frozenset(
    {v for v, _, _, _, follow_up, _ in _CANONICAL if follow_up}
    | {"CALLBACK_SCHEDULED"}
)

REQUIRES_DATE_OUTCOME_NAMES = frozenset(
    {v for v, _, _, _, _, requires_date in _CANONICAL if requires_date}
    | {"CALLBACK_SCHEDULED"}
)

CONNECTED_OUTCOMES = frozenset(
    getattr(CallOutcome, name) for name in CONNECTED_OUTCOME_NAMES if hasattr(CallOutcome, name)
)


def outcome_label(outcome: CallOutcome | str) -> str:
    key = outcome.name if hasattr(outcome, "name") else str(outcome)
    return OUTCOME_LABELS.get(key, key.replace("_", " ").title())


def is_connected_outcome(outcome: CallOutcome | str) -> bool:
    key = outcome.name if hasattr(outcome, "name") else str(outcome).strip().upper()
    return key in CONNECTED_OUTCOME_NAMES


def is_follow_up_outcome(outcome: CallOutcome | str) -> bool:
    key = outcome.name if hasattr(outcome, "name") else str(outcome).strip().upper()
    return key in FOLLOW_UP_OUTCOME_NAMES


def requires_follow_up_date(outcome: CallOutcome | str) -> bool:
    key = outcome.name if hasattr(outcome, "name") else str(outcome).strip().upper()
    return key in REQUIRES_DATE_OUTCOME_NAMES


def stage_key_for_outcome(outcome: CallOutcome | str) -> str | None:
    key = outcome.name if hasattr(outcome, "name") else str(outcome).strip().upper()
    return OUTCOME_STAGE_KEY.get(key)
