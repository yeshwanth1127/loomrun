"""Keep each org's AI Brain in step with its Loomrun data.

Three overlapping layers, because no single one is sufficient:

1. ``mark_dirty`` — writes flag a record as stale. Cheap, fire-and-forget.
2. ``drain_queue`` — a background job pushes the flagged records to Qlix.
   Writes never wait on the network, and a Qlix outage just backs the queue up
   instead of breaking the dashboard.
3. ``sweep_org`` — a periodic pass that re-pushes anything changed since the
   last successful push.

Layer 3 is not redundancy. Layer 1 will never have full coverage: the Meta and
IndiaMart importers create leads outside the normal routes, and there are admin
paths and occasional direct database edits. Without the sweep, drift is silent
until the agent states something that stopped being true weeks ago.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from loomrun_api.config import settings
from loomrun_api.prisma_client import prisma
from loomrun_api.qlix import client as qlix
from loomrun_api.qlix import connection as conn
from loomrun_api.qlix import documents as docs

logger = logging.getLogger(__name__)

# How many queue rows one drain pass handles. Qlix allows 300 requests/minute
# per key; a batch this size leaves ample headroom for live chat on the same key.
BATCH_SIZE = 40
MAX_ATTEMPTS = 5
# Records touched during a sweep window, chunked so one huge org cannot stall
# every other org's turn in the queue.
SWEEP_PAGE = 200

STATUS_PENDING = "pending"
STATUS_DONE = "done"
STATUS_FAILED = "failed"


# ── Layer 1: marking records stale ────────────────────────────────────────────

async def mark_dirty(
    *,
    organization_id: str,
    entity_type: str,
    entity_id: str,
    op: str = "upsert",
) -> None:
    """Queue a record for re-push. Safe to call as often as you like.

    The unique constraint on (org, type, id, status) collapses repeat calls for
    the same record into one pending row, so editing a lead five times in a
    minute results in a single push rather than five.
    """
    if not organization_id or not entity_id:
        return
    # Nothing consumes the queue while Qlix is off, so queueing would only grow
    # a backlog of rows describing data that has since changed again.
    if not settings.qlix_enabled:
        return
    try:
        await prisma.qlixsyncqueue.upsert(
            where={
                "organizationId_entityType_entityId_status": {
                    "organizationId": organization_id,
                    "entityType": entity_type,
                    "entityId": entity_id,
                    "status": STATUS_PENDING,
                }
            },
            data={
                "create": {
                    "organizationId": organization_id,
                    "entityType": entity_type,
                    "entityId": entity_id,
                    "op": op,
                    "status": STATUS_PENDING,
                },
                # A delete supersedes a queued upsert: pushing a document we are
                # about to remove would leave the agent citing a dead record.
                "update": {"op": op} if op == "delete" else {},
            },
        )
    except Exception:
        logger.exception(
            "Could not queue Qlix sync for org=%s %s/%s",
            organization_id,
            entity_type,
            entity_id,
        )


def mark_dirty_soon(
    *,
    organization_id: str,
    entity_type: str,
    entity_id: str,
    op: str = "upsert",
) -> None:
    """Fire-and-forget wrapper for request handlers.

    Sync must never be able to fail a CRM write, so this deliberately swallows
    everything: a missed flag is picked up by the sweep, a failed save is not.
    """

    async def _run() -> None:
        await mark_dirty(
            organization_id=organization_id,
            entity_type=entity_type,
            entity_id=entity_id,
            op=op,
        )

    try:
        asyncio.create_task(_run())
    except RuntimeError:
        logger.debug("No running loop; skipping Qlix dirty-mark for %s", entity_id)


def mark_summaries_dirty(organization_id: str) -> None:
    """Rollups depend on many records, so refresh them after any structural change."""
    for entity in docs.SUMMARY_ENTITIES:
        mark_dirty_soon(
            organization_id=organization_id,
            entity_type=entity,
            entity_id=docs.SUMMARY_KEY,
        )


# ── Layer 2: pushing to Qlix ──────────────────────────────────────────────────

async def push_one(
    *,
    api_key: str,
    collection_id: str | None,
    organization_id: str,
    entity_type: str,
    entity_id: str,
    op: str,
) -> str:
    """Push a single record. Returns a short outcome for logging."""
    ext_id = docs.external_id(entity_type, entity_id)

    if op == "delete":
        try:
            await qlix.delete_document_by_external_id(api_key, ext_id)
        except qlix.QlixError as exc:
            # Already gone is the desired end state, not a failure.
            if exc.status_code == 404:
                return "already-absent"
            raise
        return "deleted"

    rendered = await docs.render(
        organization_id=organization_id, entity_type=entity_type, entity_id=entity_id
    )
    if rendered is None:
        # The record vanished between being queued and being rendered. Remove
        # any document we previously pushed for it rather than leaving a stale one.
        try:
            await qlix.delete_document_by_external_id(api_key, ext_id)
        except qlix.QlixError as exc:
            if exc.status_code != 404:
                raise
        return "vanished"

    result = await qlix.ingest_document(
        api_key,
        title=rendered["title"],
        body_text=rendered["body"],
        external_id=rendered["external_id"],
        collection_id=collection_id,
    )
    return "replaced" if result.get("replaced") else "created"


# Claim rows atomically. The API runs several uvicorn workers and each one
# drains on its own timer, so a plain "select then process" would hand the same
# record to two workers: duplicate ingest calls against the org's rate limit,
# and a delete race afterwards. SKIP LOCKED gives each worker a disjoint batch.
_CLAIM_SQL = """
UPDATE qlix_sync_queue SET status = $2, updated_at = NOW()
WHERE id IN (
    SELECT id FROM qlix_sync_queue
    WHERE status = $1
    ORDER BY created_at
    LIMIT $3
    FOR UPDATE SKIP LOCKED
)
RETURNING id, organization_id, entity_type, entity_id, op, attempts
"""

STATUS_PROCESSING = "processing"


class _Claimed:
    """A queue row this worker owns for the duration of the pass."""

    __slots__ = ("id", "organizationId", "entityType", "entityId", "op", "attempts")

    def __init__(self, row: dict[str, Any]) -> None:
        self.id = row["id"]
        self.organizationId = row["organization_id"]
        self.entityType = row["entity_type"]
        self.entityId = row["entity_id"]
        self.op = row["op"]
        self.attempts = row["attempts"]


async def _release(row: _Claimed, **fields: Any) -> None:
    """Hand a claimed row back, so a crash mid-pass does not strand it."""
    try:
        await prisma.qlixsyncqueue.update(where={"id": row.id}, data=fields)
    except Exception:
        logger.exception("Could not release Qlix queue row %s", row.id)


async def drain_queue(limit: int = BATCH_SIZE) -> dict[str, int]:
    """Process pending queue rows across all connected orgs."""
    claimed = await prisma.query_raw(
        _CLAIM_SQL, STATUS_PENDING, STATUS_PROCESSING, limit
    )
    rows = [_Claimed(r) for r in (claimed or [])]
    if not rows:
        return {"processed": 0, "failed": 0, "skipped": 0}

    # One key lookup per org rather than per row.
    keys: dict[str, tuple[str, str | None] | None] = {}
    processed = failed = skipped = 0
    touched_orgs: set[str] = set()

    for row in rows:
        org_id = row.organizationId
        if org_id not in keys:
            connection = await conn.get_connection(org_id)
            api_key = conn.read_api_key(connection)
            # Provisioning orgs already have a key and a queued backfill —
            # push those rows. Only drop disconnected orgs with no key.
            if not connection or not api_key or connection.status == conn.STATUS_DISCONNECTED:
                keys[org_id] = None
            else:
                keys[org_id] = (api_key, connection.collectionId)

        entry = keys[org_id]
        if entry is None:
            # Org is not on Qlix (or was disconnected). Drop the row instead of
            # retrying forever — a fresh activation backfills from scratch.
            try:
                await prisma.qlixsyncqueue.delete(where={"id": row.id})
            except Exception:
                logger.debug("Queue row %s already gone", row.id)
            skipped += 1
            continue

        api_key, collection_id = entry
        try:
            outcome = await push_one(
                api_key=api_key,
                collection_id=collection_id,
                organization_id=org_id,
                entity_type=row.entityType,
                entity_id=row.entityId,
                op=row.op,
            )
        except qlix.QlixError as exc:
            attempts = row.attempts + 1
            # Give up on a request Qlix will keep rejecting; keep retrying the
            # ones that might succeed later (rate limits, outages).
            give_up = attempts >= MAX_ATTEMPTS or not exc.retryable
            await _release(
                row,
                attempts=attempts,
                lastError=str(exc)[:2000],
                status=STATUS_FAILED if give_up else STATUS_PENDING,
            )
            failed += 1
            if exc.rate_limited:
                # Back off for the rest of this pass rather than burning the
                # org's request budget that live chat also needs. Anything still
                # claimed goes back on the queue for the next pass.
                logger.warning("Qlix rate limited org %s; pausing this drain pass", org_id)
                for pending_row in rows[rows.index(row) + 1 :]:
                    await _release(pending_row, status=STATUS_PENDING)
                break
            continue
        except Exception:
            logger.exception("Qlix sync failed for %s/%s", row.entityType, row.entityId)
            await _release(
                row,
                attempts=row.attempts + 1,
                lastError="internal error",
                status=STATUS_PENDING,
            )
            failed += 1
            continue

        try:
            await prisma.qlixsyncqueue.delete(where={"id": row.id})
        except Exception:
            logger.debug("Queue row %s already removed", row.id)
        processed += 1
        touched_orgs.add(org_id)
        logger.debug("Qlix sync %s %s/%s", outcome, row.entityType, row.entityId)

    for org_id in touched_orgs:
        try:
            await conn.mark_synced(org_id)
        except Exception:
            logger.exception("Could not stamp Qlix sync time for org %s", org_id)

    return {"processed": processed, "failed": failed, "skipped": skipped}


# ── Layer 3: the catch-up sweep ───────────────────────────────────────────────

_SWEEP_MODELS = {
    docs.ENTITY_LEAD: lambda: prisma.lead,
    docs.ENTITY_QUOTATION: lambda: prisma.quotation,
    docs.ENTITY_PRODUCTION: lambda: prisma.productionorder,
    docs.ENTITY_CATALOG: lambda: prisma.catalogitem,
    docs.ENTITY_EXPENSE: lambda: prisma.expense,
}


async def sweep_org(organization_id: str, *, since: datetime | None = None) -> dict[str, int]:
    """Re-queue everything changed since the last sweep.

    Catches records created by paths that never fired a write hook — bulk lead
    imports especially.
    """
    connection = await conn.get_connection(organization_id)
    if not connection or connection.status != conn.STATUS_CONNECTED:
        return {"queued": 0}

    cutoff = since or connection.lastSweepAt
    where: dict[str, Any] = {"organizationId": organization_id}
    if cutoff:
        # Small overlap so a record saved mid-sweep is not missed.
        where["updatedAt"] = {"gte": cutoff - timedelta(minutes=5)}

    queued = 0
    for entity_type, model_fn in _SWEEP_MODELS.items():
        skip = 0
        while True:
            rows = await model_fn().find_many(
                where=where, take=SWEEP_PAGE, skip=skip, order={"updatedAt": "asc"}
            )
            if not rows:
                break
            for row in rows:
                await mark_dirty(
                    organization_id=organization_id,
                    entity_type=entity_type,
                    entity_id=row.id,
                )
                queued += 1
            if len(rows) < SWEEP_PAGE:
                break
            skip += SWEEP_PAGE

    # Rollups are cheap and always worth refreshing.
    for entity in docs.SUMMARY_ENTITIES:
        await mark_dirty(
            organization_id=organization_id,
            entity_type=entity,
            entity_id=docs.SUMMARY_KEY,
        )
        queued += 1

    await conn.update_connection(organization_id, lastSweepAt=datetime.now(timezone.utc))
    logger.info("Qlix sweep queued %d documents for org %s", queued, organization_id)
    return {"queued": queued}


async def sweep_all_orgs() -> dict[str, int]:
    connections = await prisma.qlixconnection.find_many(
        where={"status": conn.STATUS_CONNECTED}
    )
    total = 0
    for row in connections:
        try:
            result = await sweep_org(row.organizationId)
            total += result["queued"]
        except Exception:
            logger.exception("Qlix sweep failed for org %s", row.organizationId)
    return {"orgs": len(connections), "queued": total}


# ── Backfill ──────────────────────────────────────────────────────────────────

async def backfill_org(organization_id: str) -> dict[str, int]:
    """Queue an org's entire dataset after activation.

    This only enqueues; the normal drain does the pushing, so a large org's
    first load is paced by the same batching that protects the rate limit and
    never blocks the Activate button.
    """
    queued = 0
    for entity in docs.SUMMARY_ENTITIES:
        await mark_dirty(
            organization_id=organization_id,
            entity_type=entity,
            entity_id=docs.SUMMARY_KEY,
        )
        queued += 1

    for entity_type in docs.RECORD_ENTITIES:
        model_fn = _SWEEP_MODELS[entity_type]
        skip = 0
        while True:
            rows = await model_fn().find_many(
                where={"organizationId": organization_id},
                take=SWEEP_PAGE,
                skip=skip,
                order={"updatedAt": "desc"},
            )
            if not rows:
                break
            for row in rows:
                await mark_dirty(
                    organization_id=organization_id,
                    entity_type=entity_type,
                    entity_id=row.id,
                )
                queued += 1
            if len(rows) < SWEEP_PAGE:
                break
            skip += SWEEP_PAGE

    now = datetime.now(timezone.utc)
    await conn.update_connection(
        organization_id,
        backfillState={"queued": queued, "started_at": now.isoformat()},
        lastSweepAt=now,
    )
    logger.info("Qlix backfill queued %d documents for org %s", queued, organization_id)
    return {"queued": queued}


async def sync_progress(organization_id: str) -> dict[str, Any]:
    """Queue depth for the UI, so users can see sync is alive and catching up."""
    pending = await prisma.qlixsyncqueue.count(
        where={
            "organizationId": organization_id,
            "status": {"in": [STATUS_PENDING, STATUS_PROCESSING]},
        }
    )
    failed = await prisma.qlixsyncqueue.count(
        where={"organizationId": organization_id, "status": STATUS_FAILED}
    )
    connection = await conn.get_connection(organization_id)
    return {
        "pending": pending,
        "failed": failed,
        "last_synced_at": (
            connection.lastSyncedAt.isoformat()
            if connection and connection.lastSyncedAt
            else None
        ),
        "backfill_done": bool(connection and connection.backfillDoneAt),
    }
