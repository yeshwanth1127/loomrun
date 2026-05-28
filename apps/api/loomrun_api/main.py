import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from loomrun_api.config import settings
from loomrun_api.prisma_client import prisma

logger = logging.getLogger(__name__)


async def _whatsapp_poll_loop() -> None:
    from loomrun_api.workers import process_outbound_whatsapp
    while True:
        try:
            await process_outbound_whatsapp({})
        except Exception:
            logger.exception("WhatsApp poll error")
        await asyncio.sleep(60)


from loomrun_api.routers import (
    admin,
    auth,
    catalog,
    dashboard,
    integrations_whatsapp,
    lead_connections,
    leads,
    meta_hooks,
    meta_oauth,
    orgs,
    production,
    quotations,
    telecaller,
    telephony,
    whatsapp_hooks,
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    await prisma.connect()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    poll_task = asyncio.create_task(_whatsapp_poll_loop())
    yield
    poll_task.cancel()
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
app.include_router(meta_oauth.router, prefix="/v1", tags=["meta"])
app.include_router(orgs.router, prefix="/v1", tags=["organizations"])
app.include_router(leads.router, prefix="/v1", tags=["leads"])
app.include_router(lead_connections.router, prefix="/v1", tags=["lead-connections"])
app.include_router(telephony.router, prefix="/v1", tags=["telephony"])
app.include_router(catalog.router, prefix="/v1", tags=["catalog"])
app.include_router(quotations.router, prefix="/v1", tags=["quotations"])
app.include_router(production.router, prefix="/v1", tags=["production"])
app.include_router(integrations_whatsapp.router, prefix="/v1", tags=["whatsapp"])
app.include_router(telecaller.router, prefix="/v1", tags=["telecaller"])
app.include_router(dashboard.router, prefix="/v1", tags=["dashboard"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
