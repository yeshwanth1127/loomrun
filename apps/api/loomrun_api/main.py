import asyncio
import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from loomrun_api.config import settings
from loomrun_api.document_template_service import ensure_system_templates
from loomrun_api.polling import PollTask, start as start_polling
from loomrun_api.prisma_client import prisma
from loomrun_api.qlix.mcp_server import mcp_server

logger = logging.getLogger(__name__)


async def _poll_whatsapp() -> None:
    from loomrun_api.workers import process_outbound_whatsapp
    await process_outbound_whatsapp({})


async def _poll_gmail() -> None:
    from loomrun_api.gmail_sync import sync_all_gmail
    await sync_all_gmail()


async def _poll_indiamart() -> None:
    from loomrun_api.indiamart_client import sync_all_orgs
    await sync_all_orgs()


async def _poll_meta() -> None:
    from loomrun_api.meta_sync import sync_all_meta_orgs
    await sync_all_meta_orgs()


async def _poll_google_ads() -> None:
    from loomrun_api.google_ads_sync import sync_all_google_ads_orgs
    await sync_all_google_ads_orgs()


async def _poll_qlix_sync() -> None:
    """Push CRM changes into each connected org's AI Brain.

    Keep draining while the queue is full so a first-time import of hundreds
    of leads is not stretched by the 30s idle interval between poll ticks.
    """
    if not settings.qlix_enabled:
        return

    from loomrun_api.qlix.sync import BATCH_SIZE, drain_queue

    for _ in range(50):
        result = await drain_queue()
        if result.get("processed", 0) < BATCH_SIZE:
            break


async def _poll_qlix_sweep() -> None:
    """Catch records that changed without firing a write hook.

    Bulk importers (Meta, IndiaMart) and admin paths bypass the normal routes,
    so without this the Brain drifts silently out of date.
    """
    if not settings.qlix_enabled:
        return

    from loomrun_api.qlix.sync import sweep_all_orgs
    await sweep_all_orgs()


async def _poll_follow_up_reminders() -> None:
    from loomrun_api.follow_up_reminders import send_due_whatsapp_reminders
    await send_due_whatsapp_reminders()


_POLL_TASKS: list[PollTask] = [
    PollTask(name="whatsapp_outbound", interval=60,  fn=_poll_whatsapp),
    PollTask(name="gmail_sync",        interval=300, fn=_poll_gmail,     startup_delay=30),
    PollTask(name="indiamart_sync",    interval=600, fn=_poll_indiamart, startup_delay=15),
    PollTask(name="meta_leads_sync",   interval=10,  fn=_poll_meta,      startup_delay=5),
    PollTask(name="google_ads_sync",  interval=60,  fn=_poll_google_ads, startup_delay=25),
    PollTask(name="follow_up_reminders", interval=60, fn=_poll_follow_up_reminders, startup_delay=20),
    PollTask(name="qlix_brain_sync",   interval=30,  fn=_poll_qlix_sync,  startup_delay=20),
    # Hourly rather than nightly: a stale answer is the failure mode that
    # costs the most trust, and re-queuing only touches changed records.
    PollTask(name="qlix_brain_sweep",  interval=3600, fn=_poll_qlix_sweep, startup_delay=180),
]


from loomrun_api.routers import (
    admin,
    auth,
    automation_connections,
    automation_llm,
    catalog,
    connectors,
    dashboard,
    document_templates,
    expenses,
    google_oauth,
    google_ads_oauth,
    indiamart_hooks,
    integrations_whatsapp,
    lead_connections,
    leads,
    meta_hooks,
    meta_oauth,
    orgs,
    production,
    quotations,
    subscription,
    telecaller,
    telephony,
    tracking,
    whatsapp_hooks,
)
from loomrun_api.ai_agent import router as ai_agent_router
from loomrun_api.routers.qlix import router as qlix_router


# Loomrun's CRM tools, published over MCP for Qlix agents to call. Mounted into
# this app so it shares the Prisma connection and is reachable on one public URL.
# stateless_http because the API runs multiple uvicorn workers: a stateful
# session could be initialised on one worker and called on another, which
# would fail with an unknown-session error. Qlix only lists and calls tools,
# so there is no session state worth keeping anyway.
_mcp_app = mcp_server.http_app(
    path="/", transport="streamable-http", stateless_http=True
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    # The Prisma query engine resolves env("DATABASE_URL") from the OS
    # environment. pydantic-settings loads it into `settings` but not into
    # os.environ, and process managers (pm2) don't inject .env — so without
    # this the engine spawns with no datasource and the client fails with
    # "Could not connect to the query engine".
    os.environ.setdefault("DATABASE_URL", settings.database_url)
    await prisma.connect()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    await ensure_system_templates()
    _tasks = start_polling(_POLL_TASKS)
    # The mounted MCP app owns a session manager that must be started here;
    # Starlette does not run a sub-app's lifespan on its behalf.
    async with _mcp_app.router.lifespan_context(_app):
        yield
    for t in _tasks:
        t.cancel()
    await prisma.disconnect()


app = FastAPI(title="Loomrun API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/v1/admin", tags=["admin"])
app.include_router(whatsapp_hooks.router, prefix="/v1", tags=["hooks"])
app.include_router(meta_hooks.router, prefix="/v1", tags=["hooks"])
app.include_router(indiamart_hooks.router, prefix="/v1", tags=["hooks"])
app.include_router(meta_oauth.router, prefix="/v1", tags=["meta"])
app.include_router(orgs.router, prefix="/v1", tags=["organizations"])
app.include_router(subscription.router, prefix="/v1", tags=["subscription"])
app.include_router(ai_agent_router, prefix="/v1", tags=["ai-agent"])
app.include_router(leads.router, prefix="/v1", tags=["leads"])
app.include_router(lead_connections.router, prefix="/v1", tags=["lead-connections"])
app.include_router(automation_connections.router, prefix="/v1", tags=["automation-connections"])
app.include_router(automation_llm.router, prefix="/v1", tags=["automation-llm"])
app.include_router(telephony.router, prefix="/v1", tags=["telephony"])
app.include_router(catalog.router, prefix="/v1", tags=["catalog"])
app.include_router(document_templates.router, prefix="/v1", tags=["document-templates"])
app.include_router(quotations.router, prefix="/v1", tags=["quotations"])
app.include_router(production.router, prefix="/v1", tags=["production"])
app.include_router(tracking.router, prefix="/v1", tags=["tracking"])
app.include_router(expenses.router, prefix="/v1", tags=["expenses"])
app.include_router(integrations_whatsapp.router, prefix="/v1", tags=["whatsapp"])
app.include_router(telecaller.router, prefix="/v1", tags=["telecaller"])
app.include_router(connectors.router, prefix="/v1", tags=["connectors"])
app.include_router(dashboard.router, prefix="/v1", tags=["dashboard"])
app.include_router(google_oauth.router, prefix="/v1", tags=["google"])
app.include_router(google_ads_oauth.router, prefix="/v1", tags=["google-ads"])


app.include_router(qlix_router, prefix="/v1", tags=["qlix"])

# Qlix reaches Loomrun's CRM tools here. Requests carry a signed
# X-Loomrun-Context header naming the org, user and role the run acts as;
# the tools refuse to act without it.
app.mount("/mcp", _mcp_app)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
