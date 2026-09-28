#!/usr/bin/env python3
"""Focused E2E: order Ask-AI prompt + ORD- lookup against live Loomrun AI.

Run on the API host:
  cd /var/www/loomrun/apps/api
  set -a; source /var/www/loomrun/.env; set +a
  .venv/bin/python scripts/ai_e2e_order_attention.py
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

sys.path.insert(0, ".")

from loomrun_api.security import create_access_token  # noqa: E402

# Exora — the org that hit the ORD- / Procurement failures.
ORG_ID = "cmt1b8dwg0000v7gns81h2uel"
USER_ID = "cmt1b8dwn0001v7gn7kimd14b"
API_BASE = "http://127.0.0.1:8002/v1"
MODEL = "openai/gpt-4.1-mini"
TZ = "Asia/Kolkata"
ORDER_NUMBER = "ORD-2026-00001"


@dataclass
class CaseResult:
    case_id: str
    ok: bool
    latency_s: float
    reply: str = ""
    tools: list[str] = field(default_factory=list)
    error: str | None = None
    notes: list[str] = field(default_factory=list)


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {create_access_token(USER_ID)}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }


def run_stream(message: str, history: list[dict] | None = None) -> tuple[dict[str, Any], float, list[str]]:
    body = {
        "message": message,
        "model": MODEL,
        "timezone": TZ,
        "history": history or [],
    }
    req = urllib.request.Request(
        f"{API_BASE}/orgs/{ORG_ID}/ai/chat/stream",
        data=json.dumps(body).encode(),
        headers=_headers(),
        method="POST",
    )
    started = time.monotonic()
    tools: list[str] = []
    result: dict[str, Any] = {}
    with urllib.request.urlopen(req, timeout=180) as resp:
        buf = ""
        for raw in resp:
            line = raw.decode("utf-8", errors="replace")
            if line.startswith("data:"):
                payload = line[5:].strip()
                if not payload:
                    continue
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                et = event.get("type")
                if et == "tool" and event.get("tool", {}).get("name"):
                    tools.append(event["tool"]["name"])
                elif et == "done":
                    result = event
                elif et == "error":
                    raise RuntimeError(event.get("detail") or "stream error")
            buf += line
    return result, time.monotonic() - started, tools


def direct_get_order() -> dict[str, Any]:
    """Bypass the LLM — call the same service path tools use."""
    import asyncio

    from loomrun_api.prisma_client import prisma
    from loomrun_api.services import production as prod_svc

    async def _run():
        if not prisma.is_connected():
            await prisma.connect()
        return await prod_svc.get_production_order(
            organization_id=ORG_ID, order_id=ORDER_NUMBER
        )

    return asyncio.run(_run())


def main() -> int:
    results: list[CaseResult] = []

    # 1) Service-level ORD- lookup (no LLM)
    t0 = time.monotonic()
    try:
        order = direct_get_order()
        ok = order.get("order_number", "").upper() == ORDER_NUMBER
        results.append(
            CaseResult(
                case_id="S1_ord_lookup",
                ok=ok,
                latency_s=time.monotonic() - t0,
                reply=json.dumps(
                    {
                        "order_number": order.get("order_number"),
                        "stage": order.get("stage"),
                        "lead_title": order.get("lead_title"),
                    }
                ),
                notes=[] if ok else ["order_number mismatch"],
            )
        )
    except Exception as exc:  # noqa: BLE001
        results.append(
            CaseResult(
                case_id="S1_ord_lookup",
                ok=False,
                latency_s=time.monotonic() - t0,
                error=str(exc),
            )
        )

    # 2) Exact Ask-AI deep-link prompt (new wording)
    prompt_new = (
        f"About order {ORDER_NUMBER} for Raghu (production stage PROCUREMENT): "
        "what needs attention?"
    )
    t0 = time.monotonic()
    try:
        data, latency, tools = run_stream(prompt_new)
        reply = (data.get("reply") or "").strip()
        used_prod = any(
            t in tools
            for t in ("get_production_order", "list_production_orders", "update_production_order")
        )
        mentions = ORDER_NUMBER in reply or "procurement" in reply.lower() or "Raghu" in reply
        ok = used_prod and bool(reply) and "couldn't find" not in reply.lower()
        notes = []
        if not used_prod:
            notes.append(f"missing production tool; got {tools}")
        if not mentions:
            notes.append("reply did not clearly reference the order")
        if "couldn't find" in reply.lower() or "no production order" in reply.lower():
            notes.append("lookup failure leaked into reply")
            ok = False
        results.append(
            CaseResult(
                case_id="E1_ask_ai_order_prompt",
                ok=ok,
                latency_s=latency,
                reply=reply[:500],
                tools=tools,
                notes=notes,
            )
        )
    except Exception as exc:  # noqa: BLE001
        results.append(
            CaseResult(
                case_id="E1_ask_ai_order_prompt",
                ok=False,
                latency_s=time.monotonic() - t0,
                error=str(exc),
            )
        )

    # 3) Legacy UI wording (stage Procurement) — still common in history/bookmarks
    prompt_legacy = (
        f"About order {ORDER_NUMBER} for Raghu (stage Procurement): "
        "what needs attention?"
    )
    t0 = time.monotonic()
    try:
        data, latency, tools = run_stream(prompt_legacy)
        reply = (data.get("reply") or "").strip()
        used_prod = "get_production_order" in tools or "list_production_orders" in tools
        bad = any(
            s in reply.lower()
            for s in ("couldn't find", "unknown stage", "no lead matches")
        )
        ok = used_prod and bool(reply) and not bad
        notes = []
        if not used_prod:
            notes.append(f"missing production tool; got {tools}")
        if bad:
            notes.append("error language in reply")
        results.append(
            CaseResult(
                case_id="E2_legacy_procurement_label",
                ok=ok,
                latency_s=latency,
                reply=reply[:500],
                tools=tools,
                notes=notes,
            )
        )
    except Exception as exc:  # noqa: BLE001
        results.append(
            CaseResult(
                case_id="E2_legacy_procurement_label",
                ok=False,
                latency_s=time.monotonic() - t0,
                error=str(exc),
            )
        )

    # 4) Sanity: simple lead count still works
    t0 = time.monotonic()
    try:
        data, latency, tools = run_stream("How many leads do I have in total?")
        reply = (data.get("reply") or "").strip()
        ok = bool(reply) and any(t in tools for t in ("count_leads", "search_leads")) or (
            bool(reply) and any(ch.isdigit() for ch in reply)
        )
        results.append(
            CaseResult(
                case_id="E3_lead_count_sanity",
                ok=ok,
                latency_s=latency,
                reply=reply[:300],
                tools=tools,
            )
        )
    except Exception as exc:  # noqa: BLE001
        results.append(
            CaseResult(
                case_id="E3_lead_count_sanity",
                ok=False,
                latency_s=time.monotonic() - t0,
                error=str(exc),
            )
        )

    passed = sum(1 for r in results if r.ok)
    print(json.dumps(
        {
            "passed": passed,
            "total": len(results),
            "results": [
                {
                    "id": r.case_id,
                    "ok": r.ok,
                    "latency_s": round(r.latency_s, 2),
                    "tools": r.tools,
                    "error": r.error,
                    "notes": r.notes,
                    "reply": r.reply,
                }
                for r in results
            ],
        },
        indent=2,
    ))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
