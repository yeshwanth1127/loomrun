# 03 — User Flows

Current-state flows derived from implementation. Format: entry → steps → pages → entities → APIs → auto/manual → stage changes → end / break points.

---

## 1. Authentication & org onboarding

**Entry:** `/register` or `/login`

1. Register: `organization_name`, email, password, optional name → `POST /v1/auth/register`
2. Creates `User` + `Organization` (plan=free, trialEndsAt) + OWNER `Membership`
3. Seeds default document templates; ensures default Sales pipeline
4. JWT access + refresh stored in `localStorage`
5. Redirect → `/` → `/app/leads`

**Login:** `POST /auth/login` → `/auth/me` → telecaller→`/app/telecaller`, super-admin→`/platform`, else `/app/leads`

**Super-admin:** email must be in `SUPER_ADMIN_EMAILS`

**Breaks:** No email invite flow; Team creates accounts with password. No multi-org create UI (`POST /v1/orgs` backend-only). Stripe fields exist but unused.

---

## 2. Lead creation (manual)

**Entry:** Leads → Add Lead

1. Form: title*, company, source, phone, email, city, product, qty, value, notes
2. `POST /leads` → score computed; pipeline routing applied; activity created
3. Auto: `schedule_greeting` (if enabled); delayed AI auto-call (5 min if AI telephony configured); n8n `lead.created`; Qlix dirty mark
4. Appears on Leads board at NEW / pipeline “New”

**Ends:** Lead on board. **Break:** Assignee field unused in UI.

---

## 3. Lead CSV import

**Entry:** Leads → Import CSV (OWNER)

1. Upload → `POST /leads/upload-csv`
2. Server maps columns; creates leads with scores + routing
3. **Skips** greeting, auto-call, n8n (by design)

**Break:** Sample CSV uses human stage labels (“Quoted”) that don’t match enum strings.

---

## 4. Meta lead ingestion

**Entry:** Settings → Integrations → Meta OAuth, or Meta webhook

**Live path:** Meta Lead Ads → `POST /v1/hooks/meta` → fetch leadgen → create Lead (META_ADS + meta* fields) → greeting

**Bulk path:** Poll every 10s / manual Sync → historical forms (~90 days) → no greeting

**Dedupe:** `metaLeadgenId`

**Break:** HMAC skipped if `META_APP_SECRET` empty.

---

## 5. Google Ads lead ingestion

**Entry:** Integrations → Google Ads OAuth

1. OAuth scope `adwords`; poll every 60s / manual sync
2. Lead form submissions → Lead (GOOGLE_ADS + googleAds* fields)
3. Phone/email duplicate → activity on existing lead
4. No greeting on bulk sync

**Break:** Test developer token limitations; Growth plan locks feature.

---

## 6. IndiaMART ingestion

**Backend:** Poll 10 min + push webhook `/v1/hooks/leads/{org}/indiamart` + manual sync

**Dedupe:** `indiamartQueryId`; greeting on live upsert

**Break:** **No Integrations UI card** — cannot connect from product UI. Webhook has no signature auth.

---

## 7. WhatsApp inbound → lead

**Entry:** Meta Cloud API webhook `POST /hooks/whatsapp/{org}`

1. Unknown phone → create Lead (WHATSAPP) + thread/message
2. `schedule_greeting`

**Break:** No signature verification; org_id in URL is the only gate.

---

## 8. Pipeline routing

**Trigger:** Lead create/ingest without pipeline assignment

1. `resolve_pipeline_for_lead`: explicit id → matching `PipelineRoutingRule` (priority, AND match on source/campaign/region/product/sector) → default Sales pipeline
2. Sets `pipelineId`, `pipelineStageId`, syncs legacy `Lead.stage` via `systemKey`, may set `leadStatus`

**Manual:** Pipeline Settings → rules CRUD, preview, re-apply to existing leads

**Break:** Assigned leads never re-routed on attribute change. Rules are org-wide but edited inside one pipeline’s Settings tab. Employees see Pipelines nav but can’t open it.

---

## 9. Follow-ups

**Schedule:** Telecaller log or Leads drawer → outcome `CALLBACK_SCHEDULED` + `next_call_at` → `Lead.nextFollowUpAt`

**In-app:** AppShell polls `/follow-ups/due` every 30s → toast → ack → Follow ups page → Call opens Telecaller `?lead=`

**WhatsApp to telecaller:** Poll 60s → message telecaller’s `Membership.whatsappPhone` (not the lead)

**Break:** Follow-ups page never opens Leads drawer. Conversion metric labels won leads as “orders”.

---

## 10. Telecalling

**Entry:** `/app/telecaller` or Follow-ups Call link

1. Select lead → pick provider (Twilio browser / Exotel|Plivo click-to-call / Manual / AI VAPI)
2. Dial → optionally continue to Log
3. Log: stage, contact fields, outcome, follow-up, duration, notes; optional WA catalog/quote
4. `POST /telecaller/calls` → `sync_lead_after_call` (NEW→CONTACTED only)
5. Webhooks update duration/recording/AI summary

**Break:** `ORDER_CONFIRMED` does **not** create a production order. Call status in Make-call step only when stage=CONTACTED. “Go to Telephony settings” is plain text, not a link.

---

## 11. Customer conversion (implicit)

There is **no Customer entity**. “Won” = `LeadStage.WON` / pipeline stage kind WON / `LeadStatus.WON`.

Won leads remain leads; production orders hang off `Lead`. No convert-to-customer step.

---

## 12. Quotation creation → send → revise

**Entry:** Quotations → New (or deep-link state from other pages)

1. Select lead, line items (optional catalog), template → create DRAFT or finalize+PDF
2. Generate PDF (async task) → Preview / Download
3. Send Email (Gmail AutomationConnection) or WhatsApp (Baileys required — no Meta fallback)
4. On send: status→SENT; lead advances to QUOTATION (`only_if_earlier`)
5. Edit quoted doc → may advance lead to NEGOTIATION
6. Rename, delete, Convert to invoice

**Break:** No UI button for ACCEPTED/REJECTED/EXPIRED. WhatsApp send UI gate uses `DRAFT && pdf_url` (likely wrong). No “start production” from Quotations.

---

## 13. Invoice flow

**Entry:** Quotations → Convert to invoice OR Invoices page (view only)

1. `POST .../generate-invoice` → sets `invoice_number`, `invoicedAt`, queues invoice PDF
2. Invoices page filters quotations with `invoice_number`
3. Send as `doc_type=invoice`

**Break:** No Accept prerequisite. Paid/Pending UI derives from status ACCEPTED||PAID but invoices rarely show those statuses. No payment recording on invoice (payments on Production).

---

## 14. Order / production creation

**Paths:**
- Leads drawer Production tab → Create order (+ optional quotation) — OWNER
- Production → Start order (lead only, no quotation) — OWNER
- AI tool `create_production_order`

1. `POST /production` → orderNumber `ORD-{year}-{seq}`, stage FABRIC_CHECK (service), trackingToken, ORDER_CREATED activity
2. Qlix sync mark

**Does NOT auto-fire on:** WON stage, ORDER_CONFIRMED call, invoice generation.

**Break:** Two create UIs with different quotation support. Stage enum default PENDING vs create uses FABRIC_CHECK.

---

## 15. Production stages → shipping → deliver

**Entry:** Production page

1. Advance stage (13 stages) with internal + customer-visible notes
2. Owner: budget, ETA, shipping fields, expenses, payments, order_status
3. Activities logged; customer tracking milestones mapped from stage
4. Share tracking link (copy / WhatsApp / QR)

**Customer:** `/track/:token` → collapsed milestones (CONFIRMED→DELIVERED)

**Break:** `on_hold_reason` never shown. Duplicate empty-state UI. n8n `production.stage_changed` never emitted.

---

## 16. Design / mockups

**Entry:** Production → Design tab

1. Upload artwork → pick garment template → place (x,y,scale,rotation) → Generate TEMPLATE_2D mockup
2. Download / send WhatsApp / delete

**Status:** Complete v1 (no AI generation — PIL compose).

---

## 17. Vendors & expenses

**Expenses:** Create multi-line (optional lead → job vs overhead) → list/edit/delete

**Vendors page:** Aggregates expense.vendor strings with heuristic type (Supplier/Job worker/Courier)

**Parallel:** Production inline expenses use fixed categories + different API path

**Break:** Two expense systems; no Vendor entity; no drill-down.

---

## 18. WhatsApp outbound

**Paths:** WhatsApp page Send; quotation/invoice send; telecaller post-call; tracking share; mockup share; auto-greet; follow-up telecaller reminder; AI tool

**Queue:** `OutboundMessage` QUEUED → poll 60s → Baileys if connected else Meta Cloud API

**Templates:** GREETING, FOLLOW_UP, QUOTATION, INVOICE, THANK_YOU

**Break:** Quotation PDF send requires Baileys specifically. Daily message caps by plan.

---

## 19. AI features

**Entry:** `/app/ai`

1. Optionally Activate Qlix → provision → CRM backfill → unlock chat
2. Chat stream → tools (32) mutate CRM when advanced mode
3. Approvals UI exists but Qlix governance is `auto` (writes immediate)
4. Memory extraction background; Brain docs upload
5. Usage: dual windows (5h session + weekly)

**Fallback:** Local OpenRouter agent if Qlix unavailable

---

## 20. Reports / CEO dashboard

**Entry:** `/app/ceo` — single `GET /dashboard/ceo?day=` — Overview/P&L/Pipeline/Activity tabs with deep links to other modules.

No separate Reports module.

---

## 21. Settings / brand / templates / team / subscription

Covered in product map. Billing = mailto only (`SUBSCRIPTION_SUPPORT_EMAIL`). No Stripe checkout despite `stripeCustomerId` field.

---

## 22. OAuth / integrations summary flow

Integrations page → OAuth return banners (`?meta=`, `?google=`, `?google_ads=`) → connected cards → Sync now.

Gmail used for quotation email; Calendar OAuth stored but no FastAPI calendar UI (exora MCP only).

---

## Cross-flow dependency (as implemented)

```
Lead capture (manual/CSV/Meta/Google/WA/IndiaMART)
  → Pipeline routing
  → Auto-greet / optional AI auto-call
  → Telecaller / Follow-ups
  → Quotation → send → (optional) Invoice
  → Manual Production order
  → Stages / finance / design / tracking
  → Customer /track/:token
```

**Largest flow breaks:** Quotation acceptance unused; ORDER_CONFIRMED ≠ order; dual lead stage systems; no Customer entity; invoice ≠ payment.
