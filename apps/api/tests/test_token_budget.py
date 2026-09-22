"""Token-budget guards: result trimming, cache-aware credits, forced-read limit."""

import json

from loomrun_api.ai_agent.crm_read_enforce import infer_search_leads_args
from loomrun_api.ai_agent.service import _MAX_TOOL_RESULT_CHARS, _tool_result_text
from loomrun_api.ai_usage import (
    DEFAULT_ESTIMATED_CREDITS,
    credits_from_tokens,
    parse_cached_tokens,
)


def _lead(i: int) -> dict:
    return {
        "id": f"cmsbqx712000{i}",
        "title": f"Lead {i}",
        "company": "JSW Steel LTD",
        "phone": "+918951079333",
        "city": "Bangalore",
        "stage": "QUALIFICATION",
        "leadStatus": "ACTIVE",
        "estimatedValue": 100000,
        "source": "META",
        "notes": "interested in corporate polo shirts for the winter range",
    }


class TestToolResultTrimming:
    def test_small_payload_is_untouched(self):
        payload = {"status": "ok", "result": {"total": 703, "by_stage": {"NEW": 183}}}
        assert _tool_result_text(payload) == json.dumps(payload)

    def test_large_roster_is_trimmed_under_cap(self):
        payload = {
            "status": "ok",
            "result": {"total": 703, "items": [_lead(i) for i in range(50)]},
        }
        out = _tool_result_text(payload)
        assert len(out) <= _MAX_TOOL_RESULT_CHARS
        assert len(out) < len(json.dumps(payload))

    def test_total_survives_trimming(self):
        """Tool descriptions promise `total` is authoritative — it must not be lost."""
        payload = {
            "status": "ok",
            "result": {"total": 703, "items": [_lead(i) for i in range(50)]},
        }
        result = json.loads(_tool_result_text(payload))["result"]
        assert result["total"] == 703
        assert 0 < len(result["items"]) < 50
        assert "authoritative" in result["_truncated"]

    def test_payload_without_rows_still_capped(self):
        payload = {"status": "ok", "result": {"blob": "x" * 9000}}
        out = _tool_result_text(payload)
        assert len(out) <= _MAX_TOOL_RESULT_CHARS + len("…[truncated]")


class TestCacheAwareCredits:
    def test_uncached_behaviour_unchanged(self):
        assert credits_from_tokens(6187, 114) == 7

    def test_cached_prefix_costs_less(self):
        uncached = credits_from_tokens(6187, 114)
        cached = credits_from_tokens(6187, 114, 4950)
        assert cached < uncached

    def test_cached_cannot_exceed_prompt(self):
        assert credits_from_tokens(100, 0, 10_000) == credits_from_tokens(100, 0, 100)

    def test_zero_llm_turn_is_free(self):
        assert credits_from_tokens(0, 0, no_llm=True) == 0

    def test_unknown_usage_still_falls_back(self):
        assert credits_from_tokens(0, 0) == DEFAULT_ESTIMATED_CREDITS

    def test_never_free_by_accident(self):
        assert credits_from_tokens(1, 0) >= 1


class TestCachedTokenParsing:
    def test_openai_shape(self):
        usage = {"prompt_tokens": 9000, "prompt_tokens_details": {"cached_tokens": 8000}}
        assert parse_cached_tokens(usage) == 8000

    def test_flat_shape(self):
        assert parse_cached_tokens({"cached_tokens": 512}) == 512

    def test_absent_is_zero(self):
        assert parse_cached_tokens({"prompt_tokens": 10}) == 0
        assert parse_cached_tokens(None) == 0


class TestForcedReadLimit:
    def test_forced_read_does_not_pull_a_full_roster(self):
        args = infer_search_leads_args("list the won leads", timezone="Asia/Kolkata")
        assert args["limit"] <= 15
