"""Plan entitlements — Growth / Scale / Free trial (Scale features, limited capacity)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import HTTPException, status

PlanKey = Literal["free", "growth", "scale"]
AiChatMode = Literal[False, "minimal", "advanced"]

VALID_PLANS: frozenset[str] = frozenset({"free", "growth", "scale"})
BASE_INCLUDED_USERS = 10
EXTRA_USER_PRICE_INR = 750
TRIAL_DAYS = 14

METRIC_WHATSAPP = "whatsapp_outbound"
METRIC_AI_CHAT = "ai_chat"  # legacy daily counter; AI now uses dual credit windows


@dataclass(frozen=True)
class Entitlements:
    plan: str
    max_users: int
    extra_user_price_inr: int
    ai_chat: AiChatMode
    ai_multilingual: bool
    google_ads: bool
    meta_lead_ads: bool
    outbound_telephony_providers: bool
    ai_voice_agents: bool
    gmail_calendar: bool
    event_automations: bool
    # Capacity limits (None = unlimited)
    messages_per_day: int | None
    ai_credits_per_5h: int | None
    ai_credits_per_week: int | None
    max_leads: int | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def has_feature(self, feature: str) -> bool:
        return bool(getattr(self, feature, False))


# Free trial: full Scale feature set, tighter capacity
_FREE = Entitlements(
    plan="free",
    max_users=3,
    extra_user_price_inr=EXTRA_USER_PRICE_INR,
    ai_chat="advanced",
    ai_multilingual=True,
    google_ads=True,
    meta_lead_ads=True,
    outbound_telephony_providers=True,
    ai_voice_agents=True,
    gmail_calendar=True,
    event_automations=True,
    messages_per_day=15,
    ai_credits_per_5h=80,
    ai_credits_per_week=400,
    max_leads=100,
)

_GROWTH = Entitlements(
    plan="growth",
    max_users=BASE_INCLUDED_USERS,
    extra_user_price_inr=EXTRA_USER_PRICE_INR,
    ai_chat="minimal",
    ai_multilingual=False,
    google_ads=False,
    meta_lead_ads=True,  # Meta as lead source
    outbound_telephony_providers=False,
    ai_voice_agents=False,
    gmail_calendar=False,
    event_automations=False,
    messages_per_day=50,
    ai_credits_per_5h=120,
    ai_credits_per_week=700,
    max_leads=None,
)

_SCALE = Entitlements(
    plan="scale",
    max_users=BASE_INCLUDED_USERS,
    extra_user_price_inr=EXTRA_USER_PRICE_INR,
    ai_chat="advanced",
    ai_multilingual=True,
    google_ads=True,
    meta_lead_ads=True,
    outbound_telephony_providers=True,
    ai_voice_agents=True,
    gmail_calendar=True,
    event_automations=True,
    messages_per_day=500,
    ai_credits_per_5h=400,
    ai_credits_per_week=2500,
    max_leads=None,
)

_BY_PLAN: dict[str, Entitlements] = {
    "free": _FREE,
    "growth": _GROWTH,
    "scale": _SCALE,
}

_LOCKED = Entitlements(
    plan="free",
    max_users=0,
    extra_user_price_inr=EXTRA_USER_PRICE_INR,
    ai_chat=False,
    ai_multilingual=False,
    google_ads=False,
    meta_lead_ads=False,
    outbound_telephony_providers=False,
    ai_voice_agents=False,
    gmail_calendar=False,
    event_automations=False,
    messages_per_day=0,
    ai_credits_per_5h=0,
    ai_credits_per_week=0,
    max_leads=0,
)


PLAN_CATALOG: list[dict[str, Any]] = [
    {
        "key": "growth",
        "name": "Growth Plan",
        "price_inr": 2899,
        "price_label": "₹2,899/month",
        "included_users": BASE_INCLUDED_USERS,
        "extra_user_price_inr": EXTRA_USER_PRICE_INR,
        "highlight": False,
        "features": [
            "Full lead pipeline with CRM scoring, tags, and notes",
            "Activity timeline and follow-up scheduling",
            "Lead sources: Meta Ads, website forms, and referrals",
            "Quotation builder with PDF generation",
            "Branded quotation and invoice templates",
            "13-stage production tracking pipeline",
            "Automated messaging up to 50 messages/day",
            "Message templates for quotations, invoices, and follow-ups",
            "Minimal AI chat assistant (120 credits / 5h, 700 / week)",
            "Call logging and telecaller workflow",
            "Payment tracking and expense management",
            "P&L visibility per order",
            "CEO dashboard with real-time KPIs",
            "Product catalog management",
            "Team management (up to 10 users)",
            "Brand assets configuration",
        ],
    },
    {
        "key": "scale",
        "name": "Scale Plan",
        "price_inr": 5799,
        "price_label": "₹5,799/month",
        "included_users": BASE_INCLUDED_USERS,
        "extra_user_price_inr": EXTRA_USER_PRICE_INR,
        "highlight": True,
        "features": [
            "Everything in Growth",
            "Google Ads and Meta Lead Ads integration",
            "Outbound telephony providers (Twilio, Plivo, Exotel, Telnyx, Vonage)",
            "AI voice calling agents with recordings and transcripts",
            "Gmail and Google Calendar connectors",
            "Event-driven automation (lead.created, order.shipped, etc.)",
            "Advanced AI assistant that handles everything autonomously",
            "Multilingual AI assistant with full conversation capability",
            "Automated reporting and insights",
            "Per-provider usage and cost tracking",
            "Priority support and dedicated onboarding",
            "Higher WhatsApp capacity + AI credits (400 / 5h, 2,500 / week)",
        ],
    },
]


def normalize_plan(plan: str | None) -> str:
    key = (plan or "free").strip().lower()
    if key not in VALID_PLANS:
        return "free"
    return key


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def default_trial_ends_at(*, from_dt: datetime | None = None) -> datetime:
    base = from_dt or utcnow()
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return base + timedelta(days=TRIAL_DAYS)


def trial_ends_at_value(org) -> datetime | None:
    raw = getattr(org, "trialEndsAt", None)
    if raw is None:
        return None
    if raw.tzinfo is None:
        return raw.replace(tzinfo=timezone.utc)
    return raw


def is_paid_plan(plan: str | None) -> bool:
    return normalize_plan(plan) in ("growth", "scale")


def is_trial_active(org) -> bool:
    plan = normalize_plan(getattr(org, "plan", None))
    if plan != "free":
        return False
    ends = trial_ends_at_value(org)
    if ends is None:
        return False
    return ends > utcnow()


def is_access_locked(org) -> bool:
    """Free plan after trial ends — must upgrade."""
    plan = normalize_plan(getattr(org, "plan", None))
    if plan != "free":
        return False
    ends = trial_ends_at_value(org)
    if ends is None:
        # Legacy free without trial date: treat as expired
        return True
    return ends <= utcnow()


def get_entitlements(plan: str | None) -> Entitlements:
    return _BY_PLAN[normalize_plan(plan)]


def get_org_entitlements(org) -> Entitlements:
    if is_access_locked(org):
        return _LOCKED
    return get_entitlements(getattr(org, "plan", None))


def max_seats_for_org(*, plan: str | None = None, extra_seats: int = 0, org=None) -> int:
    if org is not None:
        ents = get_org_entitlements(org)
        extra = max(0, getattr(org, "extraSeats", 0) or 0)
        return ents.max_users + extra
    ents = get_entitlements(plan)
    return ents.max_users + max(0, extra_seats)


def require_valid_plan(plan: str) -> str:
    key = plan.strip().lower()
    if key not in VALID_PLANS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid plan. Must be one of: {', '.join(sorted(VALID_PLANS))}",
        )
    return key


def ai_mode_label(ents: Entitlements) -> str:
    if ents.ai_chat is False:
        return "disabled"
    return str(ents.ai_chat)


def trial_payload(org) -> dict[str, Any]:
    plan = normalize_plan(getattr(org, "plan", None))
    ends = trial_ends_at_value(org)
    active = is_trial_active(org)
    locked = is_access_locked(org)
    days_left = None
    if ends and plan == "free":
        delta = ends - utcnow()
        days_left = max(0, int(delta.total_seconds() // 86400))
    return {
        "is_trial": plan == "free",
        "trial_active": active,
        "trial_expired": locked,
        "trial_ends_at": ends.isoformat() if ends else None,
        "trial_days": TRIAL_DAYS,
        "days_left": days_left,
    }


# Paths still reachable when trial expired (subscription / read-only billing UX)
LOCKED_PATH_ALLOWLIST = (
    "/subscription",
    "/brand",
)


def path_allowed_when_locked(path: str) -> bool:
    p = path.lower()
    return any(token in p for token in LOCKED_PATH_ALLOWLIST)


FEATURE_UPGRADE_HINTS: dict[str, str] = {
    "google_ads": "Google Ads integration requires the Scale plan (or an active free trial).",
    "meta_lead_ads": "Meta Lead Ads integration requires Growth, Scale, or an active free trial.",
    "outbound_telephony_providers": "Multi-provider telephony requires Scale or an active free trial.",
    "ai_voice_agents": "AI voice calling agents require Scale or an active free trial.",
    "gmail_calendar": "Gmail and Google Calendar require Scale or an active free trial.",
    "event_automations": "Event-driven automations require Scale or an active free trial.",
}
