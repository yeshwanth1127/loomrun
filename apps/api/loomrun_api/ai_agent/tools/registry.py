"""Dynamic AI tool registry.

Add a new tool by creating a function in `ai_agent/tools/defs/` and decorating it:

    @register_tool(
        name="my_tool",
        description="...",
        parameters={...},  # JSON Schema object properties
        kind="read",       # "read" executes immediately; "write" needs confirm
        modes=("minimal", "advanced"),  # which AI modes expose the tool
    )
    async def my_tool(ctx: ToolContext, **args) -> dict:
        ...

Import the module from `defs/__init__.py` so it auto-registers on startup.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal
import re

ToolKind = Literal["read", "write"]
ToolHandler = Callable[..., Awaitable[dict[str, Any]]]

_REGISTRY: dict[str, "ToolSpec"] = {}


@dataclass(frozen=True)
class ToolContext:
    organization_id: str
    user_id: str
    mode: str
    # No safe default on purpose: callers must pass the caller's real membership
    # role so owner_only tools fail closed if a caller forgets to thread it through.
    role: str = ""
    # IANA timezone for this chat turn (from the browser). Date-only filters
    # use this calendar. Blank means Asia/Kolkata at parse time.
    timezone: str = ""


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    kind: ToolKind
    modes: tuple[str, ...]
    handler: ToolHandler
    required: list[str] = field(default_factory=list)
    summary_fn: Callable[[dict[str, Any]], str] | None = None
    # Mirrors the same Owner-only boundary enforced on the matching REST endpoints
    # (Quotations, Invoices, Catalog, etc.) — non-owners never see or can invoke these.
    owner_only: bool = False

    def openai_schema(self) -> dict[str, Any]:
        props = dict(self.parameters)
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": props,
                    "required": list(self.required),
                    "additionalProperties": False,
                },
            },
        }


def register_tool(
    *,
    name: str,
    description: str,
    parameters: dict[str, Any],
    kind: ToolKind = "read",
    modes: tuple[str, ...] = ("minimal", "advanced"),
    required: list[str] | None = None,
    summary_fn: Callable[[dict[str, Any]], str] | None = None,
    owner_only: bool = False,
):
    """Decorator: register an async tool handler into the global registry."""

    def decorator(fn: ToolHandler) -> ToolHandler:
        if name in _REGISTRY:
            raise ValueError(f"Duplicate AI tool registration: {name}")
        _REGISTRY[name] = ToolSpec(
            name=name,
            description=description,
            parameters=parameters,
            kind=kind,
            modes=modes,
            handler=fn,
            required=required or [],
            summary_fn=summary_fn,
            owner_only=owner_only,
        )
        return fn

    return decorator


def get_tool(name: str) -> ToolSpec | None:
    return _REGISTRY.get(name)


def all_tools() -> list[ToolSpec]:
    return list(_REGISTRY.values())


def tools_for_mode(mode: str, *, role: str = "", include_writes: bool | None = None) -> list[ToolSpec]:
    """Return tools available for an AI mode and caller role.

    - minimal: read tools only (unless include_writes forced)
    - advanced: read + write
    - owner_only tools are excluded entirely unless role == "OWNER"
    """
    allow_writes = include_writes if include_writes is not None else mode == "advanced"
    out: list[ToolSpec] = []
    for spec in _REGISTRY.values():
        if mode not in spec.modes:
            continue
        if spec.kind == "write" and not allow_writes:
            continue
        if spec.owner_only and role != "OWNER":
            continue
        out.append(spec)
    return out


def openai_tools_for_mode(mode: str, *, role: str = "") -> list[dict[str, Any]]:
    return [t.openai_schema() for t in tools_for_mode(mode, role=role)]


# Always available — cheap CRM primitives the model needs for almost any turn.
# Team/history tools are packs: putting them here made "give me the details"
# look like a roster of people or past chats instead of search_leads.
_CORE_TOOL_NAMES = frozenset(
    {
        "search_leads",
        "count_leads",
        "get_lead",
    }
)

# Clear "make/create/add a lead …" turns only need create_lead — no roster of
# read tools. Cuts most of the remaining prompt tokens on that path.
_SIMPLE_CREATE_LEAD_RE = re.compile(
    r"\b(make|create|add)\b.{0,40}\b(a\s+)?lead\b",
    re.I,
)


def is_simple_create_lead(message: str) -> bool:
    text = (message or "").strip()
    if not text or len(text) > 400:
        return False
    return bool(_SIMPLE_CREATE_LEAD_RE.search(text))

# Keyword → extra tools. Matched packs are unioned with CORE.
# Unmatched messages fall back to the full mode set so open-ended questions
# still work; matched ones (e.g. "make a lead") stay small.
_TOOL_PACKS: dict[str, frozenset[str]] = {
    "leads": frozenset(
        {
            "create_lead",
            "update_lead",
            "schedule_follow_up",
            "search_leads",
            "count_leads",
            "get_lead",
            "list_follow_ups",
        }
    ),
    "quotations": frozenset(
        {
            "list_catalog",
            "get_quotation",
            "list_quotations_for_lead",
            "create_quotation",
            "update_quotation",
            "send_quotation",
            "generate_invoice",
            "send_invoice",
            "create_and_send_quotation",
            "create_and_send_invoice",
        }
    ),
    "whatsapp": frozenset(
        {"send_whatsapp_message", "list_whatsapp_messages", "get_whatsapp_status"}
    ),
    "calls": frozenset({"log_call", "list_calls"}),
    "production": frozenset(
        {
            "list_production_orders",
            "get_production_order",
            "create_production_order",
            "update_production_order",
            "record_production_payment",
            "record_production_expense",
        }
    ),
    "expenses": frozenset({"list_expenses", "create_expense", "delete_expense"}),
    "ceo": frozenset({"get_ceo_dashboard"}),
    "team": frozenset({"list_team_members"}),
    "history": frozenset({"search_past_chats"}),
}

_PACK_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    (
        "leads",
        (
            "lead",
            "leads",
            "pipeline",
            "follow-up",
            "follow up",
            "followup",
            "assignee",
            "stage",
            "contact",
            "prospect",
            "customer",
            "phone number",
            "make a lead",
            "create a lead",
            "add a lead",
            "new lead",
        ),
    ),
    (
        "quotations",
        (
            "quot",
            "quotation",
            "quote",
            "invoice",
            "catalog",
            "price",
            "pricing",
            "proposal",
            "estimate",
        ),
    ),
    (
        "whatsapp",
        ("whatsapp", "wa message", "send message", "text them", "message them"),
    ),
    ("calls", ("phone call", "telecaller", "log a call", "log call", "dial", "calls")),
    (
        "production",
        (
            "production",
            "factory",
            "fabric",
            "cutting",
            "printing",
            "stitch",
            "order stage",
        ),
    ),
    ("expenses", ("expense", "expenses", "cost", "spend", "spent")),
    ("ceo", ("ceo", "dashboard", "win rate", "deals won", "deals lost", "hot leads")),
    (
        "team",
        (
            "team member",
            "teammate",
            "assignee",
            "assigned to",
            "who owns",
            "reassign",
            "list the team",
        ),
    ),
    (
        "history",
        (
            "past chat",
            "previous chat",
            "earlier conversation",
            "last time we",
            "what did i ask",
        ),
    ),
]


def _detect_tool_packs(message: str) -> set[str]:
    text = (message or "").strip().lower()
    if not text:
        return set()
    matched: set[str] = set()
    for pack, keywords in _PACK_KEYWORDS:
        for kw in keywords:
            # Word-aware match so "called" does not activate the calls pack.
            if " " in kw:
                if kw in text:
                    matched.add(pack)
                    break
            else:
                if re.search(rf"(?<![a-z0-9]){re.escape(kw)}(?![a-z0-9])", text):
                    matched.add(pack)
                    break
    return matched


def select_tool_names_for_message(message: str, *, mode: str, role: str = "") -> set[str] | None:
    """Return a tool-name subset for this user message, or None = use all tools.

    None means "no clear intent — expose the full mode set".
    """
    packs = _detect_tool_packs(message)
    if not packs:
        return None
    names = set(_CORE_TOOL_NAMES)
    for pack in packs:
        names |= _TOOL_PACKS.get(pack, frozenset())
    # Only keep tools the caller is actually allowed to see.
    allowed = {t.name for t in tools_for_mode(mode, role=role)}
    return names & allowed


def openai_tools_for_message(
    mode: str,
    *,
    role: str = "",
    message: str = "",
) -> list[dict[str, Any]]:
    """Prefer a small intent-matched tool list to cut prompt tokens.

    Falls back to the full mode set when the message does not match a pack
    (open-ended questions still need broad access).
    """
    available = tools_for_mode(mode, role=role)
    by_name = {t.name: t for t in available}

    if mode == "advanced" and is_simple_create_lead(message) and "create_lead" in by_name:
        return [by_name["create_lead"].openai_schema()]

    selected = select_tool_names_for_message(message, mode=mode, role=role)
    if selected is None:
        return [t.openai_schema() for t in available]
    trimmed = [t for t in available if t.name in selected]
    # Safety: never send an empty tool list when the mode has tools.
    if not trimmed:
        return [t.openai_schema() for t in available]
    return [t.openai_schema() for t in trimmed]


def summarize_args(spec: ToolSpec, args: dict[str, Any]) -> str:
    if spec.summary_fn:
        try:
            return spec.summary_fn(args)
        except Exception:
            pass
    return f"Run {spec.name}"
