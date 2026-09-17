# Phase 2 — Sales action map

Every action from the retired Sales surfaces and where it now lives. This is the
cutover checklist and the Phase 7 regression list for Sales.

Legend for "New home":
- **Sales list** = `/app/sales` (views: All / New / Follow-ups / Quoted / Won / Lost / Calls)
- **Lead** = `/app/sales/:leadId` (tabs: Overview / Call / Quotes / History / Order)
- **Organize** = `/app/sales/organize` (+ `/app/sales/organize/:pipelineId`)
- **Quotations** = `/app/sales/quotes`

---

## 1. LeadsPage (`/app/leads`) → redirects to Sales list

| Old action | New home | Notes |
|---|---|---|
| Board (kanban) by lead stage | Sales list → board layout | Same 8 stages, same labels/colours |
| Drag card between stages | Sales list → board | Same optimistic `PATCH /leads/{id}` `{stage}` |
| Show / hide closed columns | Sales list → board | Same Won/Lost summary line |
| Column count + value total | Sales list → board | Same `fmtINR` sum of `estimated_value` |
| Table view | Sales list → list layout | Adds a Value column; same click-through |
| Column sorting | Sales list → list layout | Same `localeCompare` numeric sort |
| Filter: source | Sales list → Filters | Same `source` param |
| Filter: stage | Sales list → view tabs | New/Quoted/Won/Lost replace the stage dropdown |
| Filter: pipeline | Sales list → pipeline selector | Same `pipeline_id` param |
| Filter: search | Sales list → Filters | Same `search` param |
| Filter: score min/max | Sales list → Filters | Same `score_min`/`score_max` params |
| Clear filters | Sales list → Filters trailing | Same |
| Global date filter | Sales list | Same `day` param; Follow-ups stays `day=all` as before |
| Add lead | Sales list → Add lead | Identical payload incl. `stage: 'NEW'` |
| Import CSV + sample download | Sales list → Import (owner) | Same `POST /leads/upload-csv`, same result summary |
| Open lead drawer | Lead (full page) | Drawer replaced by a durable, linkable page |
| Quick action: Call (`tel:`) | Lead → header | Same |
| Quick action: WhatsApp (`wa.me`) | Lead → header | Same |
| Quick action: Gmail (`mailto:`) | Lead → header | Same |
| Send Quote → WhatsApp / Email | Lead → header (Send quote) | Same first-PDF-wins rule, same error text and draft redirect |
| Stage select | Lead → header | Single `PATCH {stage}` (the old drawer fired two) |
| Call status select | Lead → Overview | Same `POST /telecaller/calls` `{outcome, next_call_at}` + optimistic update |
| Follow-up scheduler (presets + save) | Lead → Overview | Same `CallbackScheduleFields`, same validation text |
| Delete lead (with confirm) | Lead → header trash | Same confirm copy |
| Inline edit: phone/email/city/company | Lead → Overview info grid | Same field names |
| Inline edit: product interest/quantity | Lead → Overview | Same |
| Inline edit: region/sector/campaign id/campaign | Lead → Overview | Same `\|\| null` handling |
| Inline edit: estimated value | Lead → Overview | Same `Number()` / `null` |
| Inline edit: notes (+ "Add note") | Lead → Overview | Same reveal behaviour |
| Inline edit: follow-up datetime | Lead → Overview | Same guard: requires Follow Up outcome |
| Pipeline select | Lead → Overview | Same `PATCH {pipeline_id}` |
| Activity tab: log CALL/WHATSAPP/EMAIL/NOTE | Lead → History | Same `POST /leads/{id}/activities` |
| Activity timeline | Lead → History | Same icons and timestamps |
| Production tab: order list | Lead → Order | Now deep-links to the order workspace |
| Production tab: create order (+ quotation link) | Lead → Order → Confirm order | Same `POST /production` `{lead_id, quotation_id}` |
| Empty state → Integrations link | Sales list empty state | Owner only, same target |

## 2. FollowUpsPage (`/app/leads/follow-ups`) → Sales list → Follow-ups view

| Old action | New home | Notes |
|---|---|---|
| Due list (`last_call_outcome=CALLBACK_SCHEDULED`, `day=all`) | Follow-ups view | Same query, same 30s refetch |
| Tabs: All / Due today / Overdue | Follow-ups view | Same bucket rules (`due_now` counts in both) |
| Metrics: total, due today, overdue, upcoming, conversion | Follow-ups view | Same formulas |
| Search (title/phone/company/notes) | Follow-ups view | Same four fields |
| Table: lead, stage, next follow-up, relative time, status, reason, owner, last contact | Follow-ups view | Same, "Type" column dropped (it was a constant) |
| Row click → dialler | Follow-ups view → Lead | Opens the lead instead of the old Telecaller page |
| Row action: Call | Follow-ups view → Lead → Call | Same intent, one step shorter |
| Row action: WhatsApp | Follow-ups view | Same `wa.me` link |

## 3. TelecallerPage (`/app/telecaller`) → Lead → Call + Sales list → Calls workspace

| Old action | New home | Notes |
|---|---|---|
| Lead picker (`LeadSearchSelect`) | Calls workspace | Same component; dials in-place (no navigate away) |
| Deep link `?lead=` | Redirect → Calls workspace with lead selected | Preserved by `TelecallerRedirect` |
| Provider list (VOICE + provisioned + connected) | Lead → Call | Same filter |
| Provider auto-select | Lead → Call | Same |
| Manual ("my own phone") option | Lead → Call | Now shown even with no provider configured |
| Agent phone + `loomrun_agent_phone` persistence | Lead → Call | Same key |
| Click-to-call (Exotel/Plivo) | Lead → Call | Same `POST /telephony/click-to-call` |
| Browser call (Twilio device, register, connect) | Lead → Call | Same dynamic import and token endpoint |
| Mute / unmute | Lead → Call | Same |
| Hang up | Lead → Call | Same; now also advances to the log step |
| Live call timer | Lead → Call | Duration now measured from a ref (fixes stale-closure minutes) |
| AI auto-call | Lead → Call | Same `POST /telecaller/ai-call` |
| `tel:` fallback | Lead → Call + header | Same |
| Two-step Make call → Log result | Lead → Call | Same step model, same "Live" badge |
| Log outcome (all 8 statuses) | Lead → Call | Same options |
| Log duration (minutes → seconds) | Lead → Call | Same conversion |
| Log notes | Lead → Call | Same |
| Follow-up schedule on CALLBACK_SCHEDULED | Lead → Call | Same required-date validation |
| Send catalog on WhatsApp | Lead → Call | Same `send_catalog`, same connected-outcome gate |
| Send quotation on WhatsApp | Lead → Call | Same `send_quotation` |
| Lead field edits from the call form | Lead → Call → "Correct lead details" | Same payload keys |
| Lead stage change from the call form | Lead → Call | Same `stage` in payload |
| Send Quote dropdown | Lead → header | Same rules |
| Daily summary metrics | Calls workspace | Same aggregations (+ Qualified restored) |
| Outcome donut chart | Calls workspace | Same palette and mapping |
| Call log list | Calls workspace | Same ordering and time formatting |
| Call detail modal (transcript, recording, AI summary, next follow-up) | Calls workspace | All fields kept |
| Telecaller-scoped summary (`user_id`) | Calls workspace | Same role rule |
| Call-first default for TELECALLER | Sales list | Calls is the default view for that role |
| Continuous queue / Next lead after log | Calls workspace | Due follow-ups queue + Next button after save |

## 4. PipelinesPage + PipelineWorkspacePage → Organize

| Old action | New home | Notes |
|---|---|---|
| Pipeline list, search, show archived | Organize | Same screen, reused as-is |
| Create pipeline (type + copy default stages) | Organize | Same |
| Set default / archive / reactivate | Organize | Same |
| Open pipeline workspace | Organize → pipeline | Now at `/app/sales/organize/:id`; old URL redirects |
| Pipeline overview / board / table | Organize → pipeline | Reused as-is |
| Stage create / rename / reorder / delete | Organize → pipeline | Reused as-is |
| Routing rules (preview, apply, replace) | Organize → pipeline | Reused as-is |
| Campaign assignment | Organize → pipeline | Reused as-is |
| Delete pipeline | Organize → pipeline | Reused as-is |
| Access | Organize | Owner + Sales (matches the API's pipeline write roles) |

## 5. QuotationsPage (`/app/quotations`) → Quotations + Lead → Quotes

| Old action | New home | Notes |
|---|---|---|
| Full quotation list, date filter, status strip | Quotations | Same screen, reused as-is |
| Create quotation (lead picker, lines, catalog, template) | Lead → Quotes → New quotation | Lead is implied; catalog + template kept; running total added |
| Save as draft / Create (finalize + PDF) | Lead → Quotes | Same two-call sequence |
| Generate PDF (with template choice) | Lead → Quotes → Make the PDF | Same |
| Send on WhatsApp (DRAFT + PDF only) | Lead → Quotes | Same rule |
| Send / resend by email | Lead → Quotes | Same `lead_email` requirement |
| Preview PDF | Lead → Quotes | Same iframe modal, invoice variant when invoiced |
| Download quotation / invoice PDF | Lead → Quotes | Same variants and filenames |
| Convert to invoice | Lead → Quotes → Turn into invoice | Same |
| Rename title | Lead → Quotes | Same `PATCH /title` |
| Edit / revise lines | Lead → Quotes | Same `PATCH` payload and stage-change toast |
| Delete quotation | Lead → Quotes | Same confirm |
| `state: { leadId, openForm }` prefill | Quotations | Still honoured by the reused screen |
| Access | Both | Owner-only, unchanged from before |

---

## Redirects added

| Old URL | New URL |
|---|---|
| `/app/leads` | `/app/sales` |
| `/app/leads/follow-ups` | `/app/sales?view=follow-ups` |
| `/app/telecaller` | `/app/sales?view=calling` |
| `/app/telecaller?lead=X` | `/app/sales/X?tab=call` |
| `/app/pipelines` | `/app/sales/organize` |
| `/app/pipelines/:id` | `/app/sales/organize/:id` |
| `/app/quotations` | `/app/sales/quotes` |

## Deliberate differences

1. **Lead detail is a page, not a drawer** — it can be linked, bookmarked, and refreshed.
2. **Stage change fires one PATCH**, not the duplicate pair the old drawer sent.
3. **Browser-call duration is accurate** — the old handler read a stale `callSeconds`.
4. **Follow-ups "Type" column dropped** — it always rendered the same constant badge.
5. **Manual dialling is offered even with no provider connected**, where the old page hid the option.

No capability was dropped. Screen components for the retired surfaces remain on disk
(`LeadsPage`, `FollowUpsPage`, `TelecallerPage`) pending Phase 7 sign-off.
