# 08 — Screen Consolidation

UX simplification map. **Backend compatibility retained**; surfaces relocate.

---

## Pages → tabs / views / drawers

| Current page | Becomes | Notes |
|--------------|---------|-------|
| Leads | Sales list/board | Primary |
| Follow-ups | Sales view `follow-ups` | |
| Telecaller | Sales detail Call panel + call mode | |
| Pipelines list | Pipeline switcher + Manage | |
| Pipeline workspace | Sales board with `pipeline=` + settings drawer | |
| Pipeline overview analytics | Optional Sales insights strip / Home | |
| Quotations | Sales detail Quotes + secondary All quotes | |
| Invoices | Money → Invoices | |
| Production | Orders list + Order workspace | |
| Production Design panel | Order → Design tab | Elevate |
| Vendors | Money → Expenses group by supplier | |
| Expenses | Money → Expenses | |
| WhatsApp (send/history) | Lead/Order actions + Activity; templates in Settings | |
| WhatsApp Automations stub | Remove from UX or replace with plain auto-greet toggle in Settings | |
| CEO Dashboard | Home → Business | |
| Lead detail drawer | Sales detail **route** (shareable) | Upgrade |
| Settings scatter | Grouped Settings | |

---

## Actions that move onto detail pages

| Action | From | To |
|--------|------|-----|
| Call / log / follow-up | Telecaller page | Sales detail |
| Send quote | Quotations page / drawer duplicate | Sales detail Quotes |
| Create order | Leads drawer + Production form | Confirm order CTA |
| Send tracking | Production expand | Order Shipping |
| Mockup WA | Design panel | Order Design |
| Record payment | Production expand | Order Payments |
| Job expense | Production expand | Order Costs |
| Auto-greet toggle | WhatsApp page | Settings → WhatsApp |

---

## Duplicated functionality to unify (UX)

1. **Call status + follow-up** — one component used by Sales detail only  
2. **Send quote** — one flow (PDF check, channel picker)  
3. **Kanban** — one board component driven by pipeline stages  
4. **Expense entry** — one form; job expenses always require order context; overhead from Money  
5. **Stage language** — one sales stage UI; one order stage UI  

---

## Status systems visible to users (simplify)

| Keep visible | Hide / merge in UI |
|--------------|-------------------|
| Sales stage (pipeline stage name) | Parallel LeadStage board |
| Order factory stage | Raw enum soup without labels |
| Order health (On track / Delayed…) | delayFlag as separate confusing toggle — fold into health |
| Quote status: Draft / Sent / Accepted / Rejected | Expired can be auto later |
| Payment: Pending / Partial / Paid | Don’t fake Paid on invoice without Payment |

---

## Screens that remain separate (justified)

| Screen | Why separate |
|--------|----------------|
| Home | Attention hub |
| Sales | Pre-order work |
| Orders | Post-order work |
| Money | Org cash without floor noise |
| Ask AI | Different interaction |
| Settings | Rare configuration |
| Public track | Unauthenticated customer |
| Platform admin | Super-admin only |

---

## Count

| | Approx destinations in daily UI |
|--|--------------------------------|
| Before (owner sidebar-ish) | ~15 |
| After | 6 primary + settings inner + public track |
