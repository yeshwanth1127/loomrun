# MASTER FRONTEND REFRESH PLAN

**Status:** Approved direction — planning only. **Do not implement yet.**  
**Date:** 2026-09-15  
**Supersedes ambiguity in:** earlier “frontend-only” wording that could be read as “restyle the current IA.”

---

## 0. Clarification (read this first)

### What we ARE doing

```
CURRENT BACKEND + CURRENT BUSINESS LOGIC
                 ↓
        NEW SIMPLIFIED FRONTEND
```

The **target UX** is the simplified product from `MASTER-REDESIGN-PLAN.md`:

- Fewer nav items  
- Sales / Orders / Money / Home consolidations  
- Guide users through Lead → … → Payment/Close  
- Next action on the current screen  

This is a **major UX / information-architecture change**.

### What we are NOT doing

```
CURRENT BACKEND
        ↓
CURRENT COMPLICATED FRONTEND + NEW STYLING   ← REJECTED
```

- Not “keep Leads + Pipelines + Telecaller + Quotations as separate apps with a fresh coat of paint.”  
- Not backend redesign, schema migration, or new domain entities.  
- Not implementing future features (AI Tech Pack productization, new Customer table, etc.) in this refresh.  
- Not deleting backend capabilities.

### “Frontend-only” means

| Allowed | Forbidden |
|---------|-----------|
| New routes, shells, pages, composition | Changing Prisma schema for the refresh |
| Calling existing `/v1/...` APIs | Rewriting services/automations “to match UI names” |
| UI labels: Order, Sales stage, etc. | Renaming ProductionOrder in DB |
| Relocating every old action into new screens | Dropping Telecaller/Pipeline/Quote actions because the page went away |
| Redirects from old routes | Breaking public/OAuth/webhook/track URLs |
| Thin UI orchestration (e.g. Confirm Order = existing create + status patches) | New architecture that replaces proven business logic |

**Presentation + flow consolidation. Not backend consolidation.**

---

## 1. Approved product structure

### Primary navigation (Owner)

```
Home
Sales
Orders
Money
Settings
```

**AI:** Not a fifth daily module in the primary list. Keep **full existing AI capability** accessible **globally / contextually** (e.g. persistent entry, dock, or contextual “Ask” from Lead/Order) so nothing is lost. Full AI chat surface remains; it is just not forced as a peer of Sales/Orders in the mental model.

### Consolidation map

| Current frontend | Becomes |
|------------------|---------|
| Leads, Pipelines, Follow-ups, Telecaller, Quotations (primary path) | **Sales** |
| Production, Design/Mockups, Payments, Shipping, Production activity | **Orders** |
| Invoices, Expenses, Vendors | **Money** |
| CEO dashboard + operational urgency | **Home** |
| Integrations, Telephony, Brand, Templates, Team, Usage, Subscription | **Settings** (grouped) |

### Target business flow (user-facing)

```
Lead
  → Contact / Follow-up
  → Quotation
  → Confirm Order
  → Order
  → Design / Tech Pack   ← existing mockup/design capabilities; no new AI tech-pack product yet
  → Production
  → Shipping
  → Delivery
  → Payment / Close
```

Obvious next actions stay on-screen (Call, WhatsApp, Follow-up, Quote, Confirm Order, Upload Design, Advance stage, Dispatch, Record payment).

---

## 2. Non-negotiable: no feature loss

For every old screen being consolidated:

1. **Inventory** every action, filter, modal, metric, deep link.  
2. **Map** each to a new location.  
3. **Reuse** the same API + business logic.  
4. **Regression-test** the mapped action.  
5. Only then mark the old surface as retireable.

If Telecaller today supports next-lead, call, disposition, schedule follow-up, activity, AI calling, provider selection — **all** of that must live in Sales (typically Lead Detail + call mode / telecaller-oriented default view).

If Pipelines today supports create, custom stages, campaign fields, routing, edit, archive, board, table, overview — **all** of that must live under Sales (pipeline selector + Organize/Manage).

**Simplified UI ≠ simplified capability.**

Preserve list remains Audit F / redesign §L (capture, pipelines/routing, telecaller stack, quotes/PDF/send, invoice generate, production stages/finance/shipping/tracking, mockups, WA, expenses, CEO aggregates, AI, platform admin, telephony provision).

---

## 3. Sales target (Phase 2 — highest priority)

One cohesive workspace.

**Views:** All | New | Follow-ups | Quoted | Won | Lost  
**Pipeline:** `[ All Pipelines ▼ ]` + Organize / Manage  
**Modes:** Board | List where appropriate  
**Lead Detail:** central workspace — Call, WhatsApp, Follow-up, Quotation, Notes, Activity, lead info, source/campaign, pipeline/stage — without bouncing across modules.

**Backend stays:** Lead APIs, pipeline APIs, telecaller/telephony APIs, quotation APIs, LeadStage + PipelineStage compatibility (UI presents one coherent story).

---

## 4. Orders target (Phase 3)

User-facing home for **ProductionOrder** (still that model/API).

```
Orders list → Order workspace
  Overview | Design | Production | Shipping | Money
```

Activity can live in Overview.  
Preserve: stages, mockups, payments, expenses, shipping, tracking, activities.

**No new Order backend.**

---

## 5. Money target (Phase 4)

Frontend organization of Invoices + Expenses + supplier/vendor grouping.  
Same quotation/expense APIs.

---

## 6. Home target (Phase 1)

“What needs my attention?” using existing data (new leads, follow-ups due, pending quotations, orders needing attention, delayed production, deliveries, payments).  
Analytics secondary / expandable from existing CEO dashboard aggregates.

---

## 7. Settings target (Phase 5)

Groups:

- Connections  
- Calling  
- Brand & Documents  
- Team  
- Plan & Usage  

Do not remove integration capabilities.

---

## 8. Old routes & safety

- Build **new** primary routes for Home / Sales / Orders / Money / Settings.  
- Keep old routes as **redirects or compatibility** until regression proves replacement.  
- **Never** change public/external/callback routes (`/track/:token`, OAuth callbacks, webhooks, `/platform`, auth).  
- Module-by-module rollout; do not big-bang delete old pages.

### Implementation safety loop (every module)

1. Inventory old screen actions  
2. Map → new screen  
3. Reuse API/business logic  
4. Build new frontend surface  
5. Regression-test mapped actions  
6. Only then retire old frontend surface  

---

## 9. Out of scope for this refresh

- New features discussed separately (true AI Tech Pack product, Customer entity, payment gateway, etc.)  
- Backend architecture redesign  
- Dual-stage schema cleanup (UI can hide complexity; fields stay)  
- Aggressively deleting old components before verification  

**After** this refresh lands and is stable: then add planned new features on the simpler shell.

---

## 10. Phase-by-phase frontend implementation plan

### PHASE 0 — Shell + design system + navigation

**Status: COMPLETE (2026-09-15)** — see implementation notes below.

**Goal:** New app chrome only. No feature behavior changes yet.

**Deliver:**
- New sidebar: Home, Sales, Orders, Money, Settings  
- Global/contextual AI entry that still reaches full existing AI page/capability  
- Role-aware nav (hide inaccessible items; no dead Pipelines link for blocked roles)  
- Route stubs or soft redirects: `/app` → Home; placeholders that still deep-link to **current** working pages temporarily if needed  
- Shared layout primitives aligned with existing UI kit (do not invent a parallel design system from scratch)  
- Old routes still work  

**Exit criteria:** User can see new nav; clicking can still reach working features (via stub→old or temporary embed). Zero regression on auth, org switch, trial lock, platform admin.

**Not in Phase 0:** Rebuilt Sales/Orders logic.

**Implemented:**
- Primary nav in `AppShell.tsx`: Home / Sales / Orders / Money / Settings; Ask AI in footer; Platform Admin for super-admins
- Role visibility: Owner sees all five; Sales/Telecaller/Viewer see Home+Sales; Production sees Home+Orders; no Pipelines dead link
- Bridges: `/app/home` role-embeds CEO/Telecaller/Production/Leads; `/app/sales` → LeadsPage; `/app/orders` → ProductionPage; `/app/money` → MoneyBridgePage links
- Legacy routes unchanged and still mounted
- `employeeMayAccess` updated for new paths; deny redirects → `/app/home`
- Login / `/` / `/app` → `/app/home`
- Public `/track`, `/platform`, auth routes untouched
- `npm run build` passes

---

### PHASE 1 — Home

**Status: COMPLETE (2026-09-15)** — `pages/HomePage.tsx`.

**Goal:** Attention hub on existing APIs.

**Reuse:**
- `GET .../follow-ups/due` (+ ack if needed)  
- `GET .../dashboard/ceo`  
- Existing leads/quotations/production list filters as needed for cards  

**Deliver:**
- Cards: new leads, follow-ups due, pending quotations, orders needing attention, delayed production, payments/collections signals  
- Each card deep-links into **current** or **new** Sales/Orders routes (as those phases land, update links)  
- Secondary “Business” / analytics using CEO data (not the primary above-the-fold)  

**Exit criteria:** Owner/Sales/Production each see useful attention lists; no CEO capability permanently lost (aggregates still reachable).

---

### PHASE 2 — Sales (most important consolidation)

**Status: COMPLETE (2026-09-15)** — `pages/sales/*`; action map in `PHASE2-SALES-ACTION-MAP.md`.

**Goal:** One Sales workspace replacing daily use of Leads + Follow-ups + Telecaller + Pipelines + primary Quotations.

**2a — Inventory & action map (before UI cutover)**  
Produce a checklist mapping every action from:

- `LeadsPage` (board/table, filters, CSV, drawer overview/activity/production, send quote, call status, etc.)  
- `FollowUpsPage`  
- `TelecallerPage` (providers, click-to-call, browser, AI call, log, daily summary, call detail modal, send quote, WA checkboxes, etc.)  
- `PipelinesPage` + `PipelineWorkspacePage` (overview, board, table, stages, routing, archive/delete, etc.)  
- `QuotationsPage` primary create/send/accept paths  

…into Sales list / Lead Detail / Organize Pipelines / Quotes section.

**2b — Build**
- Sales list: views All | New | Follow-ups | Quoted | Won | Lost  
- Pipeline selector + Board/List  
- Lead Detail as central workspace (deep link `/app/sales/:leadId` or equivalent) with Call / WhatsApp / Follow-up / Quotation / Notes / Activity / info / source / stage  
- Embed telecaller capabilities in Lead Detail (+ optional call-first default for TELECALLER role)  
- Organize/Manage Pipelines (all pipeline + routing capabilities)  
- Quotations create/send/revise from Lead Detail; secondary “all quotes” if needed for parity  
- Confirm Order CTA = existing production create (+ quote status patches as thin UI orchestration)—**no new Order service architecture**  

**2c — Compatibility**
- Redirect `/app/leads`, `/app/leads/follow-ups`, `/app/telecaller`, `/app/pipelines`, `/app/pipelines/:id` → Sales equivalents  
- Keep `/app/quotations` as redirect or secondary until Phase 2 regression done  

**Exit criteria:** Action-map 100% covered in QA; telecaller role can complete a full day without old Telecaller page; pipeline organize parity; quote send from lead works.

---

### PHASE 3 — Orders

**Status: COMPLETE (2026-09-15)** — `pages/orders/*`; action map in `PHASE3-ORDERS-ACTION-MAP.md`.

**Goal:** Orders list + Order workspace over ProductionOrder APIs.

**Tabs:** Overview | Design | Production | Shipping | Money  
Activity in Overview (or dedicated if needed for parity).

**Reuse:** production list/patch, design/mockup endpoints, tracking, payments, expenses, activity-log, WhatsApp share.

**Compatibility:** `/app/production` → `/app/orders`; `/app/orders` becomes real (stop being a silent alias only).

**Exit criteria:** Every Production page action has a home; Production role workflow intact; tracking/mockups/payments unchanged in behavior.

---

### PHASE 4 — Money

**Status: COMPLETE (2026-09-15)** — `pages/money/MoneyPage.tsx` wraps the three existing screens.

**Goal:** Single Money area.

- Invoices (existing quotation invoice filter/APIs)  
- Expenses (existing expenses APIs)  
- Supplier/vendor grouping (existing derived vendor view)  

**Compatibility:** redirect `/app/invoices`, `/app/expenses`, `/app/vendors`.

**Exit criteria:** Invoice send/download/rename/delete; expense CRUD; vendor rollup equivalent.

---

### PHASE 5 — Settings

**Status: COMPLETE (2026-09-15)** — grouped `SettingsLayout`, all settings under `/app/settings/*`.

**Goal:** Grouped settings, full capability.

- Connections (lead sources, WA QR, Google, etc.)  
- Calling (telephony provision)  
- Brand & Documents  
- Team  
- Plan & Usage  

**Exit criteria:** No integration or settings action missing vs current SettingsLayout pages.

---

### PHASE 6 — Global polish

**Status: COMPLETE (2026-09-15)** — `components/GlobalSearch.tsx` (⌘K), contextual Ask AI, states, responsive, terminology.

- Search (reuse existing list search patterns; no new backend search product unless already exists)  
- Contextual AI entry points (still full AI capability)  
- Responsive behavior  
- Loading / error / empty states  
- Terminology consistency (Order, Sales, etc.)  

**Still no new product features.**

---

### PHASE 7 — Regression verification + old frontend retirement candidates

**Status: automated checks done, manual QA pending, nothing deleted** — see `PHASE7-REGRESSION-AND-RETIREMENT.md`.

- Full action-map regression across Sales / Orders / Money / Home / Settings / AI  
- Confirm redirects  
- List old page components eligible for removal **only after** sign-off  
- Public/OAuth/webhooks/track/platform untouched  

**Stop short of deleting** until PO/QA sign-off.

---

## 11. Suggested route sketch (frontend only)

| New primary | Backed by |
|-------------|-----------|
| `/app` or `/app/home` | dashboard + follow-ups + list APIs |
| `/app/sales` | leads + pipelines filters |
| `/app/sales/:leadId` | lead detail + telecaller + quotes APIs |
| `/app/sales/organize` (or modal) | pipelines + routing-rules APIs |
| `/app/orders` | production list |
| `/app/orders/:orderId` | production + design + tracking + pay/expense |
| `/app/money/*` | quotations (invoices) + expenses |
| `/app/settings/*` | existing settings APIs |
| AI entry → existing `/app/ai` (or equivalent) | ai/* + qlix/* unchanged |

Old paths → redirects during transition.

---

## 12. Relationship to other docs

| Doc | Role after this clarification |
|-----|-------------------------------|
| `MASTER-REDESIGN-PLAN.md` | Product UX target (still valid); nav AI note updated by **this** doc |
| `01`–`11` redesign details | Reference for jobs, friction, terminology |
| `docs/product-audit/*` | Capability inventory & preserve list |
| **This file** | **Implementation planning for the frontend refresh** |

---

## 13. Success definition

A garment-business employee understands:

- I have a **lead** → I need to **sell** (Sales).  
- I have an **order** → I need to **make and deliver** (Orders).  
- I have **money** due/spent → I manage it (Money).  
- Something needs me → **Home** tells me.  

…while every previously working capability still works on the **same production backend**.

---

## Stop point

This document revises the frontend refresh plan only.  
**No implementation in this step.**

Next step when requested: begin **Phase 0** (shell + nav) only, with an explicit action-map artifact for Phase 2 Sales before cutting over Telecaller/Pipelines.
