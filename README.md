# Loomrun

Multi-tenant SaaS for custom manufacturing operations: **CRM → quotations → production → WhatsApp / telecaller automation → CEO dashboard**.

## Stack

| Layer | Technology |
|--------|------------|
| Web | React (Vite + TypeScript), TanStack Query, React Router |
| API | Python 3.11+, FastAPI, prisma-client-py |
| DB | PostgreSQL |
| Migrations | Prisma CLI (**Node.js 20+** required for `prisma migrate` / `prisma generate`) |
| Cache / jobs | Redis + ARQ (optional; PDF queue + outbound stub) |

## Prerequisites

- **Node.js 20+** and `npm` (for Prisma CLI pinned to **5.17.0** — must match `prisma` Python package engine).
- **Python 3.11+**
- **PostgreSQL** (14+ recommended; URL in `.env` as `DATABASE_URL`).
- **Redis** (optional; only needed for the ARQ worker — PDF queue and outbound message stub).

## Quick start

1. Copy the environment template and edit it:

   ```bash
   cp .env.example .env
   ```

   Set `DATABASE_URL` to your local PostgreSQL connection string (create an empty database first, e.g. `loomrun`). Set `REDIS_URL` if you will run the ARQ worker (default points at `localhost:6379`).

2. Ensure **PostgreSQL** is running and the database from your URL exists.

3. Install root Node deps and apply migrations:

   ```bash
   npm install
   npx prisma migrate deploy
   ```

4. If you use the ARQ worker, run **Redis** locally; `REDIS_URL` in `.env` should point at it.

5. Create API virtualenv, install package, generate Prisma Python client:

   ```bash
   python -m venv apps/api/.venv
   apps/api/.venv/Scripts/pip install -e "apps/api[dev]"   # Windows
   # Linux/macOS: source apps/api/.venv/bin/activate && pip install -e "apps/api[dev]"
   ```

6. **Generate the Python client** (must find `prisma-client-py` on `PATH`):

   **Windows (PowerShell):**

   ```powershell
   $env:PATH = ".\apps\api\.venv\Scripts;" + $env:PATH
   npx prisma generate
   ```

   **Linux/macOS:**

   ```bash
   export PATH="$(pwd)/apps/api/.venv/bin:$PATH"
   npx prisma generate
   ```

7. Run API (from repo root or `apps/api`; ensure `.env` is at repo root):

   ```bash
   apps/api/.venv/Scripts/uvicorn loomrun_api.main:app --reload --host 0.0.0.0 --port 8000
   ```

8. Run web UI:

   ```bash
   cd apps/web
   npm install
   npm run dev
   ```

   Open `http://localhost:5173`, register an account, then use **Leads**, **Quotations**, **Production**, **Telecaller**, **WhatsApp**, and **CEO** from the nav.

9. **Optional worker** (Redis + ARQ — processes PDF jobs and marks queued WhatsApp outbounds “sent” as a stub; requires Redis):

   ```bash
   cd apps/api
   .venv/Scripts/arq loomrun_api.workers.WorkerSettings
   ```

   On Linux/macOS use `.venv/bin/arq` instead of `Scripts`.

## WhatsApp webhooks (Meta)

- **Verify / challenge:** `GET /v1/hooks/whatsapp/{organization_id}?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
- **Inbound:** `POST /v1/hooks/whatsapp/{organization_id}` (same URL Meta calls; no Loomrun JWT — secure with Meta signature validation in production).
- Set `WHATSAPP_VERIFY_TOKEN` in `.env` to match Meta configuration.

## Project layout

- `apps/web` — React SPA  
- `apps/api/loomrun_api` — FastAPI application  
- `prisma/schema.prisma` — database schema (single source of truth)  
- `prisma/migrations` — SQL migrations  

## SVG specifications

Original workflow diagrams (`fabblen_*.svg`) remain in the repo root as product references.
