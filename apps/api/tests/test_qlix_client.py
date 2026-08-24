"""SSE parsing and error mapping for the Qlix client.

Qlix's docs warn that frames must be paired by their ``event:`` name rather
than by position, so the parser is tested against the awkward shapes rather
than only the happy path.
"""

from __future__ import annotations

import httpx
import pytest

from loomrun_api.qlix import client as qlix


class _FakeStream:
    """Minimal stand-in for httpx's streaming response."""

    def __init__(self, lines: list[str], status_code: int = 200):
        self.status_code = status_code
        self._lines = lines
        self.request = httpx.Request("GET", "https://example.test/stream")

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aread(self):
        return b""


class _FakeClient:
    def __init__(self, stream: _FakeStream):
        self._stream = stream

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def stream(self, *_args, **_kwargs):
        stream = self._stream

        class _Ctx:
            async def __aenter__(self):
                return stream

            async def __aexit__(self, *exc):
                return False

        return _Ctx()


async def _collect(lines: list[str]) -> list[tuple[str, dict]]:
    stream = _FakeStream(lines)
    original = qlix.httpx.AsyncClient
    qlix.httpx.AsyncClient = lambda *a, **k: _FakeClient(stream)  # type: ignore[assignment]
    try:
        return [
            frame
            async for frame in qlix.stream_run(
                "qlix_live_x", agent_id="agent", run_id="run"
            )
        ]
    finally:
        qlix.httpx.AsyncClient = original  # type: ignore[assignment]


@pytest.mark.asyncio
async def test_parses_the_documented_event_sequence():
    frames = await _collect([
        "event: status", 'data: {"state":"running"}', "",
        "event: delta", 'data: {"data":"Hello"}', "",
        "event: delta", 'data: {"data":" world"}', "",
        "event: done", 'data: {"status":"success","assistant":"Hello world"}', "",
    ])
    assert [name for name, _ in frames] == ["status", "delta", "delta", "done"]
    assert frames[1][1]["data"] == "Hello"
    assert frames[3][1]["assistant"] == "Hello world"


@pytest.mark.asyncio
async def test_stream_stops_after_done():
    """Anything after the terminal frame belongs to no turn and must be ignored."""
    frames = await _collect([
        "event: done", 'data: {"status":"success"}', "",
        "event: delta", 'data: {"data":"leaked"}', "",
    ])
    assert len(frames) == 1
    assert frames[0][0] == "done"


@pytest.mark.asyncio
async def test_event_name_does_not_leak_into_the_next_frame():
    """A data-only frame must not inherit the previous frame's event name."""
    frames = await _collect([
        "event: delta", 'data: {"data":"a"}', "",
        'data: {"data":"orphan"}', "",
        "event: done", 'data: {"status":"success"}', "",
    ])
    names = [name for name, _ in frames]
    assert names == ["delta", "message", "done"]


@pytest.mark.asyncio
async def test_keepalive_comments_and_blank_lines_are_ignored():
    frames = await _collect([
        ": keep-alive", "",
        "event: delta", 'data: {"data":"x"}', "",
        "event: done", 'data: {"status":"success"}', "",
    ])
    assert [name for name, _ in frames] == ["delta", "done"]


@pytest.mark.asyncio
async def test_non_json_data_is_still_delivered():
    frames = await _collect([
        "event: delta", "data: plain text", "",
        "event: done", 'data: {"status":"success"}', "",
    ])
    assert frames[0][1] == {"data": "plain text"}


@pytest.mark.asyncio
async def test_multiline_data_is_joined():
    frames = await _collect([
        "event: done", 'data: {"status":', 'data: "success"}', "",
    ])
    assert frames[0][1]["status"] == "success"


# ── Error mapping ─────────────────────────────────────────────────────────────

def _error_response(status_code: int, code: str, message: str = "boom") -> httpx.Response:
    return httpx.Response(
        status_code,
        json={"error": {"code": code, "message": message}},
        request=httpx.Request("POST", "https://example.test/x"),
    )


def test_already_provisioned_is_recognised():
    with pytest.raises(qlix.QlixError) as exc:
        qlix._raise_for_error(_error_response(409, "already_provisioned"))
    assert exc.value.already_provisioned


def test_rate_limit_is_retryable_but_a_bad_request_is_not():
    with pytest.raises(qlix.QlixError) as limited:
        qlix._raise_for_error(_error_response(429, "rate_limited"))
    assert limited.value.retryable

    with pytest.raises(qlix.QlixError) as invalid:
        qlix._raise_for_error(_error_response(400, "invalid_body"))
    assert not invalid.value.retryable


def test_scope_errors_tell_the_user_what_to_do():
    with pytest.raises(qlix.QlixError) as exc:
        qlix._raise_for_error(_error_response(403, "insufficient_scope"))
    assert "Reconnect" in str(exc.value)


def test_cloud_agent_payload_is_valid_for_qlix():
    body = qlix._cloud_agent_payload(
        name="Acme assistant",
        model="openrouter/openai/gpt-4o-mini",
        description="Help with CRM.",
    )
    assert body["runtime"] == "cloud"
    assert body["llmMode"] == "proxy"
    assert body["llmProvider"] == "openrouter"
    assert body["localInferenceMode"] is None
    assert body["permissionScopes"] == ["brain.query"]
    assert body["model"] == "openrouter/openai/gpt-4o-mini"


def test_unprefixed_model_is_assumed_openrouter():
    body = qlix._cloud_agent_payload(name="A", model="openai/gpt-4o-mini")
    assert body["model"] == "openrouter/openai/gpt-4o-mini"
    assert body["llmProvider"] == "openrouter"
