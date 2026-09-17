# 01 — Design Principles

**Phase:** Product + UX planning only. No implementation.  
**Source of truth for capabilities:** `docs/product-audit/`  
**North star:** Make Loomrun extremely simple for garment/textile business users who are not software-trained.

---

## Product philosophy

Loomrun is a **workbench for running a garment business**, not a CRM suite with bolted-on modules.

Users think in jobs:

> “Who do I need to call today?”  
> “Did we send the quote?”  
> “Is this order in stitching?”  
> “Has the customer paid?”  
> “Can I share a tracking link?”

They do **not** think in:

> Pipeline workspaces, routing rules, LeadStage vs PipelineStage, ProductionOrder, systemKey, dual expense models.

Every redesign decision must pass this test:

**Does a busy factory owner need this as a separate screen to finish today’s work?**  
If no → embed, filter, drawer, or automate it.

---

## Hard principles

### 1. Jobs over modules
Navigation and screens follow **jobs-to-be-done** and the **customer/order lifecycle**, not Prisma models or current routers.

### 2. One primary object at a time
Before confirmation the object is a **Lead**.  
After confirmation the object is an **Order**.  
The user should rarely hunt across 4 pages for the same person.

### 3. Next action on the current screen
The obvious next step (Call, Follow up, Quote, Confirm order, Advance stage, Share tracking) should normally be available **without leaving** the detail view.

### 4. Fewer top-level places
Aim for **≤ 6 primary nav items** for owners; fewer for staff.  
Capabilities may stay; dedicated nav items may die.

### 5. One language for stages (user-facing)
Users see **one** sales progress language and **one** order progress language.  
Internal dual fields (`Lead.stage` vs `pipelineStageId`) may remain for compatibility until a later data migration — but the UI must not expose two boards that disagree.

### 6. Pipelines are organization, not a product
Pipelines = folders/filters for how the team organizes enquiries (campaign, region, product line).  
They are **not** a second CRM the user must learn.

### 7. Calling is a mode, not a destination
Telecaller is a **role + focused work mode** inside Sales, not a separate app island that owns the lead.

### 8. Documents live on the person/order
Quotes, invoices, mockups, tracking links attach to Lead/Order context.  
Standalone list pages are secondary (“all quotes”) not the default path.

### 9. Money is clear and late
Payment and invoice language must match business talk.  
Don’t call something “Paid” on Invoices if money was recorded on Production.

### 10. Automatic where safe; one click where not
Auto: routing, greet, NEW→Contacted on first call, quote-sent stage, tracking token on order create.  
One-click: Confirm order from accepted quote / “Order confirmed” outcome.  
Never force: Lead → Follow-ups page → Telecaller → Leads → Quotations as the happy path.

### 11. Preserve capabilities; relocate surfaces
Audit section F is mandatory. Features may leave the sidebar; they must remain reachable where the job happens.

### 12. UX can lead schema — but label the gap
Ideal UX may need Customer / Order / Invoice entities and a single stage model.  
Document **UX change** vs **backend change required** separately. Do not silently break the backend.

### 13. Role-aware Home, not vanity analytics
Home answers **“What needs me?”** first; charts second.

### 14. Business words only in UI
Keep technical names in code. UI uses: Enquiry/Lead, Quote, Order, Stage, Follow-up, Design, Tracking, Payment.

---

## Lifecycle we optimize for (validated)

Audited capabilities support this chain. Proposed user-facing lifecycle:

```
Enquiry (Lead)
  → Contact / Follow-up
  → Quotation
  → Order confirmed          ← currently the biggest broken handoff
  → Design / Tech pack
  → Production
  → Dispatch
  → Delivery
  → Payment / Close
```

### Validation against audit

| Step | Exists today? | Gap |
|------|---------------|-----|
| Enquiry capture | Yes (manual, CSV, Meta, Google, WA, IndiaMART backend) | IndiaMART UI missing |
| Contact / follow-up | Yes (Telecaller + Follow-ups + drawer) | Split across 3 places |
| Quotation | Yes | Accept unused; leave Sales to quote page |
| Order confirmed | Weak | Manual create; ORDER_CONFIRMED doesn’t create order |
| Design / mockups | Yes (TEMPLATE_2D on production) | Buried; no “Tech Pack” framing |
| Production stages | Yes (13 stages) | Dense; named “Production” not “Order” |
| Dispatch / delivery | Yes (stages + shipping fields) | OK if Order-centric |
| Payment / close | Partial | Payments on production; invoice “Paid” confusing |
| Customer status share | Yes (`/track/:token`) | Discoverability |

### Improvements vs the suggested chain

1. **Rename “Lead” → “Enquiry” in UI** for garment SMBs (optional PO decision); keep Lead in API.  
2. **Make “Confirm order” the explicit bridge** from quote/won — not a silent hope.  
3. **Design/Tech pack is an Order section**, not an AI lab.  
4. **Payment can start early** (advance) but **Close** requires delivery + settlement clarity.  
5. **Do not invent a separate “Customers” module** in v1 redesign — after first order, Lead detail simply shows as customer context on the Order (and “Customers” can be a Sales filter: people with ≥1 order).

---

## Non-goals for this planning phase

- No code, schema, or route edits  
- No pixel UI mockups required (structure and flows only)  
- No deleting backend features  
- No payment-gateway build decision forced (flag as open)  

---

## Success criteria (how we’ll know it’s simpler)

| Metric | Current (approx) | Target |
|--------|------------------|--------|
| Owner top-level nav items | ~15 destinations | ≤ 6 |
| Pages to go Lead → Call → Quote | 3–4 | 1 (Sales detail) |
| Pages to go Quote accepted → Production started | 2–3 + confusion | 1 CTA on quote/lead |
| Distinct “stage boards” users must learn | 2 | 1 for Sales |
| Separate Telecaller app feel | Yes | No — mode inside Sales |
| Separate WhatsApp “app” for daily work | Yes | No — actions on Lead/Order |

---

## Decision filter (use on every screen)

1. Is this a **frequent job** or a **rare setup**?  
2. Can it be a **tab / view / drawer / filter**?  
3. Does leaving this screen lose context the user needs next?  
4. Would a new hire understand the label without training?  
5. If we remove the nav item, is the capability still findable in ≤2 clicks from the object?
