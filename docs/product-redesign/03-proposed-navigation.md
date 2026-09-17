# 03 — Proposed Navigation

**Target:** Extreme simplicity. Owner ≤ 6 primary items. Staff fewer.

Capabilities move **into** sections; routes become redundant as **primary destinations**, not as deleted features.

---

## Proposed top-level (Owner)

```
Home
Sales
Orders
Money
Ask AI
Settings
```

That’s **6**. Down from ~15 owner destinations today.

---

## Why each section exists

### 1. Home
**Why:** Answers “What needs me?” on login. Replaces CEO-as-primary-analytics for daily work; CEO metrics become Home sections / “Business” panel for owners.  
**Absorbs:** CEO Dashboard daily urgency; follow-up badge; delayed orders; pending quotes.  
**Redundant as top nav:** `/app/ceo` as a separate “Analytics” island (keep deep analytics as Home tab “Business” or Settings-adjacent later).

### 2. Sales
**Why:** All pre-order work in one place.  
**Absorbs:**
- Leads (`/app/leads`)
- Follow-ups (`/app/leads/follow-ups`)
- Telecaller (`/app/telecaller`) — as **Call mode** / layout preference
- Pipelines list + workspace (`/app/pipelines*`) — as **pipeline filter + board view**, settings under Sales gear
- Quotations primary create/send path (from lead); optional “All quotes” subview
**Redundant as top nav:** Follow-ups, Telecaller, Pipelines, (primary) Quotations.

### 3. Orders
**Why:** Post-confirmation workbench. Design, production, shipping, job money, tracking.  
**Absorbs:**
- Production (`/app/production`)
- Design/mockups panel
- Order tracking share
- Job-linked expenses & payments (primary entry)
- `/app/orders` alias becomes the real name  
**Redundant as top nav:** “Production” label as primary; Vendors as fake CRM.

### 4. Money
**Why:** Business cash view without forcing production floor into accounts.  
**Absorbs:**
- Invoices (`/app/invoices`)
- Expenses ledger (`/app/expenses`)
- Vendors rollup (`/app/vendors`) as filter/group on expenses (“By supplier”)
- Owner P&L snippets from CEO  
**Redundant as top nav:** Separate Invoices + Expenses + Vendors.

### 5. Ask AI
**Why:** Distinct interaction model (conversation). Keep one place.  
**Absorbs:** `/app/ai` as today (Qlix activation, docs, grants stay inside).  
**Does not absorb:** Everyday CRM clicks — AI assists, doesn’t replace Sales/Orders.

### 6. Settings
**Why:** Rare setup, not daily work.  
**Absorbs (clearer inner groups):**
- **Connections:** lead sources (Meta, Google Ads, IndiaMART), WhatsApp QR, Gmail  
- **Calling:** telephony provision  
- **Documents & brand:** templates, logo, bank, catalog  
- **Team & access**  
- **Plan & usage**  
**Redundant as top nav:** Standalone WhatsApp ops app for daily messaging (send stays on Lead/Order; templates live in Settings).

---

## Staff nav (role-aware)

| Role | Sees |
|------|------|
| Sales / Telecaller | Home, Sales, Ask AI (+ Orders read if permitted) |
| Production | Home, Orders, Ask AI |
| Owner | All six |
| Viewer | Home (limited), Sales (read), Ask AI |

**Rule:** Never show a nav item the route guard will bounce.

---

## What happens to today’s routes (conceptual)

| Current route | Fate in redesign |
|---------------|------------------|
| `/app/leads` | → `/app/sales` (default list/board) |
| `/app/leads/follow-ups` | → `/app/sales?view=follow-ups` |
| `/app/telecaller` | → `/app/sales?mode=call` or focus layout; deep link `?lead=` kept |
| `/app/pipelines` | → `/app/sales` pipeline switcher; manage under Sales settings |
| `/app/pipelines/:id` | → `/app/sales?pipeline=` board; settings drawer |
| `/app/quotations` | → Secondary: `/app/sales/quotes` or Money/Sales subview; create from lead |
| `/app/invoices` | → `/app/money/invoices` |
| `/app/production` | → `/app/orders` |
| `/app/orders` | → Primary Orders (stop being a redirect) |
| `/app/vendors` | → `/app/money/expenses?group=supplier` |
| `/app/expenses` | → `/app/money/expenses` |
| `/app/whatsapp` | → Remove as daily nav; Settings templates + Lead/Order Send |
| `/app/ceo` | → Home “Business” for owners (or `/app/home?tab=business`) |
| `/app/ai` | → `/app/ai` (Ask AI) |
| Settings paths | → Grouped under `/app/settings/*` |
| `/track/:token` | → Unchanged (public) |
| `/platform` | → Unchanged |

Exact path strings are proposals; mapping table also in MASTER plan §J.

---

## Pipeline placement (critical)

**Do not** give Pipelines a sidebar icon.

Inside Sales:
- Pipeline dropdown: All | Sales | Diwali campaign | South region | …
- Views: Board | List  
- Gear “Organize pipelines” (owner): rename, stages, auto-assign rules  

Routing rules copy: **“Automatically put new enquiries in the right list”** — not “PipelineRoutingRule”.

---

## WhatsApp placement

| Need | Where |
|------|-------|
| Message this lead | Sales detail → WhatsApp |
| Message about this order / tracking / mockup | Order → Share |
| Templates & auto-greet | Settings → WhatsApp |
| Message history for a lead | Sales detail → Activity |
| Org-wide message log (rare) | Settings or Money/Sales admin subview |

---

## Nav anti-patterns we explicitly avoid

- Separate Follow-ups + Telecaller + Leads  
- Separate Production vs Orders  
- Separate Vendors entity page without Vendor model  
- Analytics as a lonely top item when Home exists  
- Settings contents that feel like daily apps (WhatsApp send)
