# 09 — Roles & Permissions

---

## Roles (`MembershipRole`)

| Role | Intended job |
|------|----------------|
| **OWNER** | Full tenant control — CRM, commerce, ops, settings, billing |
| **SALES** | CRM-focused (backend allows more than frontend) |
| **TELECALLER** | Calling + CRM lead views; default home Telecaller |
| **PRODUCTION** | Production orders ops (no money/settings) |
| **VIEWER** | Read-ish CRM + AI (same employee path set as sales/telecaller in frontend) |
| **is_super_admin** (User flag) | Platform admin + optional org OWNER memberships |

---

## Frontend access matrix

Source: `membership.ts` EMPLOYEE_PATHS / PRODUCTION_PATHS + `EmployeeRouteGuard` + `AppShell` nav + `SettingsLayout`.

| Module / route | OWNER | SALES | TELECALLER | PRODUCTION | VIEWER | Super-admin |
|----------------|:-----:|:-----:|:----------:|:----------:|:------:|:-----------:|
| Leads | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (if in org) |
| Follow-ups | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Telecaller | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pipelines (nav) | ✓ | shown* | shown* | shown* | shown* | ✓ |
| Pipelines (access) | ✓ | ✗ redirect | ✗ | ✗ | ✗ | ✓ |
| Quotations / Invoices | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Production | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ |
| Vendors / Expenses / WhatsApp page | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| CEO Dashboard | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Loomrun AI | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Settings (all) | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Platform Admin | — | — | — | — | — | ✓ |

\*Non-owners **see** Pipelines in sidebar but are redirected to `/app/leads` — frontend/backend mismatch (backend allows OWNER+SALES for many pipeline writes).

Trial expired: all `/app/*` forced to Subscription (except subscription itself); brand paths also allowlisted server-side.

---

## Backend role gates (representative)

| Area | Roles |
|------|-------|
| Most lead read/write | Any org member (`get_org_context`) |
| Pipeline create/update/stages/rules | OWNER, SALES |
| Pipeline delete | OWNER |
| Lead connections / connectors | OWNER |
| Quotations list/send/pdf | OWNER, SALES, TELECALLER |
| Quotation create/update/delete/PDF gen/invoice | OWNER (rename: OWNER,SALES) |
| Production list/update | OWNER, PRODUCTION |
| Production create/delete/tracking admin/payments/expenses | OWNER |
| Design mockups read | OWNER, PRODUCTION, SALES |
| Design write | OWNER, PRODUCTION |
| Expenses org ledger | OWNER |
| WhatsApp outbound | OWNER, PRODUCTION |
| WhatsApp templates/settings | OWNER |
| Catalog / document templates / brand / team / subscription | OWNER |
| CEO dashboard | OWNER |
| AI chat | Any member (tool owner_only enforced) |
| Qlix activate | OWNER |
| Admin routes | require_super_admin |
| Automation LLM | API key (not user JWT) |

---

## Frontend vs backend disagreements

| Topic | Frontend | Backend |
|-------|----------|---------|
| Pipelines for SALES | Blocked | Allowed OWNER+SALES |
| Quotations for SALES/TELECALLER | Hidden | List/send/pdf allowed |
| Production for SALES design read | No page access | Design read includes SALES |
| WhatsApp outbound for PRODUCTION | No WhatsApp page | API allows PRODUCTION |
| Team add roles | Only TELECALLER in dropdown | Any MembershipRole |
| Admin delete membership | No UI | DELETE endpoint exists |

---

## Special views

| Role | Special behavior |
|------|------------------|
| TELECALLER | Home = Telecaller; daily summary filtered to self |
| PRODUCTION | Ops nav shows Production only; no budget/P&L/payments UI |
| OWNER | Full nav; Import CSV; Settings; finance |
| Super-admin | `/platform`; can join org as OWNER; set plans/seats/suspend |

---

## Entitlements (plan features)

Separate from roles — see `08-integrations.md`. Enforced via `require_feature`, capacity checks, trial lock (HTTP 402).
