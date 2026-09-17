"""HTTP request logging middleware (method, path, status, duration, org)."""

from __future__ import annotations

import logging
import re
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from loomrun_api.logging_setup import get_request_id, kv, set_request_id

logger = logging.getLogger("loomrun_api.request")

_ORG_PATH_RE = re.compile(r"^/v1/orgs/([^/]+)")
_SKIP_PATHS = {"/health", "/docs", "/openapi.json", "/redoc", "/favicon.ico"}


class RequestLoggingMiddleware:
    """Pure ASGI middleware — safe for SSE / streaming responses."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path") or ""
        method = scope.get("method") or "?"
        headers = {
            k.decode("latin-1").lower(): v.decode("latin-1")
            for k, v in (scope.get("headers") or [])
        }
        incoming_rid = headers.get("x-request-id") or headers.get("x-correlation-id")
        rid = set_request_id(incoming_rid.strip() if incoming_rid else None)

        org_match = _ORG_PATH_RE.match(path)
        org_id = org_match.group(1) if org_match else None

        if path in _SKIP_PATHS or path.startswith("/mcp"):
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message.get("status") or 500)
                # Expose request id to clients / nginx.
                raw_headers = list(message.get("headers") or [])
                raw_headers.append((b"x-request-id", rid.encode("latin-1")))
                message = {**message, "headers": raw_headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            duration_ms = int((time.perf_counter() - started) * 1000)
            logger.exception(
                "request failed %s",
                kv(
                    method=method,
                    path=path,
                    org=org_id,
                    duration_ms=duration_ms,
                    request_id=get_request_id(),
                ),
            )
            raise
        else:
            duration_ms = int((time.perf_counter() - started) * 1000)
            level = logging.WARNING if status_code >= 500 else logging.INFO
            logger.log(
                level,
                "request %s",
                kv(
                    method=method,
                    path=path,
                    status=status_code,
                    duration_ms=duration_ms,
                    org=org_id,
                ),
            )
