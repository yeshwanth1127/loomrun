"""Sync behaviour that keeps the Brain honest.

The failure mode that matters most is not a missing document but a stale one:
the agent citing a lead that changed or was deleted. These cover the paths that
prevent that.
"""

from __future__ import annotations

import pytest

from loomrun_api.qlix import client as qlix
from loomrun_api.qlix import documents as docs
from loomrun_api.qlix import sync


def test_external_ids_are_stable_and_namespaced():
    """Stability is what makes Qlix's replace-by-externalId upsert work."""
    assert docs.external_id(docs.ENTITY_LEAD, "abc") == "loomrun:lead:abc"
    assert docs.external_id(docs.ENTITY_LEAD, "abc") == docs.external_id(
        docs.ENTITY_LEAD, "abc"
    )
    # Different record types never collide on the same id.
    assert docs.external_id(docs.ENTITY_LEAD, "1") != docs.external_id(
        docs.ENTITY_QUOTATION, "1"
    )


def test_every_synced_entity_has_a_renderer():
    """A queued entity with no renderer would silently never reach the Brain."""
    for entity in docs.RECORD_ENTITIES:
        assert entity in docs._RECORD_RENDERERS, entity
    for entity in docs.SUMMARY_ENTITIES:
        assert entity in docs._SUMMARY_RENDERERS, entity


def test_every_synced_entity_can_be_swept():
    """The catch-up sweep must cover everything the write hooks can queue."""
    for entity in docs.RECORD_ENTITIES:
        assert entity in sync._SWEEP_MODELS, entity


@pytest.mark.asyncio
async def test_delete_removes_the_document(monkeypatch):
    deleted: list[str] = []

    async def fake_delete(_key, ext_id):
        deleted.append(ext_id)
        return {}

    monkeypatch.setattr(qlix, "delete_document_by_external_id", fake_delete)
    outcome = await sync.push_one(
        api_key="k",
        collection_id="c",
        organization_id="org",
        entity_type=docs.ENTITY_LEAD,
        entity_id="lead_1",
        op="delete",
    )
    assert outcome == "deleted"
    assert deleted == ["loomrun:lead:lead_1"]


@pytest.mark.asyncio
async def test_deleting_an_absent_document_is_not_an_error(monkeypatch):
    """Already gone is the desired end state, not a failure worth retrying."""

    async def fake_delete(_key, _ext_id):
        raise qlix.QlixError("gone", status_code=404, code="not_found")

    monkeypatch.setattr(qlix, "delete_document_by_external_id", fake_delete)
    outcome = await sync.push_one(
        api_key="k",
        collection_id="c",
        organization_id="org",
        entity_type=docs.ENTITY_LEAD,
        entity_id="lead_1",
        op="delete",
    )
    assert outcome == "already-absent"


@pytest.mark.asyncio
async def test_a_record_deleted_before_its_push_is_removed_not_left_stale(monkeypatch):
    """The race that would otherwise leave the agent citing a deleted lead."""
    deleted: list[str] = []

    async def fake_render(**_kwargs):
        return None  # record vanished between queueing and rendering

    async def fake_delete(_key, ext_id):
        deleted.append(ext_id)
        return {}

    monkeypatch.setattr(docs, "render", fake_render)
    monkeypatch.setattr(qlix, "delete_document_by_external_id", fake_delete)

    outcome = await sync.push_one(
        api_key="k",
        collection_id="c",
        organization_id="org",
        entity_type=docs.ENTITY_LEAD,
        entity_id="lead_gone",
        op="upsert",
    )
    assert outcome == "vanished"
    assert deleted == ["loomrun:lead:lead_gone"]


@pytest.mark.asyncio
async def test_upsert_reports_whether_it_replaced(monkeypatch):
    async def fake_render(**_kwargs):
        return {"title": "Lead", "body": "body", "external_id": "loomrun:lead:x"}

    async def fake_ingest(_key, **kwargs):
        assert kwargs["external_id"] == "loomrun:lead:x"
        return {"replaced": True}

    monkeypatch.setattr(docs, "render", fake_render)
    monkeypatch.setattr(qlix, "ingest_document", fake_ingest)

    outcome = await sync.push_one(
        api_key="k",
        collection_id="c",
        organization_id="org",
        entity_type=docs.ENTITY_LEAD,
        entity_id="x",
        op="upsert",
    )
    assert outcome == "replaced"


def test_rollup_triggers_do_not_include_noise():
    """Catalog and expense edits do not move pipeline counts, so skip the rebuild."""
    from loomrun_api import org_events

    assert docs.ENTITY_LEAD in org_events._ROLLUP_TRIGGERS
    assert docs.ENTITY_QUOTATION in org_events._ROLLUP_TRIGGERS
    assert docs.ENTITY_CATALOG not in org_events._ROLLUP_TRIGGERS
    assert docs.ENTITY_EXPENSE not in org_events._ROLLUP_TRIGGERS
