"""CEO dashboard metrics for the AI agent.

Delegates to the same builder the CEO Dashboard screen reads, so a number the
agent quotes is the number on the screen.
"""

from __future__ import annotations

from typing import Any


async def get_ceo_dashboard(
    *, organization_id: str, day: str | None = "all"
) -> dict[str, Any]:
    from loomrun_api.routers.dashboard import build_ceo_dashboard

    return await build_ceo_dashboard(organization_id=organization_id, day=day)
