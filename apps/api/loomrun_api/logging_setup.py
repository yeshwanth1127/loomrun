"""Central logging for the Loomrun API.

Configures a consistent format for uvicorn + app loggers, and exposes a
request-id contextvar so AI / OpenRouter lines can be correlated with the
HTTP request that triggered them.
"""

from __future__ import annotations

import logging
import re
import sys
from contextvars import ContextVar
from typing import Any
from uuid import uuid4

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

_SECRET_RE = re.compile(
    r"(?i)(authorization|api[_-]?key|secret|token|password|bearer)\s*[:=]\s*\S+"
)


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get("-")  # type: ignore[attr-defined]
        return True


def new_request_id() -> str:
    return uuid4().hex[:12]


def set_request_id(value: str | None = None) -> str:
    rid = value or new_request_id()
    request_id_ctx.set(rid)
    return rid


def get_request_id() -> str:
    return request_id_ctx.get("-")


def sanitize_log_text(text: str, *, limit: int = 2000) -> str:
    """Strip credential-shaped substrings and cap length for log lines."""
    cleaned = _SECRET_RE.sub(r"\1=[REDACTED]", text or "")
    cleaned = cleaned.replace("\n", "\\n")
    if len(cleaned) > limit:
        return cleaned[: limit - 3] + "..."
    return cleaned


def kv(**fields: Any) -> str:
    """Render stable key=value pairs for grep-friendly logs."""
    parts: list[str] = []
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, str):
            # Quote values with spaces so lines stay parseable.
            rendered = value if re.fullmatch(r"[\w./:@+-]+", value) else repr(value)
        else:
            rendered = str(value)
        parts.append(f"{key}={rendered}")
    return " ".join(parts)


def configure_logging(level: str = "INFO") -> None:
    """Idempotent process-wide logging setup. Safe with uvicorn --workers."""
    root = logging.getLogger()
    if getattr(root, "_loomrun_configured", False):
        root.setLevel(level.upper())
        return

    numeric = getattr(logging, level.upper(), logging.INFO)
    root.setLevel(numeric)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(numeric)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    handler.addFilter(_RequestIdFilter())

    # Replace existing handlers so PM2 gets one consistent stream.
    root.handlers.clear()
    root.addHandler(handler)

    for noisy in ("httpx", "httpcore", "hpack", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # Keep uvicorn.error at INFO so startup still shows; access is covered by
    # our middleware so the duplicate uvicorn access lines stay quiet.
    logging.getLogger("uvicorn").setLevel(numeric)
    logging.getLogger("uvicorn.error").setLevel(numeric)

    root._loomrun_configured = True  # type: ignore[attr-defined]
    logging.getLogger(__name__).info(
        "logging configured %s", kv(level=level.upper())
    )
