"""Regression tests for CEO dashboard follow-up counts."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from loomrun_api.routers import dashboard


@pytest.mark.asyncio
async def test_stale_follow_up_date_is_ignored_when_latest_call_is_not_follow_up(monkeypatch):
    leads = [SimpleNamespace(id="cleared"), SimpleNamespace(id="active")]
    calls = [
        SimpleNamespace(leadId="cleared", outcome="ORDER_CONFIRMED"),
        SimpleNamespace(leadId="cleared", outcome="CALLBACK_SCHEDULED"),
        SimpleNamespace(leadId="active", outcome="CALLBACK_SCHEDULED"),
    ]
    fake_prisma = SimpleNamespace(
        lead=SimpleNamespace(find_many=AsyncMock(return_value=leads)),
        telecallercalllog=SimpleNamespace(find_many=AsyncMock(return_value=calls)),
    )
    monkeypatch.setattr(dashboard, "prisma", fake_prisma)

    count = await dashboard._count_active_followups(
        organization_id="org-1", before=dashboard.datetime.now(dashboard.timezone.utc)
    )

    assert count == 1
