"""HTTP client for the Qlix Developer API.

Two credentials are in play and they are deliberately kept apart:

* ``settings.qlix_partner_key`` (``qlix_partner_*``) provisions tenants. It is
  never used for anything else.
* Each org's ``qlix_live_*`` key does all the rest. It is bound to that org's
  workspace, so passing it is what scopes a call to one tenant.

Qlix returns errors as ``{"error": {"code", "message"}}``; those become
:class:`QlixError` with the code preserved so callers can branch on
``already_provisioned``, ``rate_limited`` and friends.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

import httpx

from loomrun_api.config import settings

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 60.0
# Runs stream for as long as the agent is thinking; only cap the connect phase.
STREAM_TIMEOUT = httpx.Timeout(None, connect=15.0)
UPLOAD_TIMEOUT = 180.0


class QlixError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code or ""

    @property
    def already_provisioned(self) -> bool:
        return self.code == "already_provisioned" or self.status_code == 409

    @property
    def rate_limited(self) -> bool:
        return self.code == "rate_limited" or self.status_code == 429

    @property
    def retryable(self) -> bool:
        """Worth trying again later — as opposed to a bad request we sent."""
        if self.rate_limited:
            return True
        return self.status_code is None or self.status_code >= 500


def _base_url() -> str:
    return settings.qlix_base_url.rstrip("/")


def _org_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
    }


def _partner_headers() -> dict[str, str]:
    key = settings.qlix_partner_key.strip()
    if not key:
        raise QlixError("QLIX_PARTNER_KEY is not configured on the Loomrun server")
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _friendly(code: str, message: str, status_code: int) -> str:
    """Turn a Qlix error into something a Loomrun user can act on."""
    if code == "insufficient_scope":
        return "This org's Qlix key is missing a permission. Reconnect the AI agent to refresh it."
    if code in ("unauthorized", "session_required"):
        return "This org's Qlix key was rejected. Reconnect the AI agent."
    if code == "rate_limited":
        return "Qlix is rate limiting this workspace. Try again shortly."
    if status_code == 402 or "subscription" in message.lower():
        return "The Qlix workspace for this org needs an active subscription."
    return message or f"Qlix request failed ({status_code})"


def _raise_for_error(response: httpx.Response) -> None:
    if response.status_code < 400:
        return
    code = ""
    message = ""
    try:
        body = response.json()
        err = body.get("error") if isinstance(body, dict) else None
        if isinstance(err, dict):
            code = str(err.get("code") or "")
            message = str(err.get("message") or "")
    except (ValueError, AttributeError):
        message = response.text[:300]

    logger.warning(
        "Qlix %s %s -> %s %s",
        response.request.method,
        response.request.url.path,
        response.status_code,
        (code or message)[:200],
    )
    raise QlixError(
        _friendly(code, message, response.status_code),
        status_code=response.status_code,
        code=code,
    )


async def _request(
    method: str,
    path: str,
    *,
    api_key: str | None = None,
    partner: bool = False,
    json_body: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    timeout: float = REQUEST_TIMEOUT,
) -> dict[str, Any]:
    headers = _partner_headers() if partner else _org_headers(api_key or "")
    if not partner and not (api_key or "").strip():
        raise QlixError("This organization is not connected to Qlix")

    url = f"{_base_url()}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method, url, headers=headers, json=json_body, params=params
            )
    except httpx.HTTPError as exc:
        raise QlixError(f"Could not reach Qlix: {exc}") from exc

    _raise_for_error(response)
    if response.status_code == 204 or not response.content:
        return {}
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {"items": data}


# ── Provisioning (partner secret) ─────────────────────────────────────────────

async def register_partner(*, slug: str, name: str) -> dict[str, Any]:
    """Register Loomrun as a Qlix partner product. One-time bootstrap.

    Deliberately unauthenticated — this is how a product gets its identity in
    the first place. The returned ``qlix_partner_*`` key is shown once, so the
    caller must store it; a taken slug returns ``409 slug_taken``.
    """
    url = f"{_base_url()}/partners/register"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.post(
                url,
                headers={"Content-Type": "application/json"},
                json={"slug": slug, "name": name},
            )
    except httpx.HTTPError as exc:
        raise QlixError(f"Could not reach Qlix: {exc}") from exc

    _raise_for_error(response)
    return response.json()


async def provision_tenant(
    *,
    external_org_id: str,
    name: str,
    owner_email: str,
) -> dict[str, Any]:
    """Create (or recover) the Qlix workspace for a Loomrun org.

    Idempotent on (partner, externalOrgId): a retry raises ``already_provisioned``
    rather than creating a second workspace.
    """
    return await _request(
        "POST",
        "/partners/tenants",
        partner=True,
        json_body={
            "externalOrgId": external_org_id,
            "name": name,
            "ownerEmail": owner_email,
        },
    )


async def rotate_tenant_key(*, external_org_id: str) -> dict[str, Any]:
    """Mint a fresh qlix_live_* key — used when we no longer hold a usable one."""
    return await _request(
        "POST",
        f"/partners/tenants/{external_org_id}/rotate-key",
        partner=True,
        json_body={},
    )


async def delete_tenant(*, external_org_id: str) -> dict[str, Any]:
    """Revoke the key and disable MCP servers. Qlix keeps the audit ledger."""
    return await _request("DELETE", f"/partners/tenants/{external_org_id}", partner=True)


# ── Identity ──────────────────────────────────────────────────────────────────

async def auth_me(api_key: str) -> dict[str, Any]:
    return await _request("GET", "/auth/me", api_key=api_key)


# ── AI Brain ──────────────────────────────────────────────────────────────────

async def ensure_brain(api_key: str, *, hosting: str = "cloud") -> dict[str, Any]:
    return await _request(
        "POST", "/ai-brain/ensure-agent", api_key=api_key, json_body={"hosting": hosting}
    )


async def brain_status(api_key: str) -> dict[str, Any]:
    return await _request("GET", "/ai-brain/status", api_key=api_key)


async def ingest_document(
    api_key: str,
    *,
    title: str,
    body_text: str,
    external_id: str,
    collection_id: str | None = None,
    source_uri: str | None = None,
) -> dict[str, Any]:
    """Upsert a Brain document.

    The same ``external_id`` in the same collection replaces the previous
    document rather than inserting a duplicate — that guarantee is what the
    whole CRM sync design rests on. The response carries ``replaced: true``
    when it overwrote an existing document.
    """
    payload: dict[str, Any] = {
        "title": title[:500],
        "bodyText": body_text,
        "externalId": external_id[:200],
    }
    if collection_id:
        payload["collectionId"] = collection_id
    if source_uri:
        payload["sourceUri"] = source_uri
    return await _request("POST", "/ai-brain/ingest", api_key=api_key, json_body=payload)


async def get_document_by_external_id(api_key: str, external_id: str) -> dict[str, Any]:
    return await _request(
        "GET", f"/ai-brain/documents/by-external-id/{external_id}", api_key=api_key
    )


async def delete_document_by_external_id(api_key: str, external_id: str) -> dict[str, Any]:
    return await _request(
        "DELETE", f"/ai-brain/documents/by-external-id/{external_id}", api_key=api_key
    )


async def get_document(api_key: str, document_id: str) -> dict[str, Any]:
    return await _request("GET", f"/ai-brain/documents/{document_id}", api_key=api_key)


async def upload_document_file(
    api_key: str,
    *,
    collection_id: str,
    file_name: str,
    content: bytes,
    mime_type: str,
    title: str | None = None,
    external_id: str | None = None,
) -> dict[str, Any]:
    """Send a user-uploaded file straight to Qlix.

    We hand over the raw bytes rather than extracting text ourselves — Qlix
    already does chunking and extraction, and does it better than we would.
    """
    url = f"{_base_url()}/ai-brain/collections/{collection_id}/documents/upload"
    data: dict[str, str] = {}
    if title:
        data["title"] = title[:500]
    if external_id:
        data["externalId"] = external_id[:200]

    try:
        async with httpx.AsyncClient(timeout=UPLOAD_TIMEOUT) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key.strip()}"},
                files={"file": (file_name, content, mime_type)},
                data=data or None,
            )
    except httpx.HTTPError as exc:
        raise QlixError(f"Could not reach Qlix: {exc}") from exc

    _raise_for_error(response)
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


# ── MCP tool wiring ───────────────────────────────────────────────────────────

async def register_mcp_server(
    api_key: str,
    *,
    name: str,
    endpoint_url: str,
    description: str | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": name[:80],
        "transport": "http",
        "endpointUrl": endpoint_url,
    }
    if description:
        payload["description"] = description
    if headers:
        payload["authType"] = "header"
        payload["headers"] = headers
    return await _request("POST", "/mcp/servers", api_key=api_key, json_body=payload)


async def list_mcp_servers(api_key: str) -> dict[str, Any]:
    return await _request("GET", "/mcp/servers", api_key=api_key)


async def delete_mcp_server(api_key: str, server_id: str) -> dict[str, Any]:
    return await _request("DELETE", f"/mcp/servers/{server_id}", api_key=api_key)


async def discover_mcp_tools(api_key: str, server_id: str) -> dict[str, Any]:
    """Force a tools/list refresh instead of waiting for the 5-minute snapshot."""
    return await _request("POST", f"/mcp/servers/{server_id}/discover", api_key=api_key)


async def set_tool_governance(
    api_key: str, *, server_id: str, tool_name: str, governance: str
) -> dict[str, Any]:
    """Set a tool to ``auto`` (runs freely), ``jit`` (needs approval) or ``blocked``."""
    return await _request(
        "PUT",
        f"/mcp/servers/{server_id}/tools/{tool_name}/governance",
        api_key=api_key,
        json_body={"governance": governance},
    )


async def bind_mcp_server(
    api_key: str, *, agent_id: str, server_id: str, allowed_tools: list[str]
) -> dict[str, Any]:
    return await _request(
        "PUT",
        f"/mcp/agents/{agent_id}/bindings/{server_id}",
        api_key=api_key,
        json_body={"allowedTools": allowed_tools},
    )


# ── Agents, conversations, runs ───────────────────────────────────────────────

async def list_agents(api_key: str) -> dict[str, Any]:
    return await _request("GET", "/agents", api_key=api_key)


_DEFAULT_CLOUD_MODEL = "openrouter/openai/gpt-4o-mini"


def _cloud_agent_payload(
    *, name: str, model: str, description: str | None = None
) -> dict[str, Any]:
    """Body Qlix accepts for a cloud partner agent.

    ``localInferenceMode`` must be JSON null (not ``cloud_api``) when runtime
    is cloud. ``llmProvider`` must match the model prefix — Qlix's server
    default is not always OpenRouter.
    """
    trimmed = (model or "").strip() or _DEFAULT_CLOUD_MODEL
    lower = trimmed.lower()
    if lower.startswith("exora/"):
        provider = "exora"
    elif lower.startswith("openrouter/"):
        provider = "openrouter"
    else:
        trimmed = f"openrouter/{trimmed}"
        provider = "openrouter"
    payload: dict[str, Any] = {
        "name": name[:120],
        "permissionScopes": ["brain.query"],
        "runtime": "cloud",
        "llmMode": "proxy",
        "llmProvider": provider,
        "model": trimmed,
        "localInferenceMode": None,
    }
    if description:
        payload["description"] = description[:10000]
    return payload


async def create_agent(
    api_key: str,
    *,
    name: str,
    model: str,
    description: str | None = None,
) -> dict[str, Any]:
    """Create the org's agent.

    Only ``brain.query`` is requested here: Qlix grants brain access and MCP
    scheduling on create, and the CRM tools arrive with the MCP binding rather
    than being named up front.
    """
    return await _request(
        "POST",
        "/agents",
        api_key=api_key,
        json_body=_cloud_agent_payload(name=name, model=model, description=description),
    )


async def create_conversation(api_key: str, agent_id: str) -> dict[str, Any]:
    return await _request(
        "POST", f"/agents/{agent_id}/conversations", api_key=api_key, json_body={}
    )


async def enqueue_run(
    api_key: str,
    *,
    agent_id: str,
    conversation_id: str,
    content: str,
    use_brain: bool = True,
    model: str | None = None,
    tool_context: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Send a message and start a run.

    ``tool_context`` entries must be ``X-*`` header names; Qlix forwards them
    verbatim on every MCP tool call in this run, which is how the tool server
    learns which org and user it is acting for.
    """
    payload: dict[str, Any] = {"content": content[:20000], "useBrain": use_brain}
    if model:
        payload["model"] = model
    if tool_context:
        payload["toolContext"] = tool_context
    return await _request(
        "POST",
        f"/agents/{agent_id}/conversations/{conversation_id}/messages",
        api_key=api_key,
        json_body=payload,
    )


async def stop_run(api_key: str, *, agent_id: str, run_id: str) -> dict[str, Any]:
    return await _request(
        "POST", f"/agents/{agent_id}/runs/{run_id}/stop", api_key=api_key, json_body={}
    )


async def stream_run(
    api_key: str, *, agent_id: str, run_id: str
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Yield ``(event_name, data)`` frames from a run's SSE stream.

    Qlix documents four events — ``delta``, ``log``, ``status`` and ``done`` —
    and warns that frames must be paired by their ``event:`` name rather than
    by assuming the next ``data:`` line belongs to the previous event, so the
    event name is tracked explicitly and reset after each dispatch.
    """
    url = f"{_base_url()}/agents/{agent_id}/runs/{run_id}/stream"
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Accept": "text/event-stream",
    }

    try:
        async with httpx.AsyncClient(timeout=STREAM_TIMEOUT) as client:
            async with client.stream("GET", url, headers=headers) as response:
                if response.status_code >= 400:
                    await response.aread()
                    _raise_for_error(response)

                event_name = ""
                data_lines: list[str] = []

                async for raw in response.aiter_lines():
                    line = raw.rstrip("\r")

                    # Blank line terminates a frame.
                    if not line:
                        if data_lines:
                            payload = "\n".join(data_lines)
                            data_lines = []
                            name = event_name or "message"
                            event_name = ""
                            try:
                                parsed = json.loads(payload)
                            except json.JSONDecodeError:
                                parsed = {"data": payload}
                            if not isinstance(parsed, dict):
                                parsed = {"data": parsed}
                            yield name, parsed
                            if name == "done":
                                return
                        else:
                            event_name = ""
                        continue

                    if line.startswith(":"):
                        continue  # keep-alive comment
                    if line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())
    except httpx.HTTPError as exc:
        raise QlixError(f"Qlix run stream failed: {exc}") from exc


# ── JIT approvals ─────────────────────────────────────────────────────────────

async def jit_pending(
    api_key: str, *, run_id: str | None = None, agent_id: str | None = None
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if run_id:
        params["runId"] = run_id
    if agent_id:
        params["agentId"] = agent_id
    return await _request("GET", "/jit/pending", api_key=api_key, params=params or None)


async def jit_decide(api_key: str, *, jit_request_id: str, approved: bool) -> dict[str, Any]:
    return await _request(
        "POST",
        "/jit/decide",
        api_key=api_key,
        json_body={"jitRequestId": jit_request_id, "approved": approved},
    )


async def jit_grants(api_key: str) -> dict[str, Any]:
    return await _request("GET", "/jit/grants", api_key=api_key)


async def revoke_jit_grant(api_key: str, grant_id: str) -> dict[str, Any]:
    """Drop a sticky grant so the next write asks for approval again.

    Qlix grants some write scopes for the remainder of a conversation after a
    single yes. Loomrun's contract with users is that every write is confirmed,
    so we revoke rather than inherit that behaviour.
    """
    return await _request("DELETE", f"/jit/grants/{grant_id}", api_key=api_key)


# ── Usage ─────────────────────────────────────────────────────────────────────

async def usage_summary(api_key: str) -> dict[str, Any]:
    return await _request("GET", "/usage/summary", api_key=api_key)
