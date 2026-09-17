# MASTER REDESIGN PLAN — Extreme Simplicity

**Date:** 2026-09-14 (clarified 2026-09-15)  
**Status:** Product UX target approved. Implementation planning lives in `MASTER-FRONTEND-REFRESH-PLAN.md`.  
**Inputs:** `docs/product-audit/*` (especially MASTER-AUDIT §F preserve list)  
**Detail docs:** `01`–`11` in this folder.

**Clarification:** The simplified flow **is** the frontend target. “Frontend-only” means new simplified UI on the **current backend** — not restyling the old multi-module IA. See `MASTER-FRONTEND-REFRESH-PLAN.md`.

---

## A. Product philosophy

Loomrun should feel like a **simple workbench for garment businesses**:

1. **Jobs over modules** — navigation follows work, not database tables.  
2. **One object at a time** — Enquiry/Lead before confirmation; **Order** after.  
3. **Next action on the current screen** — Call, Quote, Confirm, Advance, Share.  
4. **≤ 6 owner nav items** — hide setup and secondary lists.  
5. **Pipelines organize; they don’t fork the CRM.**  
6. **Calling is a mode inside Sales**, not a separate product.  
7. **Preserve capabilities; relocate surfaces** (Audit F).  
8. **Business words in UI**; technical names stay in code.  
9. **Home = attention**, not vanity analytics.  
10. **UX may lead schema** — but we label backend gaps honestly.

---

## B. Proposed navigation

```
Home
Sales
Orders
Money
Settings
```

**AI:** full existing capability kept via **global / contextual** access (not a fifth primary “daily module” peer). See frontend refresh plan.

| Section | Absorbs today |
|---------|----------------|
| Home | CEO urgency + follow-up badge + delayed ops |
| Sales | Leads, Follow-ups, Telecaller, Pipelines, primary Quotes |
| Orders | Production, Design, tracking, job pay/cost |
| Money | Invoices, Expenses, Vendors-as-supplier-group |
| Settings | Connections, Calling, Brand/Templates, Team, Plan/Usage |

Staff see fewer items; never show blocked routes.

---

## C. Main personas

1. **Owner** — whole business  
2. **Sales** (includes Telecaller role variant) — enquiries → order confirm  
3. **Production** — design + make + ship  
4. **Platform super-admin** — unchanged, out of factory UX  

No separate Accounts / WhatsApp-operator personas.

---

## D. Core product lifecycle

```
Enquiry → Contact / Follow-up → Quotation → Confirm Order
  → Design / Tech pack → Production → Dispatch → Delivery → Payment / Close
```

**Validated** against audit: all steps exist except a clear **Confirm Order** bridge (today’s biggest hole).  
**Design/Tech pack** reframes existing mockups + planned structure on the Order.

---

## E. New Sales experience

- One **Sales** app: board/list, pipeline filter, views (All / Mine / New / Follow-ups today / Quoted / Won / Lost)  
- **Deep-linked enquiry detail** with Call panel, Activity, Quotes, Orders links  
- Pipelines = dropdown + Organize settings  
- Telecaller island retired  
- Quotations created/sent from enquiry; Accept used; **Confirm order** CTA  

See `05-sales-flow.md`.

---

## F. New Order experience

- Nav label **Orders** (not Production)  
- Workspace tabs: Overview | Design | Production | Payments | Shipping | Costs | Activity  
- Maps 1:1 to current ProductionOrder capabilities  
- Public `/track/:token` unchanged  

See `06-order-production-flow.md`.

---

## G. Design / Tech pack flow

On **Order → Design**:

Upload → place → generate mockups (TEMPLATE_2D now; AI later) → approve → maintain tech-pack fields → production uses approved pack → share mockups via WhatsApp.

Not a standalone AI lab.

---

## H. Home / dashboard model

Role-aware **attention cards** with deep links; Owner **Business** panel holds CEO analytics.  
See `07-home-dashboard.md`.

---

## I. Screens removed / consolidated (as primary destinations)

| Removed from primary nav / standalone daily use | Becomes |
|-------------------------------------------------|---------|
| Follow-ups page | Sales view |
| Telecaller page | Sales call mode |
| Pipelines + workspace | Sales filter + organize |
| Quotations (as default path) | Sales Quotes (+ secondary list) |
| Invoices page | Money |
| Production page name | Orders |
| Vendors page | Money expenses grouping |
| WhatsApp app | Actions + Settings |
| CEO as Analytics nav | Home Business |

Capabilities remain reachable.

---

## J. Current → new route mapping (proposal)

| Current | Proposed |
|---------|----------|
| `/app/leads` | `/app/sales` |
| `/app/leads/:id` (new) | Enquiry detail |
| `/app/leads/follow-ups` | `/app/sales?view=follow-ups` |
| `/app/telecaller` | `/app/sales?mode=call` (+ `?lead=`) |
| `/app/pipelines` | Sales organize / pipeline switcher |
| `/app/pipelines/:id` | `/app/sales?pipeline=:id` |
| `/app/quotations` | `/app/sales/quotes` (secondary) |
| `/app/invoices` | `/app/money/invoices` |
| `/app/production` | `/app/orders` |
| `/app/orders` | `/app/orders` (real) |
| `/app/orders/:id` (new) | Order workspace |
| `/app/expenses` | `/app/money/expenses` |
| `/app/vendors` | `/app/money/expenses?group=supplier` |
| `/app/whatsapp` | deprecate daily; settings + embeds |
| `/app/ceo` | `/app` or `/app/home` Business |
| `/app/ai` | `/app/ai` |
| Settings paths | `/app/settings/*` grouped |
| `/track/:token` | unchanged |
| `/platform` | unchanged |

Redirects from old URLs recommended during rollout.

---

## K. Backend / data-model changes eventually required

| Priority | Change |
|----------|--------|
| P0 UX | Confirm-order service (wrap create + ACCEPTED + Won) |
| P0 UX | Fix invoice “Paid” to use Payment truth |
| P1 | UI single-stage (pipeline canonical); later deprecate LeadStage board |
| P1 | Tech pack JSON/fields on order |
| P2 | Soft Customer label vs hard Customer entity |
| P2 | Expense category unification |
| P2 | IndiaMART UI; n8n ship/kill |
| Later | True Invoice model; AI mockups; payment gateway |

Details: `11-backend-changes-required.md`.

**Phase A can ship major simplicity without schema migration.**

---

## L. Features preserved (mandatory — Audit F)

- Multi-tenant orgs, roles, trial/plan entitlements  
- Lead capture (manual, CSV, Meta, Google Ads, WA; IndiaMART backend) + scoring + attribution  
- Pipeline workspaces + routing rules + automation hooks (relocated UX)  
- Telecaller capabilities (providers, AI call, outcomes, reminders)  
- Quotations PDF/templates/brand/catalog/email/WA send  
- Invoice generation from quotations  
- Production stages, finance, shipping, activity  
- Public tracking links  
- Design mockups TEMPLATE_2D  
- WhatsApp Baileys + templates + auto-greet + outbound queue  
- Expenses ledger  
- CEO aggregates (on Home)  
- Loomrun AI / Qlix + metering + memory/docs  
- Platform admin  
- Telephony provisioning (Twilio/VAPI/Exotel)  

---

## M. Open product-owner decisions

1. **Public brand:** Noolrun vs Loomrun (pick one for UI + AI + tracking footer).  
2. **UI word “Enquiry” vs “Lead”?**  
3. **Confirm order:** require Accepted quote, or allow override?  
4. **Close definition:** delivered, or delivered + paid?  
5. **SALES UI access** to quotes/orders/pipelines (recommend yes — match backend).  
6. **Telecaller default:** embedded call-first Sales vs keep a simplified Calls landing (still not a separate CRM).  
7. **Customer entity:** soft label vs new table.  
8. **Invoice model:** keep on Quotation vs first-class.  
9. **Tech pack:** fields MVP list (sizes/colorways/fabric/notes?).  
10. **AI mockups timeline** vs template-only.  
11. **IndiaMART:** add connect UI or drop.  
12. **n8n:** ship Automation UI or remove.  
13. **WhatsApp daily app:** agree to remove from nav?  
14. **Self-serve billing** later?  
15. **Stage count on floor:** keep all 13 visible or progressive disclosure?  

---

## Implementation sequence (when coding starts — not now)

1. Information architecture + redirects  
2. Sales shell (views + detail URL + call panel)  
3. Confirm order CTA  
4. Orders workspace tabs  
5. Home attention  
6. Money section  
7. Settings regroup + WhatsApp demotion  
8. Terminology pass  
9. Phase B schema cleanups  

---

## Document index

| File | Contents |
|------|----------|
| `01-design-principles.md` | Philosophy & filters |
| `02-personas-and-jobs.md` | Personas + JTBD map |
| `03-proposed-navigation.md` | Nav & absorptions |
| `04-new-end-to-end-flow.md` | Lifecycle transitions |
| `05-sales-flow.md` | Sales consolidation |
| `06-order-production-flow.md` | Order + design/tech pack |
| `07-home-dashboard.md` | Role-aware Home |
| `08-screen-consolidation.md` | Tabs/drawers/filters |
| `09-terminology-simplification.md` | Plain language |
| `10-friction-comparison.md` | Current vs proposed |
| `11-backend-changes-required.md` | UX vs schema |
| `MASTER-REDESIGN-PLAN.md` | This file |

---

## Stop point

**Redesign planning complete. No application code, routes, or database changes were made.**  
Next step (when requested): decide open PO questions, then implement Phase A UX against existing APIs.
