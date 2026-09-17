# MASTER AUDIT — Noolrun / Loomrun Current-State Product Map

**Date:** 2026-09-14  
**Audience:** Product owners + AI agents redesigning UX/product flow  
**Rule:** This document describes **CURRENT BEHAVIOR ONLY**. It is not a redesign.

Detailed evidence lives in sibling files under `docs/product-audit/`.

---

## A. What the product currently does

**Noolrun** (marketing UI) / **Loomrun** (API & agent identity) is a **multi-tenant SaaS operations platform for garment manufacturers**.

An organization can:

1. **Capture leads** manually, CSV, Meta Lead Ads, Google Ads, WhatsApp inbound, and IndiaMART (backend; UI connect missing).
2. **Route leads** into **pipeline workspaces** with custom stages and org-wide routing rules — while a parallel **global LeadStage** kanban still powers the main Leads page.
3. **Call leads** via Twilio browser, Exotel/Plivo click-to-call, or VAPI AI; log dispositions; schedule follow-ups (in-app toasts + WhatsApp to telecallers).
4. **Quote** with line items/catalog, branded PDFs, email (Gmail) or WhatsApp (Baileys); convert quotes into **invoices** (same Quotation row).
5. **Run production orders** through a 13-stage factory pipeline with budget, payments, job expenses, shipping, customer **tracking links**, and **2D design mockups**.
6. **Message** via WhatsApp (Baileys primary, Meta Cloud fallback), templates, auto-greet.
7. **Track costs** in an expenses ledger and a derived Vendors view.
8. **See CEO analytics** (live aggregates) and chat with **Loomrun AI** (Qlix hosted agent + OpenRouter fallback) which can read/write CRM via tools.
9. **Configure** brand, PDF templates, telephony provisioning, team (telecallers), plan/usage; **platform admins** manage tenants.

There is **no** separate Customer, Order, Invoice, Vendor, or Shipment table — those concepts are projected onto Lead, ProductionOrder, Quotation, Expense.vendor, and shipping fields.

**Billing:** Manual (mailto / admin-assigned plans). No payment gateway. 14-day trial with Scale-level features, then lock.

---

## B. Complete module list

| Module | Routes / surfaces |
|--------|-------------------|
| Auth & landing | `/`, `/login`, `/register`, `/register-super-admin` |
| CRM — Leads | `/app/leads` (+ drawer) |
| CRM — Follow-ups | `/app/leads/follow-ups` |
| CRM — Pipelines | `/app/pipelines`, `/app/pipelines/:id` |
| CRM — Telecaller | `/app/telecaller` |
| Commerce — Quotations | `/app/quotations` |
| Commerce — Invoices | `/app/invoices` |
| Ops — Production / Orders | `/app/production` (`/app/orders` redirect) |
| Ops — Design mockups | Panel inside Production |
| Ops — Vendors | `/app/vendors` |
| Ops — Expenses | `/app/expenses` |
| Ops — WhatsApp | `/app/whatsapp` |
| AI | `/app/ai` |
| Analytics | `/app/ceo` |
| Settings | Integrations, Telephony, Templates, Brand, Team, Usage, Subscription |
| Platform | `/platform` |
| Public tracking | `/track/:token` |

See `01-current-product-map.md`, `02-navigation-map.md`, `10-route-screen-matrix.md`.

---

## C. Complete user-flow list

1. Auth / org onboarding (self-serve register)
2. Manual lead create
3. CSV lead import
4. Meta lead ingestion (webhook + poll)
5. Google Ads lead ingestion
6. IndiaMART ingestion (backend)
7. WhatsApp inbound → lead
8. Pipeline routing (auto + rules UI)
9. Follow-up schedule → toast → Telecaller
10. Telecalling (human + AI)
11. Implicit “conversion” (Won stage only — no Customer)
12. Quotation create → PDF → send → revise
13. Invoice generate/send
14. Production order create (manual)
15. Production stages → shipping → deliver
16. Customer tracking link
17. Design upload → mockup → WhatsApp
18. Expenses + Vendors rollup
19. WhatsApp outbound / templates / auto-greet
20. AI chat + Qlix activation + tools
21. CEO dashboard consumption
22. Settings: brand, templates, telephony, team, subscription
23. OAuth connect flows (Meta, Google, Google Ads)
24. Platform admin tenant management

See `03-user-flows.md`, `07-automations.md`, `14-feature-dependency-map.md`.

---

## D. Major UX / product problems

1. **Dual CRM stage systems** (global vs pipeline) with overlapping boards  
2. **Pipeline board lacks lead detail**  
3. **Employees see Pipelines nav but cannot access**  
4. **No first-class Customer / Invoice / Vendor / Order naming consistency**  
5. **Quote accept unused; won/ORDER_CONFIRMED don’t create orders**  
6. **Commerce↔ops handoffs are manual and split across pages**  
7. **Settings & integrations discoverability poor; n8n UI unshipped; IndiaMART UI missing**  
8. **AI “confirm writes” UX contradicts auto-execution**  
9. **Brand naming: Noolrun vs Loomrun vs Fabblen vs Exora**  
10. **Dense Production page; duplicated call/quote flows**

Full list: `11-product-ux-problems.md`.

---

## E. Major technical / legacy problems

1. Dual stage sync via `systemKey` is fragile  
2. Public webhooks with weak/missing auth  
3. JWT in localStorage  
4. ARQ underused; README outdated vs poll loops  
5. Stripe fields without checkout  
6. Many backend-only APIs  
7. n8n production event never emitted  
8. Invoice “Paid” status logic conflates enums  
9. Stub telephony providers  
10. Unwired exora MCP  

See `11-product-ux-problems.md`, `12-legacy-cleanup-candidates.md`.

---

## F. Features that must be preserved during redesign

These are production-used or differentiating — lose them carefully:

- Multi-tenant orgs, roles, trial/plan entitlements  
- Lead capture (manual, CSV, Meta, Google Ads, WA) + scoring + attribution fields  
- Pipeline workspaces + routing rules + systemKey automation hooks  
- Telecaller workflow + call outcomes + follow-up reminders  
- Quotations with PDF templates, brand assets, catalog, email/WA send  
- Invoice generation from quotations  
- Production orders with stages, finance, shipping, activity log  
- Public customer tracking links  
- Design mockups (TEMPLATE_2D)  
- WhatsApp Baileys connect + templates + auto-greet + outbound queue  
- Expenses ledger (job + overhead)  
- CEO dashboard live aggregates  
- Loomrun AI chat (Qlix + tools + usage metering + memory/docs)  
- Platform admin controls  
- Telephony provisioning (Twilio/VAPI/Exotel) at least  

Inventory: `04-feature-inventory.md`.

---

## G. Areas that can probably be removed (after PO confirmation)

- Unrendered n8n AutomationCard **or** ship it  
- Dormant AI approval UX **or** re-enable JIT governance  
- Fabblen brand leftovers  
- Stripe schema if payments stay manual  
- Stub telephony webhooks/adapters not on roadmap  
- Duplicate `/app/orders` and `/app/admin` aliases if unused externally  
- Consolidate WEB/WEBSITE; retire unused API endpoints  
- exora MCP if Calendar stays unused  

Details: `12-legacy-cleanup-candidates.md`.

---

## H. Questions / decisions needing product-owner input

1. **Single stage model?** Keep global LeadStage, pipelines-only, or hybrid with clear UX?  
2. **Is “Customer” a real entity** after Won, or forever a Lead?  
3. **Should ORDER_CONFIRMED / Won / Accepted Quote auto-create ProductionOrder?**  
4. **Are Invoices first-class documents** or forever Quotation variants?  
5. **Vendors:** real module or drop page?  
6. **Ship or kill n8n automations UI?**  
7. **IndiaMART:** add Integrations card or drop backend?  
8. **AI writes:** require confirmation (JIT) or keep auto + standing grants?  
9. **Final brand name:** Noolrun vs Loomrun?  
10. **Self-serve billing** (Stripe/Razorpay) or stay sales-led?  
11. **Role model:** should SALES access quotations/pipelines in UI to match backend?  
12. **Team invites:** password create vs email invite; which roles can owners add?  
13. **WhatsApp strategy:** Baileys-only, Meta-only, or keep hybrid (fix PDF send rules)?  
14. **Calendar:** build UI, keep MCP-only, or remove OAuth?  
15. **Employee nav:** hide inaccessible items (Pipelines) or grant access?

---

## Architecture snapshot (for agents)

| Layer | Location |
|-------|----------|
| Web | `apps/web` — React Router in `App.tsx`, shell in `AppShell.tsx` |
| API | `apps/api/loomrun_api` — FastAPI `/v1/*`, ~191 routes |
| Schema | `prisma/schema.prisma` |
| WA sidecar | `apps/whatsapp-baileys` |
| Qlix CRM MCP | mounted at `/mcp` |
| Standalone Google MCP | `apps/mcp/exora_mcp_server` (unwired) |
| Jobs | In-process polls in `main.py`; ARQ optional |

**Auth:** JWT Bearer; org context + role + feature + trial gates in `deps.py` / `entitlements.py`.

**Domain core:** Organization → Lead ↔ PipelineStage; Lead → Quotation → (optional) ProductionOrder; ProductionOrder → Payment/Expense/Activity/Design/Tracking.

---

## Document index

| File | Contents |
|------|----------|
| `01-current-product-map.md` | Every page/section |
| `02-navigation-map.md` | Real nav hierarchy + issues |
| `03-user-flows.md` | End-to-end flows |
| `04-feature-inventory.md` | Feature classification |
| `05-domain-model.md` | Entities & relations |
| `06-status-state-machines.md` | Enums & lifecycles |
| `07-automations.md` | Triggers → actions |
| `08-integrations.md` | External systems |
| `09-roles-permissions.md` | Roles FE vs BE |
| `10-route-screen-matrix.md` | Sitemap table |
| `11-product-ux-problems.md` | UX vs technical issues |
| `12-legacy-cleanup-candidates.md` | Removable suspects |
| `13-ui-component-inventory.md` | Reusable UI patterns |
| `14-feature-dependency-map.md` | Module dependencies |
| `MASTER-AUDIT.md` | This file |

---

## Stop point

Audit complete. **No redesigned product flow has been created.** Next step (when requested): use this map to design the new UX/product flow without dropping preserved features.
