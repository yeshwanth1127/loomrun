# UI Component Inventory (reusable patterns)

Patterns already in the app that a redesign can reuse. Not a separate numbered deliverable in the request list, but required by section 10 of the audit brief.

---

## Layout shells
- `AppShell` — sidebar groups, org switcher, trial banners, date filter, agent dock
- `SettingsLayout` — secondary settings nav
- `PlatformAdminShell` — super-admin chrome

## Data display
- `ui/dashboard.tsx` — MetricCard, DonutChart, FunnelChart, BarList, InsightCard
- Tables (page-local) with badges, sticky actions
- Kanban boards (Leads + Pipeline Workspace — duplicated implementations)
- Activity timelines (Lead drawer, Production activity log, Track order updates)
- Progress bars / stage steppers (Production, TrackOrder milestones)

## Overlays & chrome
- `ui/Modal.tsx`
- Drawers (LeadDetailDrawer — page-local, not shared component)
- Dropdowns / RowActions kebab
- Toasts (sonner) — follow-up due
- EmptyState, Skeleton, PageHeader, FilterToolbar

## Forms & inputs
- LeadSearchSelect (async lead picker — widely reused)
- CallbackScheduleFields
- DateFilterBar + DateFilterContext
- File uploaders (CSV, brand assets, designs, Qlix docs)
- Document template section editor (rich layout JSON, not WYSIWYG rich text)
- Placement canvas (design mockups — pointer drag)

## AI / media
- AgentActivityTrace + AgentActivityDock + AgentActivityContext
- QlixActivation
- Speech to text / speech synthesis hooks
- NoolrunWordmark + Threads (marketing/brand)

## Filters / search
- FilterToolbar pattern
- Global day filter
- Client-side search on several list pages
- No command palette / global search today

## Notifications
- Follow-up toasts only (no general notification center)

## Charts
- Donut, Funnel, BarList, sparkline (expenses) — custom lightweight, not a heavy charting lib

## Reuse recommendations (observation only)
Highest reuse value: MetricCard/charts set, LeadSearchSelect, Modal, FilterToolbar, EmptyState, Auth+entitlement contexts, DateFilter, RowActions.
Kanban should be **unified** (currently two divergent boards) if redesign keeps boards.
Lead detail should become a **shared** surface (drawer or route) usable from Leads, Pipelines, Follow-ups.
