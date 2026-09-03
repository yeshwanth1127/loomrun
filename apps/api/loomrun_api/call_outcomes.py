"""Human-readable labels and helpers for telecaller call outcomes."""

from __future__ import annotations

from prisma.enums import CallOutcome

# Preferred telecaller UI order. Legacy values stay valid for webhooks / old logs.
TELECALLER_OUTCOMES: list[tuple[str, str]] = [
    ("CONNECTED_INTERESTED", "Connected - Interested"),
    ("CONNECTED_NOT_INTERESTED", "Connected - Not Interested"),
    ("CALLBACK_SCHEDULED", "Follow Up"),
    ("RINGING_NO_RESPONSE", "Ringing - No Response"),
    ("BUSY", "Busy"),
    ("SWITCHED_OFF", "Switched Off / Not Reachable"),
    ("WRONG_NUMBER", "Wrong Number"),
    ("ORDER_CONFIRMED", "Order Confirmed"),
]

OUTCOME_LABELS: dict[str, str] = {
    "CONNECTED": "Connected",
    "NO_ANSWER": "No Answer",
    "BUSY": "Busy",
    "WRONG_NUMBER": "Wrong Number",
    "NOT_INTERESTED": "Not Interested",
    "CALLBACK_SCHEDULED": "Follow Up",
    "QUALIFIED": "Qualified",
    "CONNECTED_INTERESTED": "Connected - Interested",
    "CONNECTED_NOT_INTERESTED": "Connected - Not Interested",
    "RINGING_NO_RESPONSE": "Ringing - No Response",
    "SWITCHED_OFF": "Switched Off / Not Reachable",
    "ORDER_CONFIRMED": "Order Confirmed",
}

# Outcomes that mean the agent spoke with the lead (WhatsApp send allowed).
CONNECTED_OUTCOMES = frozenset(
    {
        CallOutcome.CONNECTED,
        CallOutcome.CONNECTED_INTERESTED,
        CallOutcome.CONNECTED_NOT_INTERESTED,
        CallOutcome.ORDER_CONFIRMED,
        CallOutcome.QUALIFIED,
    }
)


def outcome_label(outcome: CallOutcome | str) -> str:
    key = outcome.name if hasattr(outcome, "name") else str(outcome)
    return OUTCOME_LABELS.get(key, key.replace("_", " ").title())


def is_connected_outcome(outcome: CallOutcome | str) -> bool:
    if isinstance(outcome, str):
        try:
            outcome = CallOutcome[outcome.strip().upper()]
        except KeyError:
            return False
    return outcome in CONNECTED_OUTCOMES
