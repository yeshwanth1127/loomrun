# 07 — Home Dashboard

Home answers: **“What needs my attention?”**  
Charts are secondary. Every card should deep-link into Sales or Orders with context.

---

## Shared rules

- Role-aware widgets only  
- Each item has a **primary action** (Open, Call, Advance, Record payment)  
- Empty states teach the next setup step (“Connect WhatsApp”, “Add your first enquiry”)  
- Owner “Business” panel holds former CEO metrics without a separate Analytics nav  

---

## Owner Home

### Attention (top)

| Card | Source (today) | Action |
|------|----------------|--------|
| Follow-ups overdue / due today | follow-ups due + CALLBACK_SCHEDULED | Open Sales follow-ups |
| Delayed orders | Production delay / DELAYED | Open Orders filtered |
| Quotes waiting (sent, no accept/order) | Quotation SENT without order | Open Sales quoted |
| Payments pending / collection gap | CEO pending payments / P&L | Open Money or Order |
| New enquiries (24h) | Leads created recently | Open Sales New |

### Snapshot (second row)

- Enquiries this period  
- Orders in progress  
- Revenue / collected (period)  
- Win rate  

(From `GET /dashboard/ceo` — reuse aggregates.)

### Business (tab or expandable)

Former CEO tabs compacted:
- Funnel  
- Pipeline value  
- Sources  
- Client P&L table  
- Bottlenecks  

**Ask Loomrun AI** CTA remains.

---

## Sales / Telecaller Home

| Card | Action |
|------|--------|
| Follow-ups today | Open call-ready list |
| New enquiries | Open New |
| No contact yet (still New, aged) | Open list |
| Quotes awaiting reply | Open quoted |
| My calls today (summary) | Expand metrics |

Default focus for Telecaller role: **Follow-ups today** as the hero list embedded on Home (optional) or one click to Sales view.

---

## Production Home

| Card | Action |
|------|--------|
| Due to dispatch (ETA window) | Open Orders |
| Delayed / on hold | Open filtered |
| Awaiting design approval | Orders Design badge |
| In my current stages (e.g. Stitching) | Filter by stage |

No revenue widgets.

---

## What Home is not

- Not a second CRM  
- Not the only place to do work (cards jump into object pages)  
- Not a wall of 20 KPI tiles (CEO page density reduced)

---

## Notifications

Keep follow-up toasts; prefer they open **Sales detail**, not only a list.  
Future: unify order-delay alerts similarly (not required for v1 plan).
