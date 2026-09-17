# 04 — Feature Inventory

Classification key:
- **Production-ready** — shipped and wired end-to-end
- **Working but rough** — works with known quirks
- **Partial** — incomplete surface
- **Backend only** — API/service exists, no/minimal UI
- **Frontend only** — UI without full backend
- **Placeholder** — stub UI
- **Legacy** — older path kept for compat
- **Dead/unused** — code present, not reachable or not called
- **Duplicate** — overlaps another feature

---

## Auth & tenancy

| Feature | Class |
|---------|-------|
| Email/password register + login | Production-ready |
| JWT access + refresh (localStorage) | Production-ready |
| Super-admin allowlist register | Production-ready |
| Org switcher (multi-membership) | Production-ready |
| Trial 14-day + lock redirect | Production-ready |
| Org suspend (admin) | Production-ready |
| Create additional org API | Backend only |
| Invite-by-email | Dead/unused (not built) |
| Stripe customer / subscription IDs | Legacy / unused for checkout |

## CRM — Leads

| Feature | Class |
|---------|-------|
| Kanban by global LeadStage | Production-ready |
| Table view + client sort | Production-ready |
| Lead detail drawer | Production-ready |
| Manual create | Production-ready |
| CSV import | Production-ready |
| CSV export | Dead/unused |
| Filters (source/pipeline/stage/score/search/day) | Production-ready |
| Lead score (source + completeness) | Production-ready |
| Activity timeline + log | Production-ready |
| Inline field edit | Production-ready |
| Call status + follow-up in drawer | Production-ready / Duplicate (vs Telecaller) |
| Send quote from drawer | Production-ready / Duplicate |
| Create order from drawer | Production-ready |
| Assignee field | Backend only (not in UI) |
| leadStatus field | Backend only (rarely surfaced) |
| Tags array | Backend/schema only |

## Pipelines

| Feature | Class |
|---------|-------|
| Multi pipeline workspaces | Production-ready |
| Default Sales pipeline seed | Production-ready |
| Custom stages (OPEN/WON/LOST + probability + systemKey) | Production-ready |
| Kanban by pipeline stage | Partial (no lead detail) |
| Pipeline overview KPIs/funnel | Production-ready |
| Org-wide routing rules | Production-ready |
| Re-apply rules to existing leads | Production-ready |
| Archive / delete / move leads | Production-ready |
| Dual stage sync (legacy Lead.stage ↔ pipeline) | Working but rough / Duplicate concept |

## Follow-ups

| Feature | Class |
|---------|-------|
| Due queue page | Production-ready |
| In-app toast + ack | Production-ready |
| WhatsApp reminder to telecaller | Production-ready |
| Schedule from Telecaller/Leads | Production-ready |

## Telecaller & telephony

| Feature | Class |
|---------|-------|
| Lead picker + call workflow | Production-ready |
| Call outcome logging | Production-ready |
| Daily summary metrics | Production-ready |
| Call log + detail (transcript/recording) | Production-ready |
| Twilio browser calling | Production-ready |
| Exotel click-to-call | Production-ready |
| Plivo click-to-call | Working but rough |
| VAPI AI auto-call | Production-ready |
| Platform provision (Twilio/VAPI/Exotel) | Production-ready |
| BYO telephony credentials API | Backend only |
| Telnyx / Vonage / Retell / Bland | Placeholder (stub webhooks/adapters) |
| Delayed AI auto-call on new lead (5 min) | Production-ready |

## Quotations & invoices

| Feature | Class |
|---------|-------|
| Quotation CRUD + line items | Production-ready |
| Catalog fill | Production-ready |
| PDF generate + preview + download | Production-ready |
| Document template builder | Production-ready |
| Send email (Gmail) | Production-ready |
| Send WhatsApp (Baileys) | Working but rough (Baileys-only for PDF) |
| Convert to invoice | Production-ready |
| Invoice list page | Partial (filtered quotations) |
| Quotation title/rename | Production-ready |
| Accept/Reject status UI | Dead/unused |
| Multi-version quotations | Partial (`version` field exists) |

## Production / orders

| Feature | Class |
|---------|-------|
| Production order CRUD | Production-ready |
| 13-stage pipeline | Production-ready |
| Order status (ON_TRACK…CANCELLED) | Production-ready |
| Budget + P&L strip | Production-ready |
| Job expenses + payments | Production-ready |
| ETA + shipping fields | Production-ready |
| Activity log (org-wide) | Production-ready |
| Customer tracking token + public page | Production-ready |
| Tracking share (copy/WA/QR) | Production-ready |
| Design upload + 2D mockups | Production-ready |
| Mockup WhatsApp send | Production-ready |
| Auto-create order from won/quote | Dead/unused |
| Orders route alias | Legacy redirect |
| on_hold_reason UI | Dead/unused |

## Expenses & vendors

| Feature | Class |
|---------|-------|
| Org expenses ledger | Production-ready |
| Multi-line create | Production-ready |
| Job vs overhead scope | Production-ready |
| Production-inline expenses | Production-ready / Duplicate |
| Vendors aggregation page | Partial |
| Vendor entity CRUD | Dead/unused |

## WhatsApp & messaging

| Feature | Class |
|---------|-------|
| Baileys QR connect | Production-ready |
| Meta Cloud API fallback outbound | Working but rough (global number) |
| Outbound queue processor | Production-ready |
| Templates CRUD | Production-ready |
| Auto-greet new leads | Production-ready |
| Send page + history | Production-ready |
| Automations tab | Placeholder |
| Inbound Meta WA webhook | Working but rough (no sig) |
| WhatsAppThread/Message models | Partial (inbound path) |

## Integrations

| Feature | Class |
|---------|-------|
| Meta Lead Ads OAuth + webhook + poll | Production-ready |
| Google Ads OAuth + poll | Working but rough |
| Gmail OAuth + send + inbox sync | Production-ready (sync UI missing) |
| Google Calendar OAuth | Partial (MCP only) |
| IndiaMART sync/webhook | Backend only (no UI connect) |
| n8n provision + events | Partial (UI unrendered; production event missing) |
| Google Drive | Dead/unused |

## AI

| Feature | Class |
|---------|-------|
| Chat UI + streaming | Production-ready |
| Conversation history | Production-ready |
| 32 CRM tools | Production-ready |
| Qlix provision + Brain sync | Production-ready |
| Local OpenRouter fallback | Production-ready |
| Org memory | Production-ready |
| Knowledge docs upload | Production-ready |
| Voice STT/TTS | Production-ready |
| Pending approval UI | Partial / dormant (auto governance) |
| Standing tool grants | Production-ready (for JIT path) |
| Dual credit windows | Production-ready |
| Automation LLM proxy for n8n | Backend only |
| exora MCP (Gmail/Calendar) | Backend only / unwired to chat |

## Analytics & admin

| Feature | Class |
|---------|-------|
| CEO dashboard (live) | Production-ready |
| Platform admin analytics | Production-ready |
| Plan/seats/suspend controls | Production-ready |
| Join-as-support | Production-ready |
| Usage meters page | Production-ready |
| Subscription mailto upgrade | Production-ready |
| Payment gateway checkout | Dead/unused |

## Cross-cutting UX patterns

| Feature | Class |
|---------|-------|
| Global DateFilterBar | Production-ready |
| Dark mode | Production-ready |
| Role-based nav + route guard | Working but rough (Pipelines mismatch) |
| Entitlement / plan feature gates | Production-ready |
| Agent activity dock | Production-ready |
| MetricCard / Donut / Funnel / BarList | Production-ready (reusable) |
| Modal / FilterToolbar / EmptyState / Skeleton | Production-ready |
| RowActions | Partial (unused on CRM pages) |
