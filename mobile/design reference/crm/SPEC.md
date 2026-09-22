# Loom Run CRM — source-of-truth spec (from website screenshots)

> Screenshots referenced: Leads (Board view) and Follow ups pages of the Loom Run
> web app ("Business OS"), org **EXORA SOLUTIONS**, captured 08-09-2026.
>
> **The raw PNGs still need to be saved here** as `leads-board.png` and
> `follow-ups.png` (plus `telecaller.png` when available). They were pasted into
> the chat; the assistant cannot write pasted image bytes to disk, so drop the
> files into this folder manually. This document transcribes everything they
> show so the mobile build is not blocked in the meantime.

## Web IA

Left sidebar groups:

- **CRM**: Leads · Follow ups · Telecaller
- COMMERCE: Quotations · Invoices
- OPS: Production · Vendors · Expenses · WhatsApp

Global top bar: Period selector (`All`) + date, org switcher, trial banner.

The mobile app adapts the **CRM** group only.

---

## Leads page

Header: **Leads** · `1 lead` (count). Actions: `Import CSV` (outline), `+ Add Lead` (filled).

Toolbar:

- **Board / Table** view toggle (segmented; Board is default)
- Search — placeholder `Search name, phone…`
- **All Sources** dropdown
- **All Stages** dropdown
- **Score min** / **Score max** numeric inputs
- `Show closed (0)` toggle — reveals the closed columns (Won / Lost)

### Pipeline stages (ordered)

`New → Contacted → Requirement Collected → Quoted → Negotiation → Won → Lost`

Won and Lost are **closed** and hidden until "Show closed" is on.

### Board column header

`<Stage name>   <lead count>   <₹ sum of lead values in that column>`
e.g. `New   1   ₹10,000`. Empty columns show `0` and a `Drop leads here` dropzone.

### Lead card (Board)

- Left vertical accent strip (colour tracks score band; amber for the sample)
- **Name** (person) — `raghu`
- Company — `exora solutions`
- Chip row: **Source** (`WhatsApp`), **Score** (`50`, coloured pill), **Status/disposition** (`Busy`)
- Footer: `<location> · <relative last activity>` — `bangalore · 50m ago`
- Per-lead value exists (rolls up into the column sum)

Searchable fields: name, phone.

---

## Follow ups page

Header: **Follow ups** · `0 scheduled` badge. Subtitle: "Stay on top of every
follow-up and never miss one." Action: `+ Schedule follow-up` (filled).

Tabs: **All follow ups (N)** · **Due today (N)** · **Overdue (N)**
Search — placeholder `Search leads, phone, notes…`

### Summary metric tiles

| Tile | Value | Caption |
|---|---|---|
| TOTAL FOLLOW UPS | N | Scheduled |
| DUE TODAY | N | High priority |
| OVERDUE | N | Requires action |
| UPCOMING | N | Later dates |
| CONVERSION FROM FOLLOW UPS | N% | `X to quotes · Y orders` |

Tile style: white card, rounded, tinted rounded-square calendar icon
(teal / teal / amber / blue / teal), uppercase label, large number, caption.

### Follow-up entry

Shows the related customer/lead (name, company, phone), the scheduled
timing, and the action/notes. Overdue entries are clearly flagged.
Tapping opens the related lead.

---

## Telecaller page

CRM nav item (phone icon). Screenshot pending — build a minimal call-list
screen consistent with the design and refine once the screenshot is added.

---

## Mobile adaptation rules (from the user)

- Kanban stays the **primary** Leads experience; swipe horizontally between stages.
- Keep Add Lead, search, Source/Stage/Score filters, Show closed, Board/Table.
- Do **not** reduce the board to plain chips + a flat list.
- Follow-ups: keep the same tabs, metrics and hierarchy; make metrics
  mobile-friendly; Schedule Follow-up must work.
- Use existing `AppColors` / Home visual language. No Stitch, no HTML.
- Do not touch Home or auth.
