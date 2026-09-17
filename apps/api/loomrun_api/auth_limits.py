"""Bound authentication attempts in the single API worker without storing credentials."""
import time
from collections import OrderedDict

from fastapi import HTTPException, Request

_windows: OrderedDict[str, tuple[float, int]] = OrderedDict()


async def limit_auth_attempts(request: Request) -> None:
    if request.method != "POST" or request.url.path.endswith("/refresh"):
        return
    # Uvicorn resolves the client through the trusted local reverse proxy.
    # Never trust a caller-supplied forwarding header here.
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    start, count = _windows.pop(key, (now, 0))
    if now - start >= 60:
        start, count = now, 0
    _windows[key] = (start, count + 1)
    if len(_windows) > 10000:
        _windows.popitem(last=False)
    if count >= 30:
        raise HTTPException(429, "Too many authentication attempts. Try again shortly.",
                            headers={"Retry-After": str(max(1, int(60 - (now - start))))})
