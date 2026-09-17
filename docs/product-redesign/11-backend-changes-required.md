# 11 — Backend / Data Model Changes Required

Separate **UX-only** work from **schema/API** work.  
Redesign can start with UX-only while keeping Prisma compatibility.

---

## Phase A — UX only (no schema change)

Possible while keeping current models:

- New nav + routes that wrap existing APIs  
- Sales detail route using `GET/PATCH /leads/:id`, telecaller, quotations endpoints  
- Single board UI reading `pipeline_stage_id` (stop showing LeadStage board)  
- Confirm order CTA → existing `POST /production`  
- Order workspace tabs → existing production + design + tracking endpoints  
- Home attention widgets → compose `follow-ups/due`, `dashboard/ceo`, production filters, quotations list  
- Money section → filter quotations with `invoice_number` + expenses API  
- Hide WhatsApp as app; call send APIs from detail  
- Align FE role gates with BE (SALES quotes/pipelines)  
- Use QuotationStatus ACCEPTED in UI  
- Map ORDER_CONFIRMED outcome → Confirm order prompt  

**Risk:** Dual stage fields remain; silent sync via systemKey continues.

---

## Phase B — Recommended data model (for ideal UX)

### B1. Single sales stage source of truth

**UX need:** One board that never disagrees.  

**Change:**  
- Treat `PipelineStage` as canonical  
- Deprecate user-facing `Lead.stage` (keep column synced or nullable later)  
- Ensure every pipeline stage used by automations has `systemKey` OR replace automations to use stage kind/id  

**Migration:** Backfill pipeline assignment for all leads; default Sales pipeline already exists.

---

### B2. First-class Order naming (optional rename)

**UX need:** “Order” everywhere.  

**Change options:**  
a) UI-only rename of ProductionOrder (Phase A)  
b) Later rename model/table (costly; not required for simplicity win)

**Recommendation:** UI-only first.

---

### B3. Confirm-order API semantic

**UX need:** One intentional bridge.  

**Change:**  
- `POST /orders/confirm` (alias) accepting `lead_id`, `quotation_id?`  
- Side effects: ACCEPTED quote, Won lead, create ProductionOrder, return order  
- Telecaller `ORDER_CONFIRMED` calls same service  

Can be a thin service over existing create + patches (Phase A+) without new tables.

---

### B4. Customer (soft vs hard)

**UX need:** After order, talk about “customer”.  

**Options:**  
a) **Soft:** Same Lead row; UI label “Customer” when `has_orders`  
b) **Hard:** New `Customer` entity + link from Lead  

**Recommendation:** Soft for v1 redesign; revisit if accounts need multi-lead companies.

---

### B5. Invoice entity

**UX need:** Clear invoices + payment truth.  

**Options:**  
a) Keep Quotation+invoiceNumber; fix Paid UI to use Payment sums (**Phase A**)  
b) New `Invoice` model linked to Order/Quotation  

**Recommendation:** (a) first; (b) if accountants demand separation.

---

### B6. Tech pack

**UX need:** Structured design pack on Order.  

**Change:**  
- `techPack` JSON on ProductionOrder **or** `OrderTechPack` table  
- Fields: sizes, colorways, fabric, notes, approvedMockupIds, approvedAt  

Mockup engine can stay TEMPLATE_2D; AI generation later.

---

### B7. Expense unification

**UX need:** One expense language.  

**Change:**  
- Shared category vocabulary  
- Always set `productionOrderId` for job costs from Order UI  
- Vendors remain derived unless PO wants Vendor table  

---

### B8. WhatsApp / integrations productization

- IndiaMART connect in lead-connections UI (API exists)  
- Ship or remove n8n UI  
- Unify quotation WA send fallback policy with general outbound  

---

## Explicitly out of scope for “simplicity UX” unless PO insists

- Stripe/Razorpay checkout  
- Rewriting Qlix  
- New Customer portal beyond `/track`  
- Calendar product UI  

---

## Mapping: UX change vs backend

| Redesign idea | UX only? | Backend needed? |
|---------------|----------|-----------------|
| 6-item nav | Yes | Routes aliases optional |
| Sales mega-surface | Yes | Prefer lead detail URL |
| Kill LeadStage board in UI | Yes | Later deprecate field |
| Confirm order CTA | Mostly | Shared confirm service recommended |
| Order tabs | Yes | Tech pack JSON later |
| Home attention | Yes | Maybe small aggregate endpoint later |
| Money section | Yes | Fix invoice paid derivation |
| Soft Customer label | Yes | Hard entity optional |
| Single stage truth | Partial | Migration Phase B |
| AI mockups | No | New engine |
| Invoice table | No | New model |

---

## Compatibility rule

Until Phase B migration is done: **do not delete** LeadStage writes from API; UI simply stops presenting two boards.
