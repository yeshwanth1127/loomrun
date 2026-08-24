"""Standing approvals trade a confirmation click for broader authority.

That trade is only safe if the boundaries hold exactly: per tool, per org,
time-limited, and revocable. These test those boundaries rather than the happy
path, because the happy path failing is visible and these failing is not.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from loomrun_api.qlix import chat as qlix_chat
from loomrun_api.qlix import client as qlix
from loomrun_api.qlix import grants


class _Row:
    """Stand-in for a QlixToolGrant row."""

    def __init__(self, tool="create_lead", hours=24, org="org_a", grant_id="g1"):
        self.id = grant_id
        self.organizationId = org
        self.tool = tool
        self.userId = "u1"
        self.expiresAt = datetime.now(timezone.utc) + timedelta(hours=hours)
        self.useCount = 0
        self.lastUsedAt = None


def test_grant_ttl_is_24_hours():
    assert grants.GRANT_TTL_HOURS == 24


def test_serialize_reports_remaining_time():
    data = grants.serialize(_Row(hours=24))
    assert 23 * 3600 < data["expires_in_seconds"] <= 24 * 3600
    assert data["tool"] == "create_lead"
    assert data["label"] == "create lead"


def test_a_naive_timestamp_is_treated_as_utc():
    """Postgres returns naive datetimes; a wrong assumption here would either
    expire a live grant or keep a dead one alive."""
    row = _Row()
    row.expiresAt = (datetime.now(timezone.utc) + timedelta(hours=5)).replace(tzinfo=None)
    assert grants.serialize(row)["expires_in_seconds"] > 4 * 3600


@pytest.mark.asyncio
async def test_expired_grant_does_not_auto_approve(monkeypatch):
    """The whole point of the time limit."""
    deleted: list[str] = []

    class _Model:
        async def find_unique(self, where):
            return _Row(hours=-1)  # already expired

        async def delete(self, where):
            deleted.append(where["id"])

    monkeypatch.setattr(grants.prisma, "qlixtoolgrant", _Model())
    assert await grants.find_active(organization_id="org_a", tool="create_lead") is None
    assert deleted == ["g1"], "an expired grant should be cleaned up, not left visible"


@pytest.mark.asyncio
async def test_a_grant_for_one_tool_does_not_cover_another(monkeypatch):
    """Approving a quotation must never authorise an invoice."""
    lookups: list[dict] = []

    class _Model:
        async def find_unique(self, where):
            key = where["organizationId_tool"]
            lookups.append(key)
            return _Row(tool="create_quotation") if key["tool"] == "create_quotation" else None

    monkeypatch.setattr(grants.prisma, "qlixtoolgrant", _Model())

    assert await grants.find_active(organization_id="org_a", tool="create_quotation")
    assert await grants.find_active(organization_id="org_a", tool="send_invoice") is None
    assert {k["tool"] for k in lookups} == {"create_quotation", "send_invoice"}


@pytest.mark.asyncio
async def test_lookup_is_scoped_to_the_organization(monkeypatch):
    """One org's standing approval must never apply to another's agent."""
    seen: list[str] = []

    class _Model:
        async def find_unique(self, where):
            seen.append(where["organizationId_tool"]["organizationId"])
            return None

    monkeypatch.setattr(grants.prisma, "qlixtoolgrant", _Model())
    await grants.find_active(organization_id="org_b", tool="create_lead")
    assert seen == ["org_b"]


# ── The chat-side behaviour ───────────────────────────────────────────────────

def _jit_payload():
    return {
        "message": qlix_chat.JIT_MESSAGE,
        "jitRequestId": "jit-1",
        "tool": {"name": "create_lead", "arguments": {"title": "Acme"}},
    }


@pytest.mark.asyncio
async def test_a_live_grant_approves_without_asking(monkeypatch):
    decided: list[tuple[str, bool]] = []
    used: list[str] = []

    async def fake_decide(_key, *, jit_request_id, approved):
        decided.append((jit_request_id, approved))
        return {}

    async def fake_find(*, organization_id, tool):
        return _Row(tool=tool)

    monkeypatch.setattr(qlix, "jit_decide", fake_decide)
    monkeypatch.setattr(grants, "find_active", fake_find)
    monkeypatch.setattr(grants, "record_use", lambda gid: used.append(gid) or _noop())

    pending, auto = await qlix_chat._record_pending(
        organization_id="org_a",
        user_id="u1",
        api_key="k",
        payload=_jit_payload(),
        run_id="run-1",
    )
    assert pending is None, "a covered action should not ask again"
    assert auto and auto["tool"] == "create_lead"
    assert decided == [("jit-1", True)]
    assert used == ["g1"], "the auto-approved action must be counted against the grant"


async def _noop():
    return None


@pytest.mark.asyncio
async def test_without_a_grant_the_user_is_still_asked(monkeypatch):
    created: list[dict] = []

    async def fake_find(*, organization_id, tool):
        return None

    async def fake_create(**kwargs):
        created.append(kwargs)
        return {"id": "pa1", "tool": kwargs["tool"], "summary": kwargs["summary"]}

    monkeypatch.setattr(grants, "find_active", fake_find)
    monkeypatch.setattr(qlix_chat.pending_store, "create_pending_action", fake_create)

    pending, auto = await qlix_chat._record_pending(
        organization_id="org_a",
        user_id="u1",
        api_key="k",
        payload=_jit_payload(),
        run_id="run-1",
    )
    assert auto is None
    assert pending and pending["tool"] == "create_lead"
    assert created[0]["jit_request_id"] == "jit-1"


@pytest.mark.asyncio
async def test_if_auto_approval_fails_we_ask_rather_than_hang(monkeypatch):
    """A failed auto-approval must not leave the agent waiting on nobody."""

    async def fake_find(*, organization_id, tool):
        return _Row(tool=tool)

    async def failing_decide(_key, *, jit_request_id, approved):
        raise qlix.QlixError("upstream refused", status_code=500)

    created: list[dict] = []

    async def fake_create(**kwargs):
        created.append(kwargs)
        return {"id": "pa1", "tool": kwargs["tool"], "summary": kwargs["summary"]}

    monkeypatch.setattr(grants, "find_active", fake_find)
    monkeypatch.setattr(qlix, "jit_decide", failing_decide)
    monkeypatch.setattr(qlix_chat.pending_store, "create_pending_action", fake_create)

    pending, auto = await qlix_chat._record_pending(
        organization_id="org_a",
        user_id="u1",
        api_key="k",
        payload=_jit_payload(),
        run_id="run-1",
    )
    assert auto is None
    assert pending is not None, "should fall back to asking the user"
