# 01 — Current Product Map

**Product:** Noolrun / Loomrun (garment manufacturing operations SaaS)
**Audit date:** 2026-09-14
**Scope:** Current-state only. No redesign recommendations in this file.

---

## Product one-liner (current)

Multi-tenant SaaS for custom garment manufacturers covering:
**Lead capture → CRM / pipelines → telecalling → quotations / invoices → production orders (with design mockups + customer tracking) → WhatsApp follow-ups → expenses / vendors → CEO analytics → AI assistant.**

Stack: React (Vite) + FastAPI + PostgreSQL (Prisma) + Baileys WhatsApp sidecar + optional Qlix hosted AI + Redis/ARQ (underused).

---

## Page inventory

For each page: route, nav parent, purpose, actions, data, APIs, models, integrations, roles, links, completeness.

### Auth & public

| Page | Route | Nav | Purpose | Completeness |
|------|-------|-----|---------|--------------|
| Landing | `/` (logged out) | Public | Marketing site for Noolrun | Complete (static) |
| Login | `/login` | Public | Email/password login | Complete |
| Register | `/register` | Public | Self-serve org + owner creation | Complete |
| Register Super Admin | `/register-super-admin` | Public (allowlisted email) | Platform admin signup | Complete |
| Track Order | `/track/:token` | Public (customer) | Customer-facing order status | Complete |

### CRM

#### Leads — `/app/leads`
- **Nav:** CRM → Leads (default home for non-telecallers)
- **Purpose:** Primary CRM hub — all leads, board/table, detail drawer
- **Modes:** Board (kanban by global `LeadStage`) | Table; Show/Hide closed (WON/LOST)
- **Detail:** Right drawer (not a route) — Overview / Activity / Production (owner)
- **Actions:** Add lead, CSV import (owner), DnD stage change, edit fields, log activity, set call status/follow-up, Send Quote (WA/Gmail), create production order (owner), delete
- **Filters:** Search, source, pipeline, stage, score min/max; global DateFilterBar
- **Data:** Stage columns with value sums; table: Name, Company, Pipeline, Stage, Score, Follow-up
- **APIs:** `GET/POST/PATCH/DELETE /v1/orgs/{id}/leads*`, activities, quotations send, production create, telecaller/calls, CSV upload, pipelines list
- **Models:** Lead, LeadActivity, Pipeline, Quotation, ProductionOrder, TelecallerCallLog
- **Integrations:** WhatsApp send, Gmail mailto, tel:
- **Roles:** All employees can view/edit; Import CSV + Production tab = OWNER
- **Links:** → Integrations, → Production, → Quotations
- **Status:** **Complete** (dual stage model caveat vs Pipeline Workspace)

#### Follow ups — `/app/leads/follow-ups`
- **Nav:** CRM → Follow ups (badge from due count)
- **Purpose:** Queue of `CALLBACK_SCHEDULED` leads by due bucket
- **Actions:** Tab filter (all/today/overdue), search, Call → Telecaller, WhatsApp external
- **APIs:** `GET /leads?last_call_outcome=CALLBACK_SCHEDULED`
- **Models:** Lead (+ last call fields)
- **Roles:** All employees
- **Status:** **Complete**

#### Pipelines — `/app/pipelines`
- **Nav:** CRM → Pipelines
- **Purpose:** List/create/archive pipeline workspaces
- **Actions:** Create, set default, archive/reactivate, open workspace
- **APIs:** `GET/POST/PATCH /pipelines`
- **Models:** Pipeline, PipelineStage
- **Roles:** Backend allows OWNER/SALES; frontend `EmployeeRouteGuard` blocks non-owners (nav still shows for all → access mismatch)
- **Status:** **Complete** (access bug)

#### Pipeline Workspace — `/app/pipelines/:pipelineId`
- **Nav:** Nested (from Pipelines list)
- **Tabs:** Overview | Board | Table | Settings
- **Purpose:** Per-pipeline analytics, kanban by custom stages, routing rules, stage editor
- **Actions:** DnD by `pipeline_stage_id`, save stages, routing rules CRUD/apply, archive/delete pipeline
- **APIs:** overview, stages PUT, routing-rules*, lead PATCH, lead-attribution/campaigns
- **Models:** Pipeline, PipelineStage, PipelineRoutingRule, Lead
- **Roles:** Owner (via route guard)
- **Status:** **Partial** — no lead detail drawer; table not clickable

#### Telecaller — `/app/telecaller`
- **Nav:** CRM → Telecaller (default home for TELECALLER role)
- **Purpose:** Call workflow — pick lead, dial, log result, daily metrics
- **Modes:** Make call | Log result; call detail modal
- **Actions:** Click-to-call (Exotel/Plivo), Twilio browser, AI auto-call (VAPI), log outcome, send quote, WhatsApp automation checkboxes
- **APIs:** telecaller/calls, daily-summary, telephony providers/click-to-call/browser-token, ai-call, quotations send
- **Models:** Lead, TelecallerCallLog, TelephonyConfig, Quotation
- **Integrations:** Twilio, Exotel, Plivo, VAPI
- **Roles:** All employees; summary scoped to self for TELECALLER
- **Status:** **Complete**

#### Integrations (Lead Connections) — `/app/leads/connections`
- **Nav:** Settings → Integrations (sidebar “Settings” lands here)
- **Purpose:** Connect lead sources, WhatsApp, Google services
- **Sections:** Lead Sources | Messaging (WA) | Google (Gmail, Calendar)
- **Actions:** Connect/disconnect OAuth/API key, Meta sync, Google Ads sync, WhatsApp QR
- **APIs:** lead-connections*, meta/oauth+sync, google-ads/oauth+sync, google/connections, connectors/whatsapp*, automation-connections* (fetched but UI not rendered)
- **Models:** LeadConnection, AutomationConnection, WhatsAppConnection
- **Integrations:** Meta, Google Ads, Gmail, Calendar, WhatsApp Baileys, n8n (dead UI)
- **Roles:** OWNER
- **Status:** **Partial** — n8n AutomationCard built but not rendered; IndiaMART backend exists with no connect card

---

### Commerce

#### Quotations — `/app/quotations`
- **Nav:** Commerce → Quotations
- **Purpose:** Create/edit quotes, PDF, send WA/email, convert to invoice
- **Actions:** New/edit/rename/delete, generate PDF, preview/download, Email, WhatsApp, Convert to invoice
- **APIs:** quotations CRUD, generate-pdf, send, generate-invoice, pdf-file, catalog, document-templates, leads
- **Models:** Quotation, QuotationLine, CatalogItem, DocumentTemplate, Lead
- **Roles:** OWNER nav; backend also allows SALES/TELECALLER for list/send/pdf
- **Status:** **Complete** (no Accept status button; WhatsApp send gate quirk)

#### Invoices — `/app/invoices`
- **Nav:** Commerce → Invoices
- **Purpose:** View invoices (quotations with `invoice_number`)
- **Actions:** Preview, rename, download, send WA/email, delete; “New invoice” → Quotations
- **APIs:** Same quotations endpoints filtered client-side
- **Models:** Quotation (invoice fields)
- **Roles:** OWNER
- **Status:** **Partial** — no independent invoice entity/create form

---

### Ops

#### Production — `/app/production` (alias `/app/orders` → redirect)
- **Nav:** Ops → Production
- **Purpose:** Production orders — stages, finance, shipping, tracking, design, activity
- **Panels:** Progress & finance | Tracking | Design (ProductionDesignPanel)
- **Actions:** Start order, advance stage, budget/ETA/shipping, expenses/payments, tracking link share, design mockups, rename, remove
- **APIs:** production*, tracking regenerate/patch, WhatsApp outbound, design/mockup endpoints
- **Models:** ProductionOrder, ProductionActivity, Payment, Expense, ProductionDesignAsset, ProductionMockup
- **Roles:** OWNER + PRODUCTION role
- **Status:** **Complete** (duplicate empty-state bug; Start order lacks quotation picker)

#### Vendors — `/app/vendors`
- **Nav:** Ops → Vendors
- **Purpose:** Derived vendor rollup from expenses (no Vendor entity)
- **APIs:** `GET /expenses?scope=all`
- **Status:** **Partial** (read-only aggregation)

#### Expenses — `/app/expenses`
- **Nav:** Ops → Expenses
- **Purpose:** Org expense ledger (job + overhead)
- **Actions:** Multi-line create, edit, delete; scope/category filters
- **APIs:** expenses CRUD
- **Models:** Expense, Lead
- **Roles:** OWNER
- **Status:** **Complete** (split model vs production-order expenses)

#### WhatsApp — `/app/whatsapp`
- **Nav:** Ops → WhatsApp
- **Tabs:** Send | Templates | Automations | History
- **Actions:** Send to lead, CRUD templates, toggle auto-greet
- **APIs:** integrations/whatsapp/*
- **Models:** OutboundMessage, WhatsAppTemplate, Organization.autoGreetNewLeads
- **Roles:** OWNER (templates also SALES via canManage)
- **Status:** **Partial** — Automations tab is stub

---

### AI & Analytics

#### Loomrun AI — `/app/ai`
- **Nav:** AI → Loomrun AI
- **Purpose:** Conversational CRM assistant (Qlix primary / local OpenRouter fallback)
- **Features:** Streaming chat, conversations, voice STT/TTS, pending approvals UI, standing grants, org memory, Qlix Brain docs, agent activity dock
- **APIs:** ai/*, qlix/activate, qlix/documents*
- **Models:** AiConversation, AiMessage, AiOrgMemory, AiPendingAction, QlixConnection, QlixDocument, QlixToolGrant
- **Roles:** All employees; owner-only tools enforced server-side
- **Status:** **Complete** (approval UX largely dormant — Qlix tools set to `auto`)

#### CEO Dashboard — `/app/ceo`
- **Nav:** Analytics → CEO Dashboard
- **Tabs:** Overview | P&L | Pipeline | Activity
- **Data:** Funnel, pipeline value, sources, order status, financials, client P&L, bottlenecks, recent activity — all from live API (not mocked)
- **APIs:** `GET /dashboard/ceo`
- **Roles:** OWNER
- **Status:** **Complete** (`integrations` field unused in UI)

---

### Settings (SettingsLayout)

| Page | Route | Purpose | Status |
|------|-------|---------|--------|
| Integrations | `/app/leads/connections` | Lead sources + WA + Google | Partial |
| Telephony | `/app/settings/telephony` | Provision Twilio/VAPI/Exotel | Complete (managed); Partial (BYO) |
| Document templates | `/app/document-templates` | PDF layout builder | Complete |
| Brand assets | `/app/brand-assets` | Logo, signature, UPI, bank, catalog CSV | Complete |
| Team | `/app/team` | Add members, WhatsApp reminder phones | Partial (only TELECALLER role in add form) |
| Usage | `/app/settings/usage` | AI + WhatsApp meters | Complete |
| Subscription | `/app/subscription` | Plans, trial, upgrade mailto | Complete (no payment gateway) |

All settings: OWNER or super_admin.

---

### Platform admin

#### Admin — `/platform`
- **Nav:** Settings → Platform Admin (super_admin only)
- **Purpose:** Cross-tenant SaaS control — analytics, org plan/seats/suspend, join-as-support, memberships, super-admin toggles
- **APIs:** `/v1/admin/*`
- **Status:** **Complete**

---

## Hidden / nested / non-sidebar surfaces

| Surface | How reached |
|---------|-------------|
| Pipeline Workspace | Pipelines row click |
| Lead detail drawer | Leads board/table click |
| Production Design panel | Production → Design tab |
| Track Order | Shared link `/track/:token` |
| Call detail modal | Telecaller call log click |
| Quotation/Invoice PDF preview | Row click / Actions |
| Settings sub-pages | Settings inner nav only |
| `/app/orders` | Redirect → Production |
| `/app/admin` | Redirect → `/platform` |
| Follow-up toast | AppShell poll → Follow ups |

---

## Completeness summary

| Verdict | Pages |
|---------|-------|
| Complete | Landing, Login, Register, Super-admin register, Track Order, Leads, Follow ups, Pipelines list, Telecaller, Quotations, Production (+ Design), Expenses, Brand assets, Document templates, Telephony (managed), Usage, Subscription, CEO Dashboard, AI Chat, Platform Admin |
| Partial | Pipeline Workspace, Integrations, Invoices, Vendors, WhatsApp, Team, Telephony BYO |
| Placeholder / stub UI | WhatsApp Automations tab; n8n AutomationCard (unrendered) |
| Legacy redirects | `/app/orders`, `/app/admin` |
