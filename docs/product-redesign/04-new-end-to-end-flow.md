# 04 — New End-to-End Flow

Ideal customer journey through Loomrun. Principle: **obvious next action on the current screen.**

---

## Lifecycle (user-facing)

```
Enquiry arrives
  → Sales sees it (Home / Sales → New)
  → Contact (call / WhatsApp)
  → Follow-up if needed (same screen)
  → Create & send quotation (same screen)
  → Customer accepts (or staff marks Accepted)
  → Confirm Order (one CTA)     ★ primary new bridge
  → Design / Tech pack (Order)
  → Production stages (Order)
  → Dispatch + share tracking (Order)
  → Delivery
  → Payment / Close
```

---

## Transition-by-transition

### T0 — Enquiry arrives

| | |
|--|--|
| **User sees** | Home card “New enquiries” and/or Sales → New with badge |
| **Primary CTA** | Open enquiry |
| **Automatic** | Pipeline auto-assign; score; optional WhatsApp greet; optional delayed AI call (existing) |
| **Carried forward** | Source, campaign, phone, product interest, pipeline |
| **Leave page?** | No until they open detail |
| **Eliminate** | Checking Meta UI / three CRM pages |

---

### T1 — Contact

| | |
|--|--|
| **User sees** | Sales **Enquiry detail** (full page or persistent drawer with URL `/app/sales/:id`) |
| **Primary CTA** | **Call** (and WhatsApp secondary) |
| **Automatic** | First logged call on New → stage Contacted (existing) |
| **Carried forward** | Call log into Activity; disposition |
| **Leave page?** | **No** — call UI embeds in detail (Telecaller becomes panel/mode) |
| **Eliminate** | Navigate to `/telecaller`, re-select lead |

---

### T2 — Follow-up needed

| | |
|--|--|
| **User sees** | Same detail; outcome “Follow up” reveals schedule fields |
| **Primary CTA** | **Save follow-up** |
| **Automatic** | Appears in Follow-ups today; toast; optional WA to telecaller phone (existing) |
| **Carried forward** | `nextFollowUpAt`, notes |
| **Leave page?** | No |
| **Eliminate** | Separate Follow-ups page as mandatory hop (page becomes a **view**) |

---

### T3 — Create quotation

| | |
|--|--|
| **User sees** | Detail → **Quotes** section → “New quote” sheet/modal |
| **Primary CTA** | **Create & send** (or Save draft) |
| **Automatic** | PDF queue; on send → stage Quoted; line items can pull catalog |
| **Carried forward** | Lead identity, brand template defaults |
| **Leave page?** | Prefer **no**; optional “Open all quotes” for power users |
| **Eliminate** | Default path through standalone Quotations page |

---

### T4 — Customer accepts / staff confirms interest

| | |
|--|--|
| **User sees** | Quote row actions: **Mark accepted** / customer said yes |
| **Primary CTA** | **Confirm order** (enabled when accepted OR explicit override with confirm) |
| **Automatic** | Quote status ACCEPTED (finally used); optional stage Won |
| **Carried forward** | Quotation id, totals, line items → Order |
| **Leave page?** | No |
| **Eliminate** | “Convert to invoice” as fake acceptance; silent won without order |

---

### T5 — Confirm Order ★

| | |
|--|--|
| **User sees** | Confirm sheet: order name, linked quote (pre-filled), optional notes |
| **Primary CTA** | **Create order** |
| **Automatic** | Create ProductionOrder (ORD-…); tracking token; activity ORDER_CREATED; open Order workspace |
| **Carried forward** | Lead, quotation, value, contact |
| **Leave page?** | Soft navigate to **Order** (correct context switch — sale → job) |
| **Eliminate** | Leads drawer Production tab **and** Production “Start order” as two different mental models |

Also bind: Telecaller outcome **Order confirmed** → same Confirm order CTA (not a dead label).

---

### T6 — Design / Tech pack

| | |
|--|--|
| **User sees** | Order → **Design** tab |
| **Primary CTA** | Upload design → Generate mockup → **Approve for production** |
| **Automatic** | TEMPLATE_2D compose (existing); later: AI mockups if added |
| **Carried forward** | Assets + mockups + tech-pack notes/sizes/colorways on Order |
| **Leave page?** | No |
| **Eliminate** | Treating design as a disconnected AI toy |

**Tech pack (product framing):** structured section on Order: approved artwork, mockups, size/color notes, special instructions — export/share later. Not a separate app.

---

### T7 — Production

| | |
|--|--|
| **User sees** | Order → **Production** tab: current stage, next stage CTA, timeline |
| **Primary CTA** | **Mark as [next stage]** (+ optional customer-visible note) |
| **Automatic** | Activity log; tracking milestone update |
| **Carried forward** | Stage history |
| **Leave page?** | No for single-order work; list filters for floor queue |
| **Eliminate** | Expanding random cards hunting for the right control |

---

### T8 — Dispatch

| | |
|--|--|
| **User sees** | Order → **Shipping** when near ready |
| **Primary CTA** | Save courier + **Share tracking** (WA / copy) |
| **Automatic** | Stage Ready/Shipped updates public track page |
| **Leave page?** | No |

---

### T9 — Delivery

| | |
|--|--|
| **User sees** | Mark **Delivered** |
| **Automatic** | Customer milestone Delivered |
| **Primary CTA** | Record final payment / Close |

---

### T10 — Payment / Close

| | |
|--|--|
| **User sees** | Order → **Payments** (and Money for org-wide) |
| **Primary CTA** | Record payment; optional **Create invoice** from linked quote |
| **Automatic** | Activity; P&L strip updates |
| **Close** | When delivered + settlement policy met (PO defines: paid in full vs delivered) |
| **Eliminate** | Invoice list saying “Paid” without Payment records |

---

## Happy path click budget (target)

| Goal | Target |
|------|--------|
| New enquiry → first call logged | ≤ 3 actions on one screen |
| Call → scheduled follow-up | ≤ 2 actions same screen |
| Lead → quote sent | ≤ 5 actions without leaving Sales detail |
| Accepted quote → order exists | ≤ 2 actions |
| Order → mockup shared on WA | ≤ 4 actions on Order Design |
| Order → tracking shared | ≤ 3 actions on Shipping |

---

## Explicit non-happy paths (still supported)

- Import CSV (Sales → Import)  
- Lost / not interested (detail)  
- Multi-quote revisions  
- Order without quote (Owner: “Start order” still available on Orders)  
- Overhead expenses (Money, not Order)  
- AI chat for bulk questions  

---

## What we refuse to require

- Visiting Follow-ups **and** Telecaller **and** Leads to finish one callback  
- Creating an order without a clear Confirm moment  
- Opening WhatsApp “app” to send tracking that already lives on the Order
