# 02 — Navigation Map

**Source of truth:** `AppShell.tsx` (`buildWorkspaceGroups`), `SettingsLayout.tsx`, `App.tsx` routes, `membership.ts` / `EmployeeRouteGuard`.

---

## Actual sidebar hierarchy (OWNER / full access)

```
CRM
├── Leads                         /app/leads
├── Pipelines                     /app/pipelines
│     └── Pipeline Workspace      /app/pipelines/:pipelineId   (nested, not in sidebar)
├── Follow ups                    /app/leads/follow-ups        (badge: due count)
└── Telecaller                    /app/telecaller

Commerce
├── Quotations                    /app/quotations
└── Invoices                      /app/invoices

Ops
├── Production                    /app/production
├── Vendors                       /app/vendors
├── Expenses                      /app/expenses
└── WhatsApp                      /app/whatsapp

AI
└── Loomrun AI                    /app/ai

Analytics
└── CEO Dashboard                 /app/ceo

Settings  (single sidebar entry → Integrations; inner nav for the rest)
├── Integrations                  /app/leads/connections
├── Telephony                     /app/settings/telephony
├── Document templates            /app/document-templates
├── Brand assets                  /app/brand-assets
├── Team                          /app/team
├── Usage                         /app/settings/usage
└── Subscription                  /app/subscription

Platform Admin (super_admin only) /platform

Footer
├── Plan badge + trial days
├── Manage → /app/subscription
└── User / theme / logout
```

## Sidebar for non-owner employees

```
CRM
├── Leads
├── Pipelines          ← VISIBLE but route-guard redirects to /app/leads
├── Follow ups
└── Telecaller

Ops (PRODUCTION role only)
└── Production

AI
└── Loomrun AI
```

No Commerce, Analytics, Settings, or Platform Admin.

## Public / auth routes (no sidebar)

| Route | Page |
|-------|------|
| `/` | Landing (or redirect if logged in) |
| `/login` | Login |
| `/register` | Register org |
| `/register-super-admin` | Super-admin register |
| `/track/:token` | Customer order tracking |

## Default landings after login

| Who | Redirect |
|-----|----------|
| Super-admin (no orgs) | `/platform` |
| TELECALLER role | `/app/telecaller` |
| Everyone else with org | `/app/leads` |
| Trial expired | Forced to `/app/subscription` |

---

## Duplicated navigation concepts

1. **Leads board vs Pipeline Workspace board** — two kanbans, two stage systems (`LeadStage` vs `PipelineStage`).
2. **WhatsApp** appears as Ops page and again under Settings → Integrations (connector).
3. **Telephony** settings vs Telecaller ops page — related but separate.
4. **Invoices vs Quotations** — invoices are filtered quotations, not a separate module.
5. **Orders vs Production** — `/app/orders` redirects to Production; UI label is “Production” but entities are production orders.
6. **Settings discoverability** — only one sidebar item; rest hidden in inner nav.
7. **“Loomrun AI”** in sidebar vs **“Noolrun”** wordmark branding.

## Confusing naming

| UI label | Reality |
|----------|---------|
| Noolrun (sidebar/landing) | Backend/agent still “Loomrun” |
| Loomrun AI | Product branded Noolrun |
| Production | Is the orders module |
| Invoices | Subset of quotations |
| Vendors | Expense aggregation, not a vendor CRM |
| Follow ups | Only `CALLBACK_SCHEDULED` leads |
| Pipelines (nav for employees) | Not accessible |

## In code but missing from navigation

| Item | Where |
|------|-------|
| Pipeline Workspace | Nested only |
| Track Order | Public link only |
| Lead detail | Drawer, no URL |
| Production Design | Panel inside Production |
| n8n Automations UI | Code exists, not rendered |
| IndiaMART connect | Backend only |
| Gmail inbox UI | Backend APIs only |
| BYO telephony form | Backend `PUT .../telephony/byo` only |

## Nav items leading to incomplete features

| Item | Issue |
|------|-------|
| Pipelines (employees) | Dead end — redirected |
| WhatsApp → Automations tab | Stub links only |
| Settings → Integrations | n8n section missing from render |
| Vendors | No vendor CRUD |
| Invoices → “New invoice” | Goes to Quotations |
| Team | Cannot add SALES/PRODUCTION/VIEWER from UI |
