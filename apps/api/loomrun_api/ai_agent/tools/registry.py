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


def summarize_args(spec: ToolSpec, args: dict[str, Any]) -> str:
    if spec.summary_fn:
        try:
            return spec.summary_fn(args)
        except Exception:
            pass
    return f"Run {spec.name}"
