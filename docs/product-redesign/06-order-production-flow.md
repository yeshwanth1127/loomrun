# 06 — Order / Production Flow Redesign

**Order** is the central object after a sale is confirmed.  
Today’s `ProductionOrder` becomes the Order in the UI (backend name can stay until migration).

---

## Product statement

**Orders is where confirmed work gets designed, made, shipped, paid, and closed.**

---

## Entry points

1. Sales → Confirm order (primary)  
2. Orders → New order (owner; optional quote link) — escape hatch  
3. Home → Delayed / due soon cards  
4. Public `/track/:token` (customer; unchanged)

---

## Orders list

```
Filters: Active | Delayed | On hold | Ready to ship | Completed
Search: order #, customer name, phone
[ + New order ] (owner)
```

Cards/rows show: order #, customer, stage, status health, dispatch ETA, money snapshot (owner).

---

## Order workspace (single object)

**URL:** `/app/orders/:orderId`

### Tabs

| Tab | Purpose | Maps from today |
|-----|---------|-----------------|
| **Overview** | Customer, linked quote, value, health, next CTA | Card header + P&L strip |
| **Design** | Artwork, mockups, tech pack, approve | ProductionDesignPanel + notes |
| **Production** | Stage machine, internal notes, floor timeline | Stage modal + activity |
| **Payments** | Record payments, balance, invoice actions | Production payments + invoice link |
| **Shipping** | Courier, tracking #, share tracking, customer updates | Tracking panel + shipping fields |
| **Costs** (owner) | Job expenses, budget | Production expenses + budget |
| **Activity** | Full timeline | Activity log filtered to order |

Production role: Overview, Design, Production, Shipping, Activity (hide Costs/Payments edit as today).

---

## Confirm-order bridge (from Sales)

**Input:** lead_id, optional quotation_id, name  
**Effect:** existing `POST /production` behavior + navigate to Order  
**Also:** Mark quote ACCEPTED if not already; set lead Won when appropriate  

**UI copy:** “Confirm order” not “Start production” / “Create production order”.

---

## Design / Tech pack flow (planned + current)

### Current capability to preserve
- Upload design (PNG/JPEG/WebP)  
- Garment template placement (scale/rotation)  
- Generate TEMPLATE_2D mockups  
- Download / WhatsApp send / delete  

### Planned product framing

```
Customer provides design (outside or WA)
  → Staff uploads into Order → Design
  → Generate mockups (template now; AI later)
  → Review / adjust placement
  → Mark mockups Approved
  → Tech pack fields (sizes, colorways, fabric notes, special instructions)
  → “Send to production” / unlock floor confidence
  → Production tab uses approved pack as reference
```

### UX rules
- Lives **only** on the Order — not a global AI tool  
- Primary CTA after upload: **Generate mockup**  
- After approve: **Ready for production** badge on Overview  
- Sharing mockup uses Order WhatsApp action (lead phone)  

### Backend later (flag)
- Dedicated TechPack model or JSON on ProductionOrder  
- AI mockup engine beyond TEMPLATE_2D  
- Customer self-upload portal (optional; out of scope unless PO wants)

---

## Production tab

- Show **current stage** large; one **Next** button  
- Collapse 13 stages into a readable stepper (all stages still available in “Change stage”)  
- Customer-visible note field kept (feeds tracking)  
- Health: On track / At risk / Delayed / On hold — plain language  

### Suggested user-facing stage labels (keep enum values internally)

| Internal | UI label idea |
|----------|----------------|
| FABRIC_CHECK | Fabric check |
| PROCUREMENT | Buying materials |
| FABRIC_RECEIVED | Materials received |
| CUTTING | Cutting |
| PRINTING | Printing / embroidery |
| STITCHING | Stitching |
| QC | Quality check |
| PACKING | Packing |
| PAYMENT_HOLD | Payment hold |
| READY_DISPATCH | Ready to dispatch |
| SHIPPED | Shipped |
| DELIVERED | Delivered |

---

## Shipping & tracking

- Enable/disable tracking, regenerate (owner)  
- Copy link, WhatsApp share, QR (keep)  
- Public page stays simple  

---

## Payments & invoice

- Record payment here (source of truth for “collected”)  
- “Create invoice” uses linked quotation `generate-invoice`  
- Money section lists org invoices; each links back to Order/Lead  

---

## What disappears as separate concepts

| Old | New |
|-----|-----|
| Nav “Production” | Nav “Orders” |
| Leads drawer mini production | Link to Order + Confirm CTA |
| Design as buried panel only | First-class Order tab |
| Vendors page | Money → expenses by supplier |

---

## Preserve (audit F)

Production stages, order status, budget, expenses, payments, activity, tracking token/public page, design mockups, WhatsApp outbound for tracking/mockups, filters (delayed etc.), role split Owner vs Production.
