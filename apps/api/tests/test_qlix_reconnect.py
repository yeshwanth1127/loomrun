"""Tests for Qlix key verification and reconnect."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from loomrun_api.qlix import provisioner
from loomrun_api.qlix.client import QlixError


def test_qlix_error_unauthorized():
    exc = QlixError("nope", status_code=401, code="unauthorized")
    assert exc.unauthorized is True


@pytest.mark.asyncio
async def test_activate_returns_when_key_usable():
    row = AsyncMock(status="connected")
    with (
        patch("loomrun_api.qlix.provisioner.settings") as settings,
        patch("loomrun_api.qlix.provisioner.prisma") as prisma,
        patch("loomrun_api.qlix.provisioner.conn") as conn,
        patch("loomrun_api.qlix.provisioner._key_usable", AsyncMock(return_value=True)),
        patch("loomrun_api.qlix.provisioner.reconnect", AsyncMock()) as reconnect,
    ):
        settings.qlix_ready = True
        prisma.organization.find_unique = AsyncMock(return_value=AsyncMock(id="org1"))
        conn.ensure_row = AsyncMock(return_value=row)
        conn.STATUS_CONNECTED = "connected"
        conn.read_api_key = lambda _row: "qlix_live_test"
        conn.public_state = lambda _row: {"connected": True, "status": "connected"}

        result = await provisioner.activate(organization_id="org1")

    assert result["connected"] is True
    reconnect.assert_not_called()


@pytest.mark.asyncio
async def test_activate_reconnects_when_key_stale():
    row = AsyncMock(status="connected")
    with (
        patch("loomrun_api.qlix.provisioner.settings") as settings,
        patch("loomrun_api.qlix.provisioner.prisma") as prisma,
        patch("loomrun_api.qlix.provisioner.conn") as conn,
        patch("loomrun_api.qlix.provisioner._key_usable", AsyncMock(return_value=False)),
        patch(
            "loomrun_api.qlix.provisioner.reconnect",
            AsyncMock(return_value={"connected": True, "status": "connected", "key_valid": True}),
        ) as reconnect,
    ):
        settings.qlix_ready = True
        prisma.organization.find_unique = AsyncMock(return_value=AsyncMock(id="org1"))
        conn.ensure_row = AsyncMock(return_value=row)
        conn.STATUS_CONNECTED = "connected"
        conn.read_api_key = lambda _row: "qlix_live_stale"

        result = await provisioner.activate(organization_id="org1")

    reconnect.assert_awaited_once_with(organization_id="org1")
    assert result["connected"] is True


@pytest.mark.asyncio
async def test_reconnect_rotates_and_marks_connected():
    with (
        patch("loomrun_api.qlix.provisioner.settings") as settings,
        patch("loomrun_api.qlix.provisioner.prisma") as prisma,
        patch("loomrun_api.qlix.provisioner.conn") as conn,
        patch(
            "loomrun_api.qlix.provisioner._rotate_and_store_key",
            AsyncMock(return_value="qlix_live_new"),
        ),
        patch("loomrun_api.qlix.provisioner._key_usable", AsyncMock(return_value=True)),
    ):
        settings.qlix_ready = True
        prisma.organization.find_unique = AsyncMock(return_value=AsyncMock(id="org1"))
        conn.get_connection = AsyncMock(return_value=AsyncMock(status="connected"))
        conn.update_connection = AsyncMock()
        conn.public_state = lambda _row: {"connected": True, "status": "connected"}

        result = await provisioner.reconnect(organization_id="org1")

    conn.update_connection.assert_awaited()
    assert result["connected"] is True


@pytest.mark.asyncio
async def test_probe_key_false_on_unauthorized():
    row = AsyncMock(status="connected")
    with (
        patch("loomrun_api.qlix.provisioner.conn") as conn,
        patch(
            "loomrun_api.qlix.provisioner.qlix.auth_me",
            AsyncMock(side_effect=QlixError("bad", status_code=401, code="unauthorized")),
        ),
    ):
        conn.read_api_key = lambda _row: "qlix_live_bad"
        conn.STATUS_CONNECTED = "connected"

        assert await provisioner.probe_key(row) is False
