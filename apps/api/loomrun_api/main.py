from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from loomrun_api.config import settings
from loomrun_api.prisma_client import prisma
from loomrun_api.routers import (
    admin,
    auth,
    dashboard,
    integrations_whatsapp,
    lead_connections,
    leads,
    orgs,
    production,
    quotations,
    telecaller,
    whatsapp_hooks,
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    await prisma.connect()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    yield
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
app.include_router(orgs.router, prefix="/v1", tags=["organizations"])
app.include_router(leads.router, prefix="/v1", tags=["leads"])
app.include_router(lead_connections.router, prefix="/v1", tags=["lead-connections"])
app.include_router(quotations.router, prefix="/v1", tags=["quotations"])
app.include_router(production.router, prefix="/v1", tags=["production"])
app.include_router(integrations_whatsapp.router, prefix="/v1", tags=["whatsapp"])
app.include_router(telecaller.router, prefix="/v1", tags=["telecaller"])
app.include_router(dashboard.router, prefix="/v1", tags=["dashboard"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
