# Loomrun + n8n — Step-by-step setup

## Auto-provisioning (recommended)

When `N8N_API_URL` and `N8N_API_KEY` are set on the Loomrun server, each org admin clicks **Clone workflows** in Integrations. Loomrun automatically:

1. Clones all four template JSON files into n8n
2. Names them `Loomrun — … — {Org Name}`
3. Sets unique webhook paths like `loomrun-acme-corp-gmail-send`
4. Activates each workflow
5. Stores workflow IDs and webhook URLs in Loomrun

The org admin then opens each cloned workflow in n8n and attaches **one Gmail OAuth credential** for that org's inbox.

To get an n8n API key: n8n → **Settings → API** → Create API key.

```env
N8N_PUBLIC_URL=https://n8n.yourdomain.com
N8N_WEBHOOK_URL=https://n8n.yourdomain.com/webhook
N8N_API_URL=https://n8n.yourdomain.com
N8N_API_KEY=n8n_api_...
```

Users never see or paste webhook URLs — Loomrun builds them from `N8N_WEBHOOK_URL` plus each org's unique path (e.g. `loomrun-acme-corp-gmail-send`).

### LLM (email analyse workflow)

OpenRouter credentials stay on the **Loomrun server**, not in n8n. When you **Clone workflows**, Loomrun injects the LLM URL, auth key, org slug, and model into each cloned workflow — no n8n env vars needed.

**Loomrun `.env`:**

```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_DEFAULT_MODEL=openai/gpt-4o-mini
LOOMRUN_AUTOMATION_API_KEY=your-long-random-secret
PUBLIC_API_URL=https://loomrun.exora.solutions
```

Optional: `OPENROUTER_HTTP_REFERER` (defaults to `PUBLIC_API_URL`), `OPENROUTER_APP_TITLE=Loomrun`.

Generate the automation key: `openssl rand -hex 32`

Restart Loomrun API: `pm2 restart loomrun-api`

The **Gmail Read and Analyse** workflow calls `POST /v1/automation/llm/chat` with the injected bearer token.

Model IDs use OpenRouter format, e.g. `openai/gpt-4o-mini`, `anthropic/claude-3.5-sonnet` (via `OPENROUTER_DEFAULT_MODEL`).

Re-clone if you provisioned workflows before this injection was added.

---

Loomrun is **multi-tenant**. Automations are **per organization**, not per user:

| Org | Gmail in n8n | Webhook in Loomrun | Emails send from |
|-----|----------------|---------------------|------------------|
| Acme Corp | OAuth as `sales@acme.com` | Unique URL for Acme | `sales@acme.com` |
| Beta Ltd | OAuth as `hello@beta.com` | Unique URL for Beta | `hello@beta.com` |

Each org admin:

1. Imports/copies workflow templates in n8n **for their org**
2. Creates a Gmail OAuth credential (name it `Gmail — {org-slug}`)
3. Signs in with **that org's business Gmail**
4. Uses a **unique webhook path** (e.g. `loomrun-acme-send`)
5. In Loomrun → Integrations, saves **sender email + webhook URL**

The Gmail node always sends from whichever Google account was authorized on the credential — so org isolation is enforced in n8n by using separate credentials per org.

Loomrun includes `sender_email` and `organization_slug` in every event payload so workflows can verify the right org.

---

**Workflow files (import into n8n):**

| File | Purpose |
|------|---------|
| `workflows/loomrun-automations.json` | All four workflows in one bundle (read, send, read+send, analyse) |

---

## Before you start (once per server)

### Step 0 — Run n8n

If n8n is not running yet, start it (example):

```bash
docker run -d --name n8n \
  -p 5678:5678 \
  -e N8N_HOST=n8n.yourdomain.com \
  -e WEBHOOK_URL=https://n8n.yourdomain.com/ \
  -v n8n_data:/home/node/.n8n \
  n8nio/n8n
```

Open `https://n8n.yourdomain.com` (or `http://localhost:5678` locally).

Add to Loomrun `.env`:

```env
N8N_PUBLIC_URL=https://n8n.yourdomain.com
```

Restart the API: `pm2 restart loomrun-api`

---

### Step 0b — Create Gmail OAuth credential in n8n (once **per organization**)

1. In n8n, go to **Credentials** → **Add credential** → **Gmail OAuth2 API**
2. Name it: `Gmail — acme-corp` (use the org's Loomrun slug)
3. Click **Sign in with Google** and authorize **that org's business inbox** (e.g. `sales@acme.com`)
4. Save — attach this credential to every Gmail node in **that org's workflows only**

> Do **not** share one Gmail credential across orgs. Duplicate workflows per customer org.

> **Google Cloud:** Create OAuth credentials at [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials. Enable **Gmail API**. Add n8n's OAuth redirect URL from the credential screen.

---

## Workflow 1 — Gmail Read (scheduled)

**What it does:** Every 30 minutes, fetches unread inbox messages and normalizes `from`, `subject`, `snippet`.

### Import

1. n8n → **Workflows** → **⋯** menu → **Import from File**
2. Choose `n8n/workflows/loomrun-automations.json` — n8n imports one workflow at a time from the bundle (see keys below), or use **Clone workflows** in Loomrun to provision all four automatically.

### Configure

1. Open the **Gmail — Get unread inbox** node
2. **Credential:** select `Gmail — Acme Corp` (your Gmail OAuth)
3. Optional: change schedule in **Every 30 minutes** (e.g. every 15 min)

### Test

1. Click **Test workflow** (or execute **Every 30 minutes** manually)
2. Confirm you see unread emails in **Normalize fields** output

### Activate

1. Toggle **Active** (top right) → ON  
2. This workflow does **not** need a Loomrun webhook — it runs on its own schedule

---

## Workflow 2 — Gmail Send (Loomrun → email)

**What it does:** When Loomrun creates a lead **with an email**, sends a welcome message.

### Import

1. Import the **gmail-send** workflow from `n8n/workflows/loomrun-automations.json` (or use Loomrun auto-provision)

### Configure

1. **Gmail — Send** node → attach Gmail credential
2. Edit **Build email** node if you want different subject/body text
3. Open **Loomrun Webhook** node → copy the **Production URL**  
   Example: `https://n8n.yourdomain.com/webhook/loomrun-gmail-send`

### Test (without Loomrun)

1. Click **Listen for test event** on the Webhook node
2. Send a test POST (replace URL with your test URL):

```bash
curl -X POST 'https://n8n.yourdomain.com/webhook-test/loomrun-gmail-send' \
  -H 'Content-Type: application/json' \
  -d '{
    "event": "lead.created",
    "organization_id": "test-org",
    "organization_name": "Acme Corp",
    "data": {
      "lead": {
        "title": "Rajesh Kumar",
        "email": "your-test@gmail.com",
        "phone": "+919876543210"
      }
    }
  }'
```

3. Check your inbox for the welcome email

### Activate

1. Toggle **Active** → ON
2. **Save the Production Webhook URL** — you will paste this into Loomrun (Step 5)

---

## Workflow 3 — Gmail Read and Send (contextual reply)

**What it does:** When a lead moves to **CONTACTED**, reads recent emails from that lead, then sends a follow-up that references the thread.

### Import

1. Import the **gmail-read-send** workflow from `loomrun-automations.json`

### Configure

1. Attach Gmail credential on **both** Gmail nodes
2. Adjust **Build reply from context** message template if needed
3. Copy **Production Webhook URL** from **Loomrun Webhook**  
   Example: `https://n8n.yourdomain.com/webhook/loomrun-gmail-read-send`

### Test

```bash
curl -X POST 'https://n8n.yourdomain.com/webhook-test/loomrun-gmail-read-send' \
  -H 'Content-Type: application/json' \
  -d '{
    "event": "lead.stage_changed",
    "organization_name": "Acme Corp",
    "data": {
      "from_stage": "NEW",
      "to_stage": "CONTACTED",
      "lead": {
        "title": "Rajesh Kumar",
        "email": "sender@example.com"
      }
    }
  }'
```

### Activate

1. Toggle **Active** → ON

> **Important:** Loomrun stores **one** webhook URL per org. Use either Workflow 2 **or** Workflow 3 as the primary Loomrun webhook, unless you build a router workflow (Step 6).

---

## Workflow 4 — Gmail Read and Analyse (AI)

**What it does:** Every 15 minutes, reads unread emails and runs OpenAI analysis (intent, urgency, suggested reply).

### Prerequisites

1. Set `OPENROUTER_API_KEY` and `LOOMRUN_AUTOMATION_API_KEY` on the Loomrun server (see auto-provisioning section above)

### Import

1. Import the **gmail-read-analyse** workflow from `loomrun-automations.json`

### Configure

1. **Gmail — Get unread** → Gmail credential
2. **OpenAI — Analyse email** → uses Loomrun LLM API (OpenRouter via HTTP Request node)
3. Optional: change model in the LLM node body to another OpenRouter model (e.g. `anthropic/claude-3.5-sonnet`)

### Test

1. Leave a test email unread in the connected inbox
2. **Test workflow** → check **Structured output** for JSON analysis

### Activate

1. Toggle **Active** → ON  
2. No Loomrun webhook needed — runs on schedule

### Optional next step

Add an **IF** node after analysis: when `urgency` is `high`, send Slack alert or HTTP Request to Loomrun to add a note on the matching lead.

---

## Step 5 — Connect to Loomrun (per organization)

Do this for **each customer org** in Loomrun:

1. Log into Loomrun as that org's admin
2. Go to **Integrations** → **Automations**
3. Click **Set up** on **Automations (n8n)**
4. Paste the **Production Webhook URL** from the workflow you want as the primary trigger
5. Enter **Sender Gmail address** — must match the Google account authorized in n8n (e.g. `sales@acme.com`)
6. Click **Connect automations**

### Verify end-to-end

1. In Loomrun, create a test lead with a real email address
2. In n8n → **Executions**, confirm the webhook fired
3. Confirm the email arrived (Workflow 2) or stage change triggered reply (Workflow 3)

### Events Loomrun sends today

| Event | When |
|-------|------|
| `lead.created` | Manual add, ingest, Meta, etc. |
| `lead.stage_changed` | Stage updated in Leads UI |

Payload includes `organization_id`, `organization_slug`, `organization_name`, and `data.lead`.

---

## Step 6 — Using multiple workflows together (recommended)

Because Loomrun accepts **one webhook URL per org**, use a **router workflow**:

```
Loomrun Webhook (single URL)
  → Switch on {{ $json.event }}
      → lead.created        → Execute Workflow → "Gmail Send"
      → lead.stage_changed  → Execute Workflow → "Read and Send"
```

**Setup:**

1. Create a new workflow: **Loomrun — Router**
2. Add **Webhook** (POST) — this is the URL you paste into Loomrun
3. Add **Switch** on `{{ $json.body.event }}`
4. Add **Execute Workflow** nodes pointing to Workflows 2 and 3
5. Activate router + keep Workflows 2 and 3 active (or deactivate their own webhooks and call them only via Execute Workflow)

Workflows **1** (read) and **4** (analyse) stay independent on schedules — they do not need the Loomrun webhook.

---

## Per-org checklist

| Step | Action |
|------|--------|
| ☐ | Gmail OAuth credential created in n8n for this org's inbox |
| ☐ | Workflow 1 imported, tested, activated (optional monitoring) |
| ☐ | Workflow 2 imported, tested, activated |
| ☐ | Workflow 3 imported, tested, activated (optional) |
| ☐ | Workflow 4 imported + OpenAI credential (optional AI triage) |
| ☐ | Router workflow created OR one primary webhook chosen |
| ☐ | Production webhook URL pasted in Loomrun Integrations |
| ☐ | End-to-end test with real lead |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Webhook never fires | Workflow must be **Active**; use Production URL not Test URL in Loomrun |
| Gmail auth fails | Re-authorize credential; check Gmail API enabled in Google Cloud |
| No email sent | Lead must have `email`; Workflow 2 requires `lead.created` |
| Read+Send skipped | Event must be `lead.stage_changed` with `to_stage: CONTACTED` |
| OpenAI errors | Check `OPENROUTER_API_KEY`, billing, and model name (OpenRouter format, e.g. `openai/gpt-4o-mini`) |

---

## File locations in this repo

```
n8n/
├── README.md
└── workflows/
    └── loomrun-automations.json   ← all automation workflows (keys: gmail-read, gmail-send, gmail-read-send, gmail-read-analyse)
```
