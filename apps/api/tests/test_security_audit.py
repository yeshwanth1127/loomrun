"""Security regressions; all database and provider operations are mocked."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
from http.cookies import SimpleCookie
import hashlib
import hmac

import pytest
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.testclient import TestClient

from loomrun_api.config import settings
from loomrun_api.routers import auth, google_oauth, meta_oauth, google_ads_oauth, whatsapp_hooks, meta_hooks, telephony
from loomrun_api import deps


def request(method="POST", body=b"{}", headers=None, path="/"):
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}
    return Request({"type": "http", "method": method, "scheme": "https", "path": path,
                    "query_string": b"", "headers": headers or [],
                    "server": ("testserver", 443), "client": ("192.0.2.1", 1234)}, receive)


def test_admin_registration_requires_authentication():
    app = FastAPI()
    app.include_router(auth.router, prefix="/v1/auth")
    with TestClient(app) as client:
        r = client.post("/v1/auth/register-super-admin", json={"email": "audit@example.com", "password": "test-password"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_does_not_promote_unverified_email(monkeypatch):
    monkeypatch.setattr(settings, "super_admin_emails", "audit@example.com")
    user = SimpleNamespace(id="u", isSuperAdmin=False, passwordHash="fake")
    db = SimpleNamespace(user=SimpleNamespace(find_unique=AsyncMock(return_value=user), update=AsyncMock(return_value=user)))
    monkeypatch.setattr(auth, "prisma", db)
    monkeypatch.setattr(auth, "verify_password", lambda *args: True)
    await auth.login(auth.LoginBody(email="audit@example.com", password="password"))
    db.user.update.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("module,path", [(google_oauth,"google"),(meta_oauth,"meta"),(google_ads_oauth,"google-ads")])
async def test_forged_oauth_state_cannot_redirect(module, path):
    app = FastAPI()
    app.include_router(module.router, prefix="/v1")
    forged = "victim|https://testserver|https://attacker.invalid/"
    if path == "google":
        forged += "|GMAIL"
    with TestClient(app) as client:
        r = client.get(f"/v1/{path}/oauth/callback", params={"state": forged, "error": "denied"}, follow_redirects=False)
    assert r.status_code == 307
    assert "attacker.invalid" not in r.headers["location"]


def test_oauth_signed_state_browser_binding_and_tampering():
    from loomrun_api.oauth_state import encode_state, decode_state, _key
    from jose import jwt
    response = Response()
    token = encode_state("google", "org|base|return|GMAIL", response)
    cookie = SimpleCookie(response.headers["set-cookie"])
    cookie_value = cookie["loomrun_oauth_google"].value
    req = request(headers=[(b"cookie", f"loomrun_oauth_google={cookie_value}".encode())])
    assert decode_state("google", token, req) == "org|base|return|GMAIL"
    assert decode_state("google", token, request()) is None
    assert decode_state("meta", token, req) is None
    assert decode_state("google", token + "bad", req) is None
    claims = jwt.get_unverified_claims(token)
    claims["exp"] = 1
    assert decode_state("google", jwt.encode(claims, _key(), algorithm="HS256"), req) is None
    assert cookie["loomrun_oauth_google"]["httponly"]


@pytest.mark.asyncio
async def test_unsigned_whatsapp_cannot_touch_database(monkeypatch):
    db = SimpleNamespace(organization=SimpleNamespace(find_unique=AsyncMock(return_value=SimpleNamespace(id="org"))))
    monkeypatch.setattr(whatsapp_hooks, "prisma", db)
    with pytest.raises(HTTPException) as exc:
        await whatsapp_hooks.whatsapp_inbound_public("org", request())
    assert exc.value.status_code == 403
    db.organization.find_unique.assert_not_awaited()


@pytest.mark.asyncio
async def test_valid_whatsapp_signature_still_accepted(monkeypatch):
    monkeypatch.setattr(settings, "meta_app_secret", "test-secret")
    monkeypatch.setattr(whatsapp_hooks, "prisma", SimpleNamespace(organization=SimpleNamespace(find_unique=AsyncMock(return_value=SimpleNamespace(id="org")))))
    signature = "sha256=" + hmac.new(b"test-secret", b"{}", hashlib.sha256).hexdigest()
    assert await whatsapp_hooks.whatsapp_inbound_public("org", request(headers=[(b"x-hub-signature-256", signature.encode())])) == {"status": "ok"}


@pytest.mark.asyncio
async def test_meta_missing_secret_fails_closed(monkeypatch):
    monkeypatch.setattr(settings, "meta_app_secret", "")
    with pytest.raises(HTTPException) as exc:
        await meta_hooks.meta_webhook_inbound(request())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_vapi_missing_secret_fails_closed(monkeypatch):
    monkeypatch.setattr(settings, "vapi_webhook_secret", "")
    with pytest.raises(HTTPException) as exc:
        await telephony.vapi_webhook(request())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_twilio_recording_requires_signature():
    with pytest.raises(HTTPException) as exc:
        await telephony.twilio_recording_webhook(request())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_delete(monkeypatch):
    membership = SimpleNamespace(role="VIEWER", organization=None)
    monkeypatch.setattr(deps, "prisma", SimpleNamespace(membership=SimpleNamespace(find_first=AsyncMock(return_value=membership))))
    with pytest.raises(HTTPException) as exc:
        await deps.get_org_context("org", request("DELETE", path="/v1/orgs/org/leads/lead"), "user")
    assert exc.value.status_code == 403
    assert (await deps.get_org_context("org", request("GET"), "user")).membership == membership


@pytest.mark.asyncio
async def test_auth_rate_limit_and_normal_reads():
    from loomrun_api.auth_limits import limit_auth_attempts, _windows
    _windows.clear()
    for _ in range(30):
        await limit_auth_attempts(request())
    with pytest.raises(HTTPException) as exc:
        await limit_auth_attempts(request())
    assert exc.value.status_code == 429
    await limit_auth_attempts(request("GET"))
    _windows.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [None, "SALES", "OWNER"])
async def test_mcp_rechecks_current_membership(monkeypatch, role):
    from loomrun_api.qlix import mcp_server as srv
    from loomrun_api.qlix.context import mint_context, CONTEXT_HEADER
    from loomrun_api.ai_agent.tools.registry import all_tools
    token = mint_context(organization_id="org", user_id="user", role="OWNER", mode="advanced")
    monkeypatch.setattr(srv, "get_http_headers", lambda: {CONTEXT_HEADER: token})
    member = SimpleNamespace(role=role, organization=SimpleNamespace(suspended=False)) if role else None
    monkeypatch.setattr(srv, "prisma", SimpleNamespace(membership=SimpleNamespace(find_first=AsyncMock(return_value=member))))
    monkeypatch.setattr(srv, "is_access_locked", lambda org: False)
    spec = next(s for s in all_tools() if s.owner_only)
    handler = AsyncMock(return_value={})
    monkeypatch.setattr(spec, "handler", handler)
    result = await srv._tool_from_spec(spec).run({})
    if role == "OWNER":
        assert not result.is_error
        handler.assert_awaited_once()
    else:
        assert result.is_error
        handler.assert_not_awaited()


@pytest.mark.asyncio
async def test_cross_tenant_pipeline_assignment_rejected(monkeypatch):
    from loomrun_api import pipeline_routing as routing
    lookup = AsyncMock(return_value=None)
    monkeypatch.setattr(routing, "prisma", SimpleNamespace(pipeline=SimpleNamespace(find_first=lookup)))
    with pytest.raises(HTTPException) as exc:
        await routing.merge_pipeline_into_create_data({"pipelineId": "foreign", "pipelineStageId": "stage"}, organization_id="org")
    assert exc.value.status_code == 400
    assert lookup.call_args.kwargs["where"]["organizationId"] == "org"
    lookup.return_value = SimpleNamespace(stages=[SimpleNamespace(id="stage")])
    data = {"pipelineId": "own", "pipelineStageId": "stage"}
    assert await routing.merge_pipeline_into_create_data(data, organization_id="org") == data


@pytest.mark.asyncio
async def test_signup_allowlisted_email_is_not_admin(monkeypatch):
    from loomrun_api import document_template_defaults
    monkeypatch.setattr(settings, "super_admin_emails", "audit@example.com")
    db = SimpleNamespace(
        user=SimpleNamespace(find_unique=AsyncMock(return_value=None), create=AsyncMock(return_value=SimpleNamespace(id="user"))),
        organization=SimpleNamespace(find_unique=AsyncMock(return_value=None), create=AsyncMock(return_value=SimpleNamespace(id="org"))),
        membership=SimpleNamespace(create=AsyncMock()),
    )
    monkeypatch.setattr(auth, "prisma", db)
    monkeypatch.setattr(auth, "hash_password", lambda p: "hashed")
    monkeypatch.setattr(document_template_defaults, "seed_org_templates", AsyncMock())
    result = await auth.register(auth.RegisterBody(email="audit@example.com", password="test-password", organization_name="Audit"))
    assert result["access_token"]
    assert db.user.create.call_args.kwargs["data"]["isSuperAdmin"] is False
