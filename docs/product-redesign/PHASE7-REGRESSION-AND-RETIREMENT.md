# Phase 7 — Regression verification & retirement candidates

Frontend refresh Phases 0–6 are implemented. **Nothing has been deleted.** This
document records what was verified automatically, what still needs a human on a
logged-in session, and which files become removable after sign-off.

---

## 1. What the refresh delivered

| Phase | Area | Result |
|---|---|---|
| 0 | Shell, design system, navigation | Sidebar is Home / Sales / Orders / Money / Settings with Ask AI; role-aware |
| 1 | Home | Attention hub over existing follow-up, lead, quotation, order and CEO endpoints |
| 2 | Sales | `/app/sales` list + `/app/sales/:leadId` workspace replace Leads, Follow-ups, Telecaller, Pipelines and the primary Quotations flows |
| 3 | Orders | `/app/orders` list + `/app/orders/:orderId` workspace replace the Production page's row expanders |
| 4 | Money | `/app/money/{invoices,expenses,suppliers}` wraps the existing three screens |
| 5 | Settings | Everything under `/app/settings/*`, grouped Connections / Brand & documents / Team / Plan & usage |
| 6 | Polish | Global search (⌘K), contextual "Ask AI", loading/error/empty states, responsive tab strips, terminology |

Backend: **no changes**. Every screen calls endpoints that already existed. The
only new endpoint *usage* is `GET /production/{id}/activities`, which shipped
earlier but had no caller.

---

## 2. Automated verification (run and passing)

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc -b` | clean |
| Production build | `npm run build` | clean |
| Lint on new code | `npx eslint src/pages/sales src/pages/orders src/pages/money src/components/GlobalSearch.tsx src/lib` | 1 known error, documented below |
| Role access matrix | `npx esbuild scripts/check-access.ts --bundle --platform=node --format=cjs --outfile=/tmp/check-access.cjs && node /tmp/check-access.cjs` | 36 / 36 pass |
| App boots (no session) | Browser smoke test of `/`, `/app/home`, `/login` | renders, redirects correctly, zero console errors |

The one remaining lint error is `react-hooks/set-state-in-effect` in
`LeadCallPanel.tsx`: the call form mirrors server values into local fields. The
usual fix (a remount `key`) is wrong here because a refetch during a live call
would destroy the Twilio device. The old `TelecallerPage` has the same pattern.

### Two access-control bugs found and fixed during this pass

1. `/app/leads/connections` (Integrations) matched the `/app/leads` prefix, so
   Sales/Telecaller/Viewer could have opened it. Settings and Money are now
   checked before the Sales prefixes.
2. `/app/ceo` was reachable by employees after Phase 0, but `GET /dashboard/ceo`
   is Owner-only, so the page would have filled with 403s. Now Owner-only.

`scripts/check-access.ts` pins both cases, plus the whole role matrix.

---

## 3. Redirects (old URL → new URL)

| Old | New |
|---|---|
| `/app` | `/app/home` |
| `/app/leads` | `/app/sales` |
| `/app/leads/follow-ups` | `/app/sales?view=follow-ups` |
| `/app/telecaller` | `/app/sales?view=calling` |
| `/app/telecaller?lead=X` | `/app/sales/X?tab=call` |
| `/app/pipelines` | `/app/sales/organize` |
| `/app/pipelines/:id` | `/app/sales/organize/:id` |
| `/app/quotations` | `/app/sales/quotes` |
| `/app/production` | `/app/orders` |
| `/app/invoices` | `/app/money/invoices` |
| `/app/expenses` | `/app/money/expenses` |
| `/app/vendors` | `/app/money/suppliers` |
| `/app/settings/telephony` | `/app/settings/calling` |
| `/app/document-templates` | `/app/settings/documents` |
| `/app/brand-assets` | `/app/settings/brand` |
| `/app/team` | `/app/settings/team` |
| `/app/subscription` | `/app/settings/plan` |
| `/app/whatsapp` | `/app/settings/whatsapp` |
| `/app/admin` | `/platform` |

**Deliberately not redirected:** `/app/leads/connections` still renders the
Integrations page, because Google OAuth and WhatsApp callbacks return to that URL
with query parameters that a `<Navigate>` would drop.

**Untouched, as required:** `/`, `/login`, `/register`, `/register-super-admin`,
`/track/:token`, `/platform`, and every API webhook and OAuth callback.

---

## 4. Manual regression checklist (needs a logged-in session)

Automated checks cannot exercise authenticated screens — no credentials were
available. Work through the action maps, which are written as checklists:

- `PHASE2-SALES-ACTION-MAP.md` — 60+ Sales actions
- `PHASE3-ORDERS-ACTION-MAP.md` — 40+ Orders actions

Priority items, because they touch money, messaging or telephony:

1. **Call a lead in the browser** (Twilio): register, connect, mute, hang up, and
   confirm the logged duration matches the call.
2. **Click-to-call** on Exotel/Plivo, and **AI auto-call**.
3. **Log a call** with each outcome; confirm follow-up scheduling, the catalog and
   quotation WhatsApp sends, and that lead fields edited in the form persist.
4. **Send a quotation** on WhatsApp and by email from a lead; check the PDF.
5. **Convert a quotation to an invoice**, then download both PDFs.
6. **Confirm an order** from a won lead, walk it through stages with customer
   notes, and check the customer tracking page shows them.
7. **Share a tracking link** on WhatsApp; regenerate it and confirm the old link dies.
8. **Record a cost and a payment**; check the order P&L and the Money screens agree.
9. **Import leads from CSV**, and drag cards across the Sales board.
10. **Each role** (Owner, Sales, Telecaller, Production, Viewer): sign in, confirm
    the sidebar has no dead links and no screen 403s.
11. **Org switch** and **trial-expired** behaviour.
12. **Mobile width**: Sales board, order tabs, Money tabs, search overlay.

---

## 5. Retirement candidates — DO NOT DELETE YET

Unreachable from the router today. They stay on disk so a revert is one route change.

| File | Replaced by | Notes |
|---|---|---|
| `pages/LeadsPage.tsx` (1.7k lines) | `pages/sales/SalesPage.tsx` + `LeadDetailPage` | Only referenced by `HomeBridgePage` |
| `pages/FollowUpsPage.tsx` | Sales → Follow-ups view | No references |
| `pages/TelecallerPage.tsx` | `LeadCallPanel` + `CallingView` | Only referenced by `HomeBridgePage` |
| `pages/ProductionPage.tsx` (1.6k lines) | `pages/orders/*` | Only referenced by `HomeBridgePage` |
| `pages/phase0/HomeBridgePage.tsx` | `pages/HomePage.tsx` | Phase 0 scaffold; keeps the four above alive |
| `pages/phase0/MoneyBridgePage.tsx` | `pages/money/MoneyPage.tsx` | Phase 0 scaffold |

Deleting `HomeBridgePage` first makes the other four provably dead.

**Keep** (still mounted inside the new shells): `PipelinesPage`,
`PipelineWorkspacePage`, `QuotationsPage`, `InvoicesPage`, `ExpensesPage`,
`VendorsPage`, `CEODashboardPage`, `ProductionDesignPanel`, `LeadSearchSelect`.

### Follow-ups worth a decision (not done here)

1. **"Lead" vs "enquiry"** — `09-terminology-simplification.md` prefers business
   language, but the word appears across reused legacy screens. A half-rename
   reads worse than either choice, so it needs one decision applied everywhere.
2. **Bundle size** — the main chunk is ~995 kB; the retired pages still compile
   into it only while `HomeBridgePage` exists. Route-level code splitting is the
   real fix and is a separate change.
3. **`CEODashboardPage` cross-links** still point at retired URLs and rely on the
   redirects; worth switching to `lib/appRoutes` when that page is next touched.
4. **Trial-expired employees** can ping-pong between the guard and the upgrade
   redirect. This predates the refresh, but it is now easy to fix in one place.
