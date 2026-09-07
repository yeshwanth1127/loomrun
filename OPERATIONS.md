# Loomrun — Operations & Runbook

## Table of Contents
1. [Project Layout](#1-project-layout)
2. [Config Files](#2-config-files)
3. [Database](#3-database)
4. [API (Backend)](#4-api-backend)
5. [Frontend (Web)](#5-frontend-web)
6. [Nginx](#6-nginx)
7. [PM2 Process Manager](#7-pm2-process-manager)
8. [Meta Integration Setup](#8-meta-integration-setup)
9. [Rebuilding After Changes](#9-rebuilding-after-changes)
10. [Logs](#10-logs)
11. [Prisma — Schema & Migrations](#11-prisma--schema--migrations)
12. [Quick Reference Cheatsheet](#12-quick-reference-cheatsheet)

---

## 1. Project Layout

```
/var/www/loomrun/
├── .env                        ← Root env file (read by API via pydantic-settings)
├── .env.example                ← Template — copy this when setting up fresh
├── start-api.sh                ← Shell wrapper PM2 uses to launch uvicorn
├── package.json                ← Root Node pkg — holds Prisma CLI pin (5.17.0)
├── package-lock.json
├── node_modules/               ← Prisma CLI lives here (npx prisma uses this)
├── prisma/
│   ├── schema.prisma           ← Single source of truth for the DB schema
│   └── migrations/             ← Applied SQL migration files (never edit manually)
├── apps/
│   ├── api/                    ← Python FastAPI backend
│   │   ├── pyproject.toml      ← Python package definition & dependencies
│   │   ├── .venv/              ← Python virtual environment
│   │   │   └── bin/uvicorn     ← The uvicorn binary PM2 runs
│   │   ├── loomrun_api/
│   │   │   ├── main.py         ← FastAPI app, lifespan, router registration
│   │   │   ├── config.py       ← Settings class (reads .env from repo root)
│   │   │   ├── meta_client.py  ← Meta Graph API helper (OAuth, leadgen fetch)
│   │   │   ├── security.py     ← JWT creation/verification, bcrypt
│   │   │   ├── deps.py         ← FastAPI dependency injectors (auth, org context)
│   │   │   ├── prisma_client.py← Shared Prisma client singleton
│   │   │   ├── workers.py      ← ARQ worker tasks (PDF gen, outbound WhatsApp)
│   │   │   └── routers/        ← One file per feature area:
│   │   │       ├── auth.py         /v1/auth/*
│   │   │       ├── admin.py        /v1/admin/*
│   │   │       ├── leads.py        /v1/leads/*
│   │   │       ├── lead_connections.py  /v1/lead-connections/*
│   │   │       ├── meta_hooks.py   /v1/hooks/meta  (webhook receiver)
│   │   │       ├── meta_oauth.py   /v1/meta/oauth/* (OAuth flow)
│   │   │       ├── orgs.py         /v1/orgs/*
│   │   │       ├── quotations.py   /v1/quotations/*
│   │   │       ├── production.py   /v1/production/*
│   │   │       ├── catalog.py      /v1/catalog/*
│   │   │       ├── telecaller.py   /v1/telecaller/*
│   │   │       ├── telephony.py    /v1/telephony/*
│   │   │       ├── dashboard.py    /v1/dashboard/*
│   │   │       ├── whatsapp_hooks.py   /v1/hooks/whatsapp/*
│   │   │       └── integrations_whatsapp.py  /v1/whatsapp/*
│   │   └── storage/            ← Local file storage (PDFs, brand assets)
│   └── web/                    ← React/Vite frontend
│       ├── .env                ← Frontend env (VITE_* vars, baked in at build)
│       ├── package.json
│       ├── node_modules/
│       ├── src/                ← Source code
│       └── dist/               ← Production build output (served by nginx)
```

---

## 2. Config Files

### Root `.env` — `/var/www/loomrun/.env`
The API reads this file via `pydantic-settings`. Every setting here overrides the default.

| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_URL` | *(from root `.env` — never commit)* | Postgres connection |
| `REDIS_URL` | `redis://localhost:6379/0` | ARQ worker queue |
| `SECRET_KEY` | *(32-byte hex from `.env`)* | JWT signing key |
| `CORS_ORIGINS` | `https://loomrun.exora.solutions` | Allowed browser origins |
| `PUBLIC_API_URL` | `https://loomrun.exora.solutions` | Used in Meta OAuth redirect URI |
| `META_APP_ID` | *(from `.env`)* | Meta / Facebook App ID |
| `META_APP_SECRET` | *(from `.env`)* | Meta App Secret |
| `META_WEBHOOK_VERIFY_TOKEN` | *(from `.env`)* | Verify token set in Meta dashboard |
| `SUPER_ADMIN_EMAILS` | *(from `.env`)* | Comma-separated super-admin emails |
| `STORAGE_DIR` | `/var/www/loomrun/apps/api/storage` | Where PDFs/assets are written |

> **Note:** Never put real passwords or API secrets in this doc. Read values from `/var/www/loomrun/.env` on the server. URL-encode special characters in `DATABASE_URL` (e.g. `@` → `%40`).

### Frontend `.env` — `/var/www/loomrun/apps/web/.env`
These are baked into the JS bundle at build time — changing them requires a **frontend rebuild**.

| Variable | Value | Purpose |
|---|---|---|
| `VITE_API_URL` | `https://loomrun.exora.solutions` | Base URL for all API calls |
| `VITE_API_PUBLIC_URL` | `https://loomrun.exora.solutions` | Used in Meta OAuth URL builder |

---

## 3. Database

- **Engine:** PostgreSQL 15 (server), client tools on this host are v16 — that's fine, pg_dump is forward-compatible
- **Database:** `loomrun`
- **User:** `postgres`
- **Password:** *(from `DATABASE_URL` / root `.env` — never commit)*
- **Host:** `10.0.0.1:5432`, reached over the WireGuard VPN (`wg0`, this host is `10.0.0.5`) — **not `localhost`**, despite what this doc used to say. Do not trust "localhost:5432" — that's a *different*, unrelated local Postgres instance on this same app server.
- **⚠️ Shared instance:** that Postgres server hosts 8 databases for unrelated products (`loomrun`, `n8n`, `sunkidz_lms`, `exora_crm`, `exora_os`, `qlix`, `dexler_db`, `postgres`) all under the same `postgres` superuser login. There is no database-level isolation between them — a mistake in any one project's tooling (wrong `DATABASE_URL`, a stray `TRUNCATE`/`prisma migrate reset` against the wrong target) can wipe another project's data with no permission barrier. Treat any script that touches `DATABASE_URL` with extreme care, and double-check which database you're pointed at before running anything destructive.
- **No WAL archiving:** `archive_mode` is `off` on this server, so there is no point-in-time recovery from Postgres itself. The nightly/hourly `pg_dump` backups below (added 2026-07-15, after a full data-loss incident) are the only recovery mechanism — see [Backups](#backups) below.

### Connect manually
```bash
# Load password from root .env (do not hardcode secrets in docs or shell history)
set -a && source /var/www/loomrun/.env && set +a
# Prefer using DATABASE_URL with psql, or export PGPASSWORD from .env yourself
psql "$DATABASE_URL"
```

### Useful queries
```sql
-- List tables
\dt

-- Count leads
SELECT COUNT(*) FROM leads;

-- Check migrations applied (note: this DB has no _prisma_migrations table —
-- it was synced via `prisma db push`/manual SQL historically, not tracked migrations)
```

### Backups

Added 2026-07-15 after an incident wiped every row in every table (schema was untouched,
only data — root cause undetermined, see incident notes). No backups existed before this.
Hardened 2026-07-17: integrity-checked dumps, a size-anomaly guard, tiered retention, and
automated restore verification (previously backups were never test-restored).

- **Script:** `/var/www/loomrun/scripts/backup-db.sh` — runs `pg_dump -Fc` against `DATABASE_URL`,
  scoped to the `loomrun` database only. After dumping it runs `pg_restore --list` against the
  file to confirm the archive isn't corrupt before keeping it.
- **Schedule:** hourly, via root's crontab (`crontab -l` to view/edit): `0 * * * * /var/www/loomrun/scripts/backup-db.sh`
- **Storage:** `/var/backups/loomrun-postgres/` on this app host, `chmod 700`, files `chmod 600` (root-only — dumps contain full customer PII/business data unencrypted).
- **Retention (tiered, local only):**
  - Hourly dumps kept for 48 hours in `/var/backups/loomrun-postgres/`.
  - The first dump of each UTC day (00:xx run) is additionally copied into
    `/var/backups/loomrun-postgres/daily/` and kept for 30 days.
  - **Size-anomaly guard:** if a new dump is ≥50% smaller than the previous hourly dump
    (a signature of a wipe/truncation like the 2026-07-15 incident), rotation is skipped for
    that run so existing backups aren't deleted out from under an active incident. Check
    `/var/backups/loomrun-postgres/LAST_STATUS` (`OK`/`WARN`/`FAILED`) and the log below if
    something looks off.
- **Restore verification:** `/var/www/loomrun/scripts/verify-backup.sh` restores the latest dump
  into a throwaway database (`loomrun_restore_verify`, same Postgres server) and checks row
  counts on `users`/`organizations`/`leads`/`quotations` — a backup that restores to 0 users
  fails verification loudly instead of sitting untested. Status in
  `/var/backups/loomrun-postgres/LAST_VERIFY_STATUS`. Scheduled daily via root's crontab:
  `17 3 * * * /var/www/loomrun/scripts/verify-backup.sh` (off-peak on the shared DB server).
- **Logs:** `/var/log/loomrun-db-backup.log` (backup) and `/var/log/loomrun-db-backup-verify.log`
  (verification), both rotated weekly via `/etc/logrotate.d/loomrun-db-backup`.
- **Known gap:** backups are still local-only to this app VPS (explicit choice — off-site
  shipping to S3/Backblaze/another host was evaluated 2026-07-17 and deferred). If this host's
  disk is lost entirely, all local backups are lost too, even though the live DB itself lives on
  a separate host (`10.0.0.1`) and would be unaffected. RPO is up to 1 hour (hourly `pg_dump`,
  no WAL archiving/PITR) — acceptable per current requirements, revisit if that changes.

### Restore from a backup
```bash
# Load credentials from root .env first (never hardcode PGPASSWORD here)
set -a && source /var/www/loomrun/.env && set +a
# Restore into a NEW scratch database first to verify before touching prod:
createdb -U postgres -h 10.0.0.1 loomrun_restore_test
pg_restore -U postgres -h 10.0.0.1 -d loomrun_restore_test /var/backups/loomrun-postgres/loomrun_<timestamp>.dump
# Verify row counts etc., then either promote it or restore into the real `loomrun` db:
pg_restore -U postgres -h 10.0.0.1 -d loomrun --clean --if-exists /var/backups/loomrun-postgres/loomrun_<timestamp>.dump
```

---

## 4. API (Backend)

- **Language:** Python 3.12
- **Framework:** FastAPI + uvicorn
- **ORM:** Prisma (prisma-client-py 0.15.0)
- **Port:** `127.0.0.1:8002` (not exposed directly — nginx proxies it)
- **Working directory when running:** `/var/www/loomrun` (so it finds `.env`)
- **Virtual env:** `/var/www/loomrun/apps/api/.venv/`

### Start / Stop / Restart
```bash
pm2 restart loomrun-api
pm2 stop loomrun-api
pm2 start loomrun-api
```

### Run manually (for debugging — stops when you close the terminal)
```bash
cd /var/www/loomrun
source apps/api/.venv/bin/activate
uvicorn loomrun_api.main:app --host 127.0.0.1 --port 8002 --reload
```

### API docs (Swagger UI)
Only accessible locally or through nginx:
```
https://loomrun.exora.solutions/docs
https://loomrun.exora.solutions/openapi.json
```

### Health check
```bash
curl https://loomrun.exora.solutions/health
# Expected: {"status":"ok"}
```

### ARQ Worker (optional — for PDF generation queue)
The API has a built-in 60s poll loop for outbound WhatsApp. For heavy PDF generation, you can run the ARQ worker separately:
```bash
cd /var/www/loomrun/apps/api
.venv/bin/arq loomrun_api.workers.WorkerSettings
```
Requires Redis to be running (`redis-cli ping` should return `PONG`).

---

## 5. Frontend (Web)

- **Framework:** React 19 + Vite + TypeScript + TailwindCSS
- **Build output:** `/var/www/loomrun/apps/web/dist/`
- **Served by:** nginx as static files (no Node.js process required in production)

### Build
```bash
cd /var/www/loomrun/apps/web
npm run build
```
This runs `tsc -b && vite build`. Output lands in `dist/`.

### Dev server (local development only — not for production)
```bash
cd /var/www/loomrun/apps/web
npm run dev
# Opens on http://localhost:5173
```

---

## 6. Nginx

- **Config file:** `/etc/nginx/sites-available/loomrun.exora.solutions`
- **Symlink (enabled):** `/etc/nginx/sites-enabled/loomrun.exora.solutions`
- **SSL cert:** `/etc/letsencrypt/live/loomrun.exora.solutions/fullchain.pem` (auto-renews via certbot)
- **Access log:** `/var/log/nginx/loomrun_access.log`
- **Error log:** `/var/log/nginx/loomrun_error.log`

### Routing rules
| Request path | Handled by |
|---|---|
| `/v1/*` | Proxied → uvicorn on port 8002 |
| `/health` | Proxied → uvicorn on port 8002 |
| `/docs`, `/openapi.json` | Proxied → uvicorn on port 8002 |
| Everything else `/` | Static files from `apps/web/dist/` — falls back to `index.html` for React Router |

### Reload nginx after config changes
```bash
nginx -t                     # test config first — never skip this
systemctl reload nginx       # graceful reload (no downtime)
```

### Edit nginx config
```bash
nano /etc/nginx/sites-available/loomrun.exora.solutions
nginx -t && systemctl reload nginx
```

### Renew SSL manually (auto-renewed by certbot timer)
```bash
certbot renew --dry-run      # test renewal
certbot renew                # force renewal
```

---

## 7. PM2 Process Manager

PM2 manages the API process and auto-restarts it on crash.

| PM2 name | What it runs | Port |
|---|---|---|
| `loomrun-api` | uvicorn (FastAPI) | 8002 |
| `loomrun-whatsapp` | Node Baileys WhatsApp sidecar | 8090 (localhost only) |

### Common commands
```bash
pm2 list                          # show all processes and status
pm2 status                        # same, shorter
pm2 restart loomrun-api           # restart the API
pm2 stop loomrun-api              # stop (nginx will return 502 until restarted)
pm2 start loomrun-api             # start
pm2 delete loomrun-api            # remove from PM2 entirely

pm2 logs loomrun-api              # live tail of stdout+stderr
pm2 logs loomrun-api --lines 100  # last 100 lines
pm2 monit                         # interactive dashboard (CPU/memory/logs)

pm2 save                          # persist current process list across reboots
pm2 startup                       # show command to enable PM2 on boot (if needed)
```

### How the process is launched
PM2 runs `/var/www/loomrun/start-api.sh` with the `bash` interpreter:

```bash
# /var/www/loomrun/start-api.sh
exec /var/www/loomrun/apps/api/.venv/bin/uvicorn loomrun_api.main:app \
  --host 127.0.0.1 \
  --port 8002 \
  --workers 2
```

The working directory is `/var/www/loomrun`, so the `.env` file is found automatically.

### WhatsApp sidecar (`loomrun-whatsapp`)
A self-hosted Baileys (WhatsApp Web) service at `apps/whatsapp-baileys`. Each org links
its own number by scanning a QR in **Settings → Connectors**; the API then sends
messages, quotations, and invoices from that number. The API reaches it over
localhost (`BAILEYS_SERVICE_URL`, default `http://127.0.0.1:8090`) using the shared
`BAILEYS_SERVICE_SECRET` (must match the sidecar's `.env` `SERVICE_SECRET`). It is **not**
exposed through nginx.

```bash
# First-time setup
cd /var/www/loomrun/apps/whatsapp-baileys
npm install
cp .env.example .env          # set PORT=8090 and SERVICE_SECRET=<same as root BAILEYS_SERVICE_SECRET>
pm2 start src/index.js --name loomrun-whatsapp
pm2 save

# Day-to-day
pm2 restart loomrun-whatsapp
pm2 logs loomrun-whatsapp
curl -s -H "X-Service-Secret: $SECRET" http://127.0.0.1:8090/health
```

WhatsApp auth state persists per org under `apps/whatsapp-baileys/auth_info/<orgId>/`
(gitignored). Disconnecting from the Connectors page logs out and wipes that folder.
Sessions auto-resume on service restart.

---

## 8. Meta Integration Setup

The Meta integration has two parts: **webhook** (inbound leads) and **OAuth** (connecting a Facebook Page).

### Webhook — receive Meta Lead Ads in real time

In the **Meta Developer Console** → your App → Webhooks:

| Field | Value |
|---|---|
| Callback URL | `https://loomrun.exora.solutions/v1/hooks/meta` |
| Verify Token | *(same as `META_WEBHOOK_VERIFY_TOKEN` in `.env`)* |
| Subscribe to field | `leadgen` |

Test verification:
```bash
set -a && source /var/www/loomrun/.env && set +a
curl "https://loomrun.exora.solutions/v1/hooks/meta?hub.mode=subscribe&hub.verify_token=${META_WEBHOOK_VERIFY_TOKEN}&hub.challenge=TEST123"
# Expected: "TEST123"
```

### OAuth — connect an org's Facebook Page

In the **Meta Developer Console** → your App → Facebook Login → Valid OAuth Redirect URIs, add:
```
https://loomrun.exora.solutions/v1/meta/oauth/callback
```

Users connect their Page via the **Lead Connections** page in the app UI, which calls:
```
GET /v1/orgs/{org_id}/meta/oauth-url
```
This redirects to Facebook, then Meta calls back to `/v1/meta/oauth/callback`, which stores the page access token in the DB.

### Meta App credentials
- Stored only in `/var/www/loomrun/.env` as `META_APP_ID` / `META_APP_SECRET`
- Do not copy these values into docs, tickets, or git

---

## 9. Rebuilding After Changes

### After changing backend Python code
```bash
pm2 restart loomrun-api
# Takes ~2-3 seconds. The API is down during restart.
```

### After changing backend Python **dependencies** (`pyproject.toml`)
```bash
cd /var/www/loomrun
apps/api/.venv/bin/pip install -e "apps/api[dev]"
pm2 restart loomrun-api
```

### After changing the Prisma schema (`prisma/schema.prisma`)
```bash
cd /var/www/loomrun

# 1. Create and apply a new migration
npx prisma migrate dev --name describe_your_change    # dev only — creates migration file
# OR on production:
npx prisma migrate deploy                              # applies pending migrations only

# 2. Regenerate the Python client
export PATH="/var/www/loomrun/apps/api/.venv/bin:$PATH"
npx prisma generate

# 3. Restart API
pm2 restart loomrun-api
```

> **Important:** Always use `npx prisma` from `/var/www/loomrun/` (not globally). The root `package.json` pins Prisma to **5.17.0** — this must match `prisma-client-py 0.15.0`. Never upgrade the Prisma CLI here.

### After changing frontend code (`apps/web/src/`)
```bash
cd /var/www/loomrun/apps/web
npm run build
# nginx immediately serves the new dist/ — no restart needed
```

### After changing frontend `.env` variables
```bash
# Edit the env file
nano /var/www/loomrun/apps/web/.env

# Then rebuild
cd /var/www/loomrun/apps/web
npm run build
```

### After changing root `.env` (API config)
```bash
pm2 restart loomrun-api
# The API re-reads .env on startup
```

---

## 10. Logs

### API logs (uvicorn / FastAPI)
```bash
# Live tail
pm2 logs loomrun-api

# Last N lines
pm2 logs loomrun-api --lines 200

# Stdout only
tail -f /root/.pm2/logs/loomrun-api-out.log

# Stderr only (errors/exceptions)
tail -f /root/.pm2/logs/loomrun-api-error.log
```

### Nginx access log
```bash
tail -f /var/log/nginx/loomrun_access.log

# Filter API requests only
grep '/v1/' /var/log/nginx/loomrun_access.log | tail -50

# Filter errors (4xx/5xx)
grep ' [45][0-9][0-9] ' /var/log/nginx/loomrun_access.log | tail -50
```

### Nginx error log
```bash
tail -f /var/log/nginx/loomrun_error.log
```

### PostgreSQL logs
```bash
tail -f /var/log/postgresql/postgresql-16-main.log
```

### Redis logs
```bash
journalctl -u redis-server -f
```

---

## 11. Prisma — Schema & Migrations

The schema is at `prisma/schema.prisma`. Migration SQL files live in `prisma/migrations/` — never edit these by hand.

### Current migrations applied (in order)
1. `20250514100000_init` — base schema
2. `20250515120000_super_admin` — is_super_admin flag
3. `20250516140000_org_brand_assets` — brand logo/signature fields
4. `20260517031248_ysw` — additional fields
5. `20260517055546_integrations` — telephony & integrations
6. `20260517070600_` — misc
7. `20260527100000_meta_lead_fields` — Meta campaign/ad/form tracking fields on Lead

### Adding a new migration
```bash
cd /var/www/loomrun

# Edit prisma/schema.prisma first, then:
npx prisma migrate dev --name my_change_description

# This creates a new migration file and applies it to the DB.
# Then regenerate the Python client:
export PATH="/var/www/loomrun/apps/api/.venv/bin:$PATH"
npx prisma generate

pm2 restart loomrun-api
```

---

## 12. Quick Reference Cheatsheet

```bash
# ── Status ─────────────────────────────────────────────────
pm2 list                                   # API process status
curl https://loomrun.exora.solutions/health  # API health check
nginx -t                                   # test nginx config

# ── Restart ────────────────────────────────────────────────
pm2 restart loomrun-api                    # restart API
systemctl reload nginx                     # reload nginx (no downtime)
systemctl restart redis-server             # restart Redis

# ── Rebuild frontend ───────────────────────────────────────
cd /var/www/loomrun/apps/web && npm run build

# ── Restart API after code change ──────────────────────────
pm2 restart loomrun-api

# ── Migrate DB + regenerate Prisma client ──────────────────
cd /var/www/loomrun
npx prisma migrate deploy
export PATH="/var/www/loomrun/apps/api/.venv/bin:$PATH" && npx prisma generate
pm2 restart loomrun-api

# ── Logs ───────────────────────────────────────────────────
pm2 logs loomrun-api --lines 100           # API logs
tail -f /var/log/nginx/loomrun_access.log  # nginx access
tail -f /var/log/nginx/loomrun_error.log   # nginx errors
tail -f /root/.pm2/logs/loomrun-api-error.log  # API stderr

# ── Database ───────────────────────────────────────────────
set -a && source /var/www/loomrun/.env && set +a
psql "$DATABASE_URL"

# ── SSL ────────────────────────────────────────────────────
certbot renew --dry-run                    # test SSL renewal
```




after changes:
Python code only (any file in apps/api/loomrun_api/):


pm2 restart loomrun-api
Frontend code (any file in apps/web/src/):


cd /var/www/loomrun/apps/web && npm run build
No restart needed — nginx serves the new dist/ immediately.

Root .env (changed an API env var):


pm2 restart loomrun-api
prisma/schema.prisma (added/changed a model):


cd /var/www/loomrun
npx prisma migrate deploy
export PATH="/var/www/loomrun/apps/api/.venv/bin:$PATH" && npx prisma generate
pm2 restart loomrun-api
Python dependencies (pyproject.toml):


cd /var/www/loomrun
apps/api/.venv/bin/pip install -e "apps/api[dev]"
pm2 restart loomrun-api
Nginx config (/etc/nginx/sites-available/loomrun.exora.solutions):


nginx -t && systemctl reload nginx