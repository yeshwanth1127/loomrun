# Loomrun API

FastAPI backend using [prisma-client-py](https://github.com/RobertCraigie/prisma-client-py).

## Setup

1. Run **PostgreSQL** locally and set `DATABASE_URL` in the repo root `.env` (see root `.env.example`).
2. Optionally run **Redis** if you use the ARQ worker (`REDIS_URL` in `.env`).
3. Install Node deps at repo root: `npm install` — required for `prisma migrate` / `prisma generate`.
4. From repo root: `npx prisma migrate deploy`
5. Create a Python venv in `apps/api`, install deps: `pip install -e ".[dev]"` then from **repo root** run `prisma generate` (uses `prisma/schema.prisma`; put `apps/api/.venv/Scripts` on `PATH` on Windows, or `apps/api/.venv/bin` on Unix, before `npx prisma generate`).

Run API:

```bash
cd apps/api
uvicorn loomrun_api.main:app --reload --host 0.0.0.0 --port 8000
```

Run ARQ worker (optional, for PDF + outbound queue; requires Redis):

```bash
cd apps/api
arq loomrun_api.workers.WorkerSettings
```
