"""Order placed → Sales kanban Won."""

import pytest

from loomrun_api.pipeline_stage_move import mark_lead_won_on_order_placed
from prisma.enums import LeadStage


class _Lead:
    def __init__(self, stage):
        self.id = "lead1"
        self.organizationId = "org1"
        self.pipelineId = None
        self.pipelineStageId = None
        self.stage = stage


class _FakeDb:
    def __init__(self):
        self.updated = None
        self.activities = []
        self.lead = self
        self.pipeline = self
        self.leadactivity = self

    async def find_unique(self, **kwargs):
        return None

    async def update(self, *, where, data):
        self.updated = data
        return data

    async def create(self, *, data):
        self.activities.append(data)
        return data


@pytest.mark.asyncio
async def test_already_won_is_noop():
    db = _FakeDb()
    lead = _Lead(LeadStage.WON)
    result = await mark_lead_won_on_order_placed(
        db=db, lead=lead, user_id="u1", order_number="ORD-1"
    )
    assert result == LeadStage.WON
    assert db.updated is None
    assert db.activities == []
