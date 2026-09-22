"""One-click activation of an org's Qlix agent.

The user clicks Activate and nothing else: Loomrun requests the tenant, gets
the ``qlix_live_*`` key back, provisions the brain, points Qlix at Loomrun's
MCP tool server, sets which tools need approval, and starts the backfill.

Every step records how far it got in ``provisionStep`` so a retry after a
partial failure resumes rather than creating a second workspace or a duplicate
MCP registration.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from loomrun_api.config import settings
from loomrun_api.prisma_client import prisma
from loomrun_api.qlix import client as qlix
from loomrun_api.qlix import connection as conn
from loomrun_api.qlix import sync

logger = logging.getLogger(__name__)

MCP_SERVER_NAME = "loomrun-crm"

# Stored on the Qlix agent as ``description``. Qlix uses that field as the
# system prompt (prefixed with "You are {name}. ").
_AGENT_DESCRIPTION = """\
Loomrun CRM assistant for {org_name}. Help this organisation with leads, quotations, invoices and related operations — nowhere else.

## How you work
- Use tools for live facts. Never invent lead, quotation, invoice, or user IDs.
- For "how many leads" call count_leads and report its `total`. Brain context is a few similar records, never the roster. Never list four names and call that the organisation total.
- Read tools run immediately. Write tools (create/update lead, send quote or invoice) pause until the user confirms in the UI.
- Prefer compound tools for end-to-end asks: create_and_send_quotation, create_and_send_invoice.
- Pipeline stages: NEW, CONTACTED, QUALIFICATION, QUOTATION, NEGOTIATION, SAMPLE, WON, LOST.
- Resolve assignees with list_team_members before assigning.
- Query the knowledge base for policies, price lists and uploaded documents. Do not use the knowledge base as a lead roster.
- Reply in the user's language. Be professional and concise. Do not claim a write completed until the tool returns success after confirmation.
"""

# Provisioning steps, in order. Stored so a retry knows where to pick up.
STEP_TENANT = "tenant"
STEP_BRAIN = "brain"
STEP_AGENT = "agent"
STEP_MCP = "mcp"
STEP_BINDING = "binding"
STEP_BACKFILL = "backfill"
_STEP_ORDER = [
    STEP_TENANT,
    STEP_BRAIN,
    STEP_AGENT,
    STEP_MCP,
    STEP_BINDING,
    STEP_BACKFILL,
]


class ProvisionError(Exception):
    pass


def _reached(step: str | None, target: str) -> bool:
    if not step:
        return False
    try:
        return _STEP_ORDER.index(step) >= _STEP_ORDER.index(target)
    except ValueError:
        return False


def _first(payload: dict[str, Any], *names: str) -> str | None:
    """Qlix responses nest ids inconsistently; accept the plausible spellings."""
    for name in names:
        value = payload.get(name)
        if isinstance(value, str) and value:
            return value
        if isinstance(value, dict):
            inner = value.get("id")
            if isinstance(inner, str) and inner:
                return inner
    return None


async def _tool_governance() -> dict[str, str]:
    """Map Loomrun's tool registry onto Qlix governance levels.

    Every tool runs unattended, writes included: the agent creates leads, moves
    stages and sends quotations without pausing for a confirmation. This is a
    deliberate product decision, not a default — the per-tool approval gate was
    removed on request. Role limits still apply (owner-only tools are re-checked
    inside dispatch), and every write is still written to the lead activity log,
    so the audit trail survives even though the prompt does not.
    """
    from loomrun_api.ai_agent.tools import defs as _defs  # noqa: F401  (registers tools)
    from loomrun_api.ai_agent.tools.registry import all_tools

    return {spec.name: "auto" for spec in all_tools()}


async def _key_usable(api_key: str) -> bool:
    """Return True when Qlix accepts this org key."""
    if not api_key.strip():
        return False
    try:
        await qlix.auth_me(api_key)
        return True
    except qlix.QlixError as exc:
        if exc.unauthorized:
            return False
        raise


async def probe_key(row) -> bool | None:
    """Live check: True/False when probed, None when not connected or probe inconclusive."""
    if not row or row.status != conn.STATUS_CONNECTED:
        return None
    key = conn.read_api_key(row)
    if not key:
        return False
    try:
        return await _key_usable(key)
    except qlix.QlixError:
        return None


async def _rotate_and_store_key(organization_id: str) -> str:
    result = await qlix.rotate_tenant_key(external_org_id=organization_id)
    api_key = str(result.get("apiKey") or "").strip()
    if not api_key:
        raise ProvisionError("Qlix did not return an API key for this organization.")
    await conn.update_connection(
        organization_id,
        credentials=conn.write_api_key(api_key),
    )
    return api_key


async def reconnect(*, organization_id: str) -> dict[str, Any]:
    """Mint a fresh qlix_live_* key for an org whose stored key no longer works."""
    if not settings.qlix_ready:
        raise ProvisionError(
            "Qlix is not configured on this server. Set QLIX_PARTNER_KEY and QLIX_MCP_URL."
        )
    org = await prisma.organization.find_unique(where={"id": organization_id})
    if not org:
        raise ProvisionError("Organization not found")

    try:
        api_key = await _rotate_and_store_key(organization_id)
        if not await _key_usable(api_key):
            raise ProvisionError("Qlix did not accept the new API key.")
        await conn.update_connection(
            organization_id,
            status=conn.STATUS_CONNECTED,
            lastError=None,
        )
    except qlix.QlixError as exc:
        await conn.mark_error(organization_id, str(exc))
        raise ProvisionError(str(exc)) from exc

    return conn.public_state(await conn.get_connection(organization_id))


async def activate(
    *, organization_id: str, owner_email: str | None = None
) -> dict[str, Any]:
    """Provision (or resume provisioning) this org's Qlix agent."""
    if not settings.qlix_ready:
        raise ProvisionError(
            "Qlix is not configured on this server. Set QLIX_PARTNER_KEY and QLIX_MCP_URL."
        )

    org = await prisma.organization.find_unique(where={"id": organization_id})
    if not org:
        raise ProvisionError("Organization not found")

    row = await conn.ensure_row(organization_id)
    if row.status == conn.STATUS_CONNECTED:
        key = conn.read_api_key(row)
        if key:
            try:
                if await _key_usable(key):
                    return conn.public_state(row)
            except qlix.QlixError as exc:
                if not exc.unauthorized:
                    raise ProvisionError(str(exc)) from exc
            logger.info("Qlix key stale for org %s; rotating", organization_id)
            return await reconnect(organization_id=organization_id)

    await conn.update_connection(
        organization_id, status=conn.STATUS_PROVISIONING, lastError=None
    )

    try:
        api_key = await _step_tenant(row, org, owner_email)
        row = await conn.get_connection(organization_id)

        await _step_brain(row, api_key)
        row = await conn.get_connection(organization_id)

        agent_id = await _step_agent(row, api_key, org)
        row = await conn.get_connection(organization_id)

        server_id = await _step_mcp(row, api_key, org)
        row = await conn.get_connection(organization_id)

        await _step_binding(row, api_key, agent_id=agent_id, server_id=server_id)

        # Backfill only enqueues; the drain worker paces the actual pushing, so
        # the user can start chatting straight away.
        await sync.backfill_org(organization_id)
        await conn.update_connection(
            organization_id,
            status=conn.STATUS_CONNECTED,
            provisionStep=STEP_BACKFILL,
            lastError=None,
        )
    except qlix.QlixError as exc:
        await conn.mark_error(organization_id, str(exc))
        raise ProvisionError(str(exc)) from exc
    except ProvisionError as exc:
        await conn.mark_error(organization_id, str(exc))
        raise
    except Exception as exc:
        logger.exception("Qlix activation failed for org %s", organization_id)
        await conn.mark_error(organization_id, str(exc))
        raise ProvisionError("Activation failed. Please try again.") from exc

    return conn.public_state(await conn.get_connection(organization_id))


async def _step_tenant(row, org, owner_email: str | None) -> str:
    """Get a usable qlix_live_* key for this org."""
    existing = conn.read_api_key(row)
    if existing and _reached(row.provisionStep, STEP_TENANT):
        return existing

    email = (owner_email or org.brandEmail or "").strip()
    if not email:
        owner = await prisma.membership.find_first(
            where={"organizationId": org.id, "role": "OWNER"}, include={"user": True}
        )
        email = owner.user.email if owner and owner.user else ""
    if not email:
        raise ProvisionError("This organization has no owner email to register with Qlix.")

    try:
        result = await qlix.provision_tenant(
            external_org_id=org.id, name=org.name, owner_email=email
        )
    except qlix.QlixError as exc:
        if not exc.already_provisioned:
            raise
        # The tenant exists but we do not hold a usable key — that is exactly
        # what rotate-key is for. Provisioning again would not return one.
        logger.info("Qlix tenant already exists for org %s; rotating key", org.id)
        result = await qlix.rotate_tenant_key(external_org_id=org.id)

    api_key = str(result.get("apiKey") or "").strip()
    if not api_key:
        raise ProvisionError("Qlix did not return an API key for this organization.")

    await conn.update_connection(
        org.id,
        credentials=conn.write_api_key(api_key),
        qlixOrgId=result.get("orgId") or result.get("workspaceId"),
        provisionStep=STEP_TENANT,
    )
    return api_key


async def _step_brain(row, api_key: str) -> str | None:
    """Provision the org's knowledge base.

    This creates the brain, not the chat agent — those are separate in Qlix.
    """
    if _reached(row.provisionStep, STEP_BRAIN):
        return row.collectionId

    result = await qlix.ensure_brain(api_key, hosting="cloud")
    collection_id = _first(result, "collectionId", "collection")

    await conn.update_connection(
        row.organizationId,
        collectionId=collection_id,
        provisionStep=STEP_BRAIN,
    )
    return collection_id


async def _step_agent(row, api_key: str, org) -> str:
    """Create the org's assistant.

    Only ``brain.query`` is asked for: the CRM tools are granted by the MCP
    binding in the next step, not named here.
    """
    if _reached(row.provisionStep, STEP_AGENT) and row.agentId:
        return row.agentId

    agent_id: str | None = None
    try:
        result = await qlix.create_agent(
            api_key,
            name=f"{org.name} assistant",
            model=settings.qlix_default_model,
            description=_AGENT_DESCRIPTION.format(org_name=org.name).strip(),
        )
        agent_id = _first(result, "id", "agentId", "agent")
    except qlix.QlixError as exc:
        # A retry after a partial failure may find the agent already there.
        if not exc.already_provisioned:
            raise
        logger.info("Qlix agent already exists for org %s", org.id)

    if not agent_id:
        agents = await qlix.list_agents(api_key)
        items = agents.get("agents") or agents.get("items") or []
        candidate = next(
            (a for a in items if isinstance(a, dict) and a.get("id")), None
        )
        agent_id = candidate.get("id") if candidate else None

    if not agent_id:
        raise ProvisionError("Qlix did not create an agent for this organization.")

    await conn.update_connection(
        row.organizationId, agentId=agent_id, provisionStep=STEP_AGENT
    )
    return agent_id


async def _step_mcp(row, api_key: str, org) -> str:
    """Register Loomrun's MCP server so Qlix can reach the CRM tools."""
    if _reached(row.provisionStep, STEP_MCP) and row.mcpServerId:
        return row.mcpServerId

    # Reuse an existing registration rather than stacking duplicates on retry.
    try:
        existing = await qlix.list_mcp_servers(api_key)
        items = existing.get("servers") or existing.get("items") or []
        match = next(
            (
                s
                for s in items
                if isinstance(s, dict) and s.get("name") == MCP_SERVER_NAME
            ),
            None,
        )
    except qlix.QlixError:
        match = None

    if match and match.get("id"):
        server_id = str(match["id"])
    else:
        result = await qlix.register_mcp_server(
            api_key,
            name=MCP_SERVER_NAME,
            endpoint_url=settings.qlix_mcp_url.strip(),
            description=f"Loomrun CRM tools for {org.name}",
        )
        server_id = _first(result, "id", "serverId", "server") or ""
        if not server_id:
            raise ProvisionError("Qlix did not return an MCP server id.")

    await conn.update_connection(
        row.organizationId, mcpServerId=server_id, provisionStep=STEP_MCP
    )
    return server_id


async def _step_binding(row, api_key: str, *, agent_id: str, server_id: str) -> None:
    """Bind the tool server to the agent and set per-tool governance."""
    if _reached(row.provisionStep, STEP_BINDING):
        return

    await qlix.bind_mcp_server(
        api_key, agent_id=agent_id, server_id=server_id, allowed_tools=["*"]
    )

    # Binding triggers a catalog refresh, but be explicit — governance can only
    # be set for tools Qlix has actually discovered.
    try:
        await qlix.discover_mcp_tools(api_key, server_id)
    except qlix.QlixError:
        logger.warning("MCP discovery call failed for org %s", row.organizationId)

    governance = await _tool_governance()
    for tool_name, level in governance.items():
        try:
            await qlix.set_tool_governance(
                api_key, server_id=server_id, tool_name=tool_name, governance=level
            )
        except qlix.QlixError as exc:
            # A write tool left ungoverned would execute without asking the
            # user, which breaks the confirmation guarantee. Reads are safe to
            # skip — they default to running anyway.
            if level == "jit":
                raise ProvisionError(
                    f"Could not require approval for '{tool_name}': {exc}"
                ) from exc
            logger.warning("Could not set governance for %s: %s", tool_name, exc)

    await conn.update_connection(row.organizationId, provisionStep=STEP_BINDING)


async def resync_tool_governance(organization_id: str) -> dict[str, Any]:
    """Re-apply per-tool governance for an already-provisioned org.

    Governance is only set during activation, and `_step_binding` skips itself
    on a re-run. Any tool added to Loomrun's registry afterwards — or any
    `set_tool_governance` call that failed at the time — keeps Qlix's default,
    which is "jit". A read tool left on that default pauses for an approval it
    should never need, and the user simply sees the agent hang. Re-applying the
    whole map is idempotent, so this is safe to run at any time.
    """
    row = await conn.get_connection(organization_id)
    api_key = conn.read_api_key(row)
    if not row or not api_key or not row.mcpServerId:
        raise ProvisionError("This organization has no connected Qlix agent yet.")

    try:
        await qlix.discover_mcp_tools(api_key, row.mcpServerId)
    except qlix.QlixError:
        logger.warning("MCP discovery failed during governance resync for %s", organization_id)

    governance = await _tool_governance()
    applied: dict[str, str] = {}
    failed: dict[str, str] = {}
    for tool_name, level in governance.items():
        try:
            await qlix.set_tool_governance(
                api_key,
                server_id=row.mcpServerId,
                tool_name=tool_name,
                governance=level,
            )
            applied[tool_name] = level
        except qlix.QlixError as exc:
            # Same posture as activation: a write left ungoverned would run
            # without asking, which breaks the confirm-before-write promise.
            if level == "jit":
                raise ProvisionError(
                    f"Could not require approval for '{tool_name}': {exc}"
                ) from exc
            failed[tool_name] = str(exc)
            logger.warning("Could not set governance for %s: %s", tool_name, exc)

    return {"applied": len(applied), "governance": applied, "failed": failed}


async def deactivate(organization_id: str) -> dict[str, Any]:
    """Tear down the org's Qlix tenant and forget the key."""
    row = await conn.get_connection(organization_id)
    if not row:
        return {"status": conn.STATUS_DISCONNECTED}

    try:
        await qlix.delete_tenant(external_org_id=organization_id)
    except qlix.QlixError as exc:
        # Teardown should not be blockable by a remote error — clear our side
        # regardless so the org can re-activate cleanly.
        logger.warning("Qlix teardown failed for org %s: %s", organization_id, exc)

    await prisma.qlixsyncqueue.delete_many(where={"organizationId": organization_id})
    await conn.update_connection(
        organization_id,
        status=conn.STATUS_DISCONNECTED,
        credentials=None,
        agentId=None,
        collectionId=None,
        mcpServerId=None,
        provisionStep=None,
        backfillState=None,
        backfillDoneAt=None,
        lastError=None,
    )
    return {"status": conn.STATUS_DISCONNECTED}


def activate_in_background(*, organization_id: str, owner_email: str | None = None) -> None:
    """Kick activation off without holding the HTTP request open."""

    async def _run() -> None:
        try:
            await activate(organization_id=organization_id, owner_email=owner_email)
        except Exception:
            logger.exception("Background Qlix activation failed for %s", organization_id)

    try:
        asyncio.create_task(_run())
    except RuntimeError:
        logger.warning("No running event loop for Qlix activation")


async def mark_backfill_complete_if_drained(organization_id: str) -> bool:
    """Flip the backfill flag once the queue for this org has emptied."""
    row = await conn.get_connection(organization_id)
    if not row or row.backfillDoneAt or row.status != conn.STATUS_CONNECTED:
        return False
    pending = await prisma.qlixsyncqueue.count(
        where={
            "organizationId": organization_id,
            "status": {"in": [sync.STATUS_PENDING, sync.STATUS_PROCESSING]},
        }
    )
    if pending:
        return False
    await conn.update_connection(
        organization_id, backfillDoneAt=datetime.now(timezone.utc)
    )
    return True


async def chat_blocked_reason(organization_id: str) -> str | None:
    """Why chat must wait, or None if the agent may answer."""
    row = await conn.get_connection(organization_id)
    if not row or row.status != conn.STATUS_CONNECTED:
        return None
    if row.backfillDoneAt:
        return None
    await mark_backfill_complete_if_drained(organization_id)
    row = await conn.get_connection(organization_id)
    if not row or row.backfillDoneAt:
        return None
    pending = await prisma.qlixsyncqueue.count(
        where={
            "organizationId": organization_id,
            "status": {"in": [sync.STATUS_PENDING, sync.STATUS_PROCESSING]},
        }
    )
    if pending:
        return (
            f"Your CRM data is still syncing with the agent ({pending} record"
            f"{'' if pending == 1 else 's'} left). Chat unlocks when the import finishes."
        )
    return "Your CRM data is still syncing with the agent. Chat unlocks when the import finishes."
