# 05 — Sales Flow Redesign

Consolidate **Leads + Pipelines + Follow-ups + Telecaller (+ primary Quotations)** into one **Sales** experience.

---

## Product statement

**Sales is where enquiries become orders.**  
Everything before “Confirm order” lives here. Pipelines organize work; they are not a second product.

---

## Primary screen: Sales

### Layout

```
[ Pipeline: All ▾ ]  [ Board | List ]     [ + New enquiry ] [ Import ]

Views:  All | Mine | New | Follow-ups today | Quoted | Won | Lost
Search + source filter (advanced behind “More filters”)
```

Optional for Telecaller role default:

```
Views default = Follow-ups today
Layout = Call-first (wider call panel when a row is open)
```

### Board vs List

- **One stage model in the UI** — the columns are the **active pipeline’s stages** (default “Sales” pipeline mirrors today’s New → … → Won/Lost).  
- Global `LeadStage` board is **retired from UI** (fields may sync in backend until migration).  
- Switching pipeline changes columns/filters — same detail panel.

### Why this kills duplication

| Old | New |
|-----|-----|
| Leads board (LeadStage) | Sales board (pipeline stages) |
| Pipeline workspace board | Same board with pipeline selected |
| Follow-ups page | View = Follow-ups today |
| Telecaller page | Detail Call panel / call mode |
| Pipeline list page | Pipeline dropdown + “Manage” |

---

## Enquiry detail (must be deep-linkable)

**URL:** `/app/sales/:leadId` (or query `?lead=` — URL preferred so refresh/share works).

### Sections (tabs or stacked — keep ≤ 5 chrome tabs)

1. **Overview** — contact, company, product interest, value, source/campaign, pipeline, stage, score (score as subtle badge, not a science project)  
2. **Activity** — timeline (calls, notes, WA, stage changes, emails)  
3. **Quotes** — list, new quote, send, accept, confirm order  
4. **Orders** — linked orders (after confirm) with jump to Order workspace  
5. **More** — attribution fields, delete (owner)

### Persistent action bar (always visible)

`Call` · `WhatsApp` · `Log outcome` · `Follow up` · `New quote`

Call expands **in-place panel** (providers, agent phone, mute/hangup for Twilio, AI call if entitled) — port Telecaller capability here.

---

## Call mode (replaces Telecaller island)

- Same APIs: click-to-call, browser token, AI call, log call, daily summary  
- Daily metrics: collapsible “Today’s calls” on Sales for telecaller role (donut can stay)  
- Deep links from Home / notifications: `/app/sales/:id?focus=call`  
- Empty telephony state: **real link** to Settings → Calling  

---

## Pipelines as organization

### User mental model

“I have lists: Main sales, Instagram ads, Export enquiries.”

### Owner “Organize” (modal/settings)

- Create / rename / archive pipeline  
- Edit stages (name, open/won/lost, probability) — advanced: system mapping hidden  
- Auto-assign rules: “If source = Meta and campaign contains X → put in Instagram ads”  
- Set default pipeline  

### What users should NOT see

- “Pipeline Workspace”  
- “Routing rule replace preview” jargon without plain language  
- A second kanban that ignores the first  

---

## Quotations inside Sales

| Action | Where |
|--------|-------|
| Create / edit / send / PDF | Enquiry → Quotes |
| Accept | Quote row |
| Confirm order | Quote row / Overview CTA when accepted |
| Browse all org quotes | Sales sub-route `Quotes` or filter “Quoted” + global quotes table (secondary) |

Document templates stay in Settings; picker remains on create.

---

## Follow-ups

- **View** with buckets: Overdue | Due now | Later today | Upcoming  
- Row opens **enquiry detail**, not a dead telecaller-only page  
- Home shows count + top 3  

---

## Permissions (recommended UX)

| Role | Sales access |
|------|----------------|
| Owner | Full + organize pipelines + import |
| Sales | Full work; organize pipelines if backend allows (align FE/BE) |
| Telecaller | Call-first; quote send if entitled; no delete pipeline |
| Production | Optional read of enquiry linked to their orders |
| Viewer | Read |

---

## Explicitly not in Sales

- Factory stage machine  
- Budget / supplier expenses (except read-only order link)  
- Brand PDF builder  
- WhatsApp template CRUD  

---

## Migration note (UX only for now)

Until backend single-stage migration:  
UI writes **pipeline_stage_id**; display names from pipeline stages; keep syncing legacy `Lead.stage` via systemKey silently.
