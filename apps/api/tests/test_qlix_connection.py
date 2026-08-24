"""Json columns on QlixConnection must be wrapped for prisma-client-py."""

from __future__ import annotations

from prisma import fields

from loomrun_api.qlix import connection as conn


def test_plain_dict_is_wrapped_as_prisma_json():
    wrapped = conn._json_field({"queued": 3, "started_at": "2026-08-19T00:00:00+00:00"})
    assert isinstance(wrapped, fields.Json)
    assert wrapped.data["queued"] == 3


def test_already_wrapped_json_is_left_alone():
    original = fields.Json({"enc": "blob"})
    assert conn._json_field(original) is original


def test_none_stays_none():
    assert conn._json_field(None) is None
