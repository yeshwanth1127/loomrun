# Phase 3 — Orders action map

Every action from `ProductionPage` and where it lives now.

- **Orders list** = `/app/orders` (views: Active / Late / On hold / Shipped / Done / All)
- **Order** = `/app/orders/:orderId` (tabs: Overview / Design / Production / Shipping / Money)

| Old action | New home | Notes |
|---|---|---|
| Order list with date filter | Orders list | Same `day` param |
| Filter preset (active/delayed/on_hold/shipped/completed/all) | Orders list → view tabs | Same `filter` values, now in the URL as `?show=` |
| Filter by stage | Orders list → Filters | Same `stage` param |
| Filter by health status | Orders list → Filters | Same `order_status` param |
| Search order # / customer | Orders list → Filters | Same `search` param, same deferred input |
| Metrics: total / in progress / completed / delayed / over budget | Orders list | Same formulas; "over budget" still Owner-only |
| Start order (owner) | Orders list → New order | Same `POST /production`; now opens the new order |
| Expand row → Progress & finance | Order → Overview + Money | Split by subject instead of one long panel |
| Expand row → Tracking | Order → Shipping | Same tracking token, QR, actions |
| Expand row → Design | Order → Design | Same `ProductionDesignPanel`, unchanged |
| Next stage button | Order → Overview + Production | Both open the same confirm dialog |
| Stage dropdown (jump to any stage) | Order → Production → stage list | Click any stage to move there |
| Stage change notes (internal + customer) | Order → Production dialog | Same two fields, same payload |
| Status dropdown | Order → Production → Health | Same `order_status` PATCH; CANCELLED still Owner-only |
| Mark delayed toggle | Order → Overview | Same ON_TRACK ↔ DELAYED PATCH |
| Progress bar + % complete | Orders list card + Order → Overview | Same stage-index maths |
| "In stage for N days" | Orders list card + Overview | Same |
| Dispatch ETA + overdue label | Orders list card + Overview | Same `days_until_dispatch` copy |
| Rename order | Order → header pencil | Same `PATCH {name}` |
| Remove order (owner, confirm) | Order → header trash | Same confirm text; returns to the list |
| P&L strip (revenue/spend/margin/collected/budget) | Order → Overview + Money | Owner-only, unchanged |
| Set budget | Order → Money | Same `PATCH {budget_cents}` |
| Add expense (category/amount/vendor/note) | Order → Money → Add a cost | Same `POST /expenses` |
| Record payment (amount/status/note) | Order → Money → Money received | Same `POST /payments` |
| Expense list | Order → Money | Adds the date and note that were already returned |
| Payment list | Order → Money | Adds the date |
| Save ETA (completion + dispatch, with clear flags) | Order → Overview → Dates | Same payload incl. `clear_*` flags |
| Actual dispatch date | Order → Overview + Shipping | Same |
| Shipping: courier / tracking no / notes | Order → Shipping | Same PATCH; no longer hidden behind late stages |
| Tracking link + QR | Order → Shipping | Same URL and QR service |
| Copy tracking link | Order → Shipping | Same |
| Share tracking on WhatsApp | Order → Shipping | Same outbound endpoint and message text |
| Enable / disable tracking | Order → Shipping | Owner-only, same |
| Regenerate tracking link | Order → Shipping | Owner-only, same confirm |
| Open tracking page | Order → Shipping | Same `/track/:token` in a new tab |
| Generate first tracking link | Order → Shipping | Owner-only, same |
| Org-wide pipeline activity log (grouped, collapse all) | Orders list → Recent activity | Collapsed by default and only fetched when opened; each group links to its order |
| Per-order history | Order → Overview → History | Uses `GET /production/{id}/activities` (was unused by the UI) |
| Insight: production overview donut | Orders list | Same |
| Insight: department progress | Orders list → Work by stage | Same |
| Insight: upcoming deadlines | Orders list → Next dispatches | Rows now link to the order |
| Insight: quick actions | Orders list | Expenses link kept (owner); activity toggle added |
| Empty state | Orders list | Now distinguishes "no orders" from "no matches" |

## Redirect added

| Old URL | New URL |
|---|---|
| `/app/production` | `/app/orders` |

## Deliberate differences

1. **The order is a page, not a row expander** — deep-linkable, and one tab per subject.
2. **Shipping fields are always available**, not gated on the order reaching a dispatch stage.
3. **Per-order history replaces scanning the org-wide log** for one order; the org-wide log is still there.
4. **Costs and payments show their dates**, which the API already returned.

Role behaviour is unchanged: PRODUCTION sees ops tabs (Overview / Design / Production /
Shipping) and never Money; the API also blanks money fields for that role.
`ProductionPage.tsx` remains on disk pending Phase 7 sign-off.
