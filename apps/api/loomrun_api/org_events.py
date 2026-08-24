"""One place to announce that an org's data changed.

Loomrun previously fired events only for the n8n automations, and only from
the lead routes. Two consumers now need them — n8n, and the Qlix Brain sync —
so the fan-out lives here and every service that changes data calls it.

Sync must never be able to fail a CRM write, so everything here is
fire-and-forget: a missed notification is picked up by the periodic sweep, a
failed save is not recoverable.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from loomrun_api.qlix import documents as qlix_docs
from loomrun_api.qlix import sync as qlix_sync

logger = logging.getLogger(__name__)

# Entity changes that also shift the rollup documents (pipeline counts and so
# on). Catalog and expense edits do not move those numbers, so they skip it.
_ROLLUP_TRIGGERS = {
    qlix_docs.ENTITY_LEAD,
    qlix_docs.ENTITY_QUOTATION,
    qlix_docs.ENTITY_PRODUCTION,
}


def record_changed(
    *,
    organization_id: str,
    entity_type: str,
    entity_id: str,
    deleted: bool = False,
    refresh_rollups: bool | None = None,
) -> None:
    """Flag a record so its Brain document gets refreshed (or removed)."""
    if not organization_id or not entity_id:
        return

    qlix_sync.mark_dirty_soon(
        organization_id=organization_id,
        entity_type=entity_type,
        entity_id=entity_id,
        op="delete" if deleted else "upsert",
    )

    should_refresh = (
        entity_type in _ROLLUP_TRIGGERS if refresh_rollups is None else refresh_rollups
    )
    if should_refresh:
        qlix_sync.mark_summaries_dirty(organization_id)


def emit(
    organization_id: str,
    event: str,
    data: dict[str, Any],
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    deleted: bool = False,
) -> None:
    """Announce a domain event to every consumer.

    ``event`` is the n8n automation name (``lead.created`` and friends).
    Passing ``entity_type``/``entity_id`` additionally refreshes that record in
    the org's AI Brain.
    """
    _emit_n8n(organization_id, event, data)
    if entity_type and entity_id:
        record_changed(
            organization_id=organization_id,
            entity_type=entity_type,
            entity_id=entity_id,
            deleted=deleted,
        )


def _emit_n8n(organization_id: str, event: str, data: dict[str, Any]) -> None:
    from loomrun_api.n8n_events import emit_automation_event

    try:
        asyncio.create_task(emit_automation_event(organization_id, event, data))
    except RuntimeError:
        logger.debug("No running loop; skipping n8n event %s", event)
