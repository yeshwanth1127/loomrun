"""Signed, expiring OAuth state bound to the browser that starts the flow."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Request, Response
from jose import JWTError, jwt

from loomrun_api.config import settings


def _key() -> str:
    return hmac.new(settings.secret_key.encode(), b"loomrun-oauth-state-v1", hashlib.sha256).hexdigest()


def encode_state(provider: str, value: str, response: Response) -> str:
    nonce = secrets.token_urlsafe(32)
    response.set_cookie(
        f"loomrun_oauth_{provider}", nonce, max_age=600, httponly=True,
        secure=settings.public_api_url.startswith("https://"), samesite="lax", path="/v1/",
    )
    return jwt.encode({
        "typ": "oauth-state", "provider": provider, "value": value, "nonce": nonce,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
    }, _key(), algorithm="HS256")


def decode_state(provider: str, token: str, request: Request) -> str | None:
    try:
        payload = jwt.decode(token, _key(), algorithms=["HS256"], options={"require_exp": True})
    except JWTError:
        return None
    nonce = payload.get("nonce")
    cookie = request.cookies.get(f"loomrun_oauth_{provider}", "")
    if (payload.get("typ") != "oauth-state" or payload.get("provider") != provider
            or not isinstance(nonce, str) or not cookie
            or not secrets.compare_digest(nonce, cookie)):
        return None
    value = payload.get("value")
    return value if isinstance(value, str) else None
