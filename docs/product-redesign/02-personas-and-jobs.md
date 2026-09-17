# 02 — Personas and Jobs-to-Be-Done

Minimum useful personas only. Telecaller is a **Sales role variant**, not a fourth product.

---

## Personas (3 + 1 platform)

### 1. Owner / Admin

**Who:** Factory owner, partner, or office manager who runs the whole business in Loomrun.

**Needs when opening Loomrun:**
- What is urgent today (follow-ups, delayed orders, unpaid)
- Are sales healthy this week/month
- Any blocked handoffs (quoted but no order; order stuck)

**Frequent actions (5–10):**
1. Check Home for urgency  
2. Review / assign new enquiries  
3. Send or approve quotations  
4. Confirm orders from won deals  
5. Check delayed production  
6. Record / review payments  
7. Share tracking with customers  
8. Add expenses / see costs  
9. Ask AI for a summary or task  
10. Connect integrations / manage team (less frequent)

**Should NOT need to understand:**
- PipelineWorkspace vs Leads board  
- Routing rule DSL  
- Dual stage enums  
- Difference between `/telecaller` and lead drawer call logging  
- That invoices are “quotations with invoice_number”

**Screens they need:**
- Home (attention + light KPIs)  
- Sales (all enquiries)  
- Orders (all jobs)  
- Money (invoices + expenses)  
- Ask AI  
- Settings (setup)

**Surfaced automatically:**
- Due follow-ups, delayed orders, pending quotes, unpaid balances, new enquiries count

---

### 2. Sales (includes Telecaller role)

**Who:** Salesperson or dedicated telecaller working enquiries to quote/order.

**Needs when opening:**
- Who to call / follow up **today**  
- New enquiries since last session  
- Quotes waiting on customer  

**Frequent actions:**
1. Open today’s follow-ups  
2. Call a lead (click-to-call / browser / log manual)  
3. Log outcome + schedule next follow-up  
4. WhatsApp a lead  
5. Update requirement / value / notes  
6. Create & send quotation  
7. Mark interest / lost  
8. Confirm order (or hand off with one CTA)  
9. (Optional) AI call for after-hours  

**Should NOT need to understand:**
- Production stage machine  
- Budget / P&L  
- Document template builder  
- Pipeline “settings” and routing (unless Owner gives them org of work via filter)  
- Platform admin

**Screens:**
- Home (sales-flavored)  
- Sales (primary workspace)  
- Ask AI (optional)  
- Orders: **view** related order status for their customers (read-biased)

**Telecaller variant:** Same Sales product; default Home/Sales view = “Follow-ups today” + call-first layout. No separate Telecaller island.

---

### 3. Production

**Who:** Floor / production coordinator.

**Needs when opening:**
- What is due / delayed / on hold today  
- Which order needs design approval  
- Dispatch queue  

**Frequent actions:**
1. Open Orders due today / delayed  
2. Advance production stage  
3. Add customer-visible update  
4. Upload / place design; generate mockup  
5. Save shipping / courier details  
6. Share or copy tracking link  
7. (Usually not) change pricing / delete orders  

**Should NOT need to understand:**
- Lead pipelines, telecaller outcomes  
- Quotation line editing  
- Subscription / AI credits  
- Vendor aggregation page  

**Screens:**
- Home (ops-flavored)  
- Orders (primary)  
- Ask AI (optional, limited)

---

### 4. Platform super-admin (not a tenant persona)

Keeps `/platform` as today. Not part of factory UX redesign.

---

## Why not more personas?

| Rejected as separate persona | Why |
|------------------------------|-----|
| Dedicated “Accounts” | Small garment orgs: Owner does money; fold into Money + Order Payments |
| Dedicated “WhatsApp operator” | Messaging is an action on Lead/Order, not a job title product |
| “Viewer” | Keep as permission; same Sales/Orders read-only Home |

---

## Core jobs-to-be-done (forget pages)

Map audit features → jobs.

| # | Job | Current features that serve it | Redesign home |
|---|-----|--------------------------------|---------------|
| J1 | See new enquiries | Leads board, Meta/Google sync, WA inbound, CSV | Sales → New |
| J2 | Contact a lead | Telecaller, tel:, WA, lead drawer | Sales detail → Call / WhatsApp |
| J3 | Know who needs follow-up today | Follow-ups page, toasts, WA reminders | Sales → Follow-ups today + Home |
| J4 | Capture requirements | Lead fields, call log notes | Sales detail |
| J5 | Send a quotation | Quotations page, PDF, send WA/email, catalog, templates | Sales detail → Quote (+ Quotes list secondary) |
| J6 | Know if quote was accepted | Status enum (underused), manual | Sales detail → Accept / Confirm order |
| J7 | Confirm an order | Manual production create; ORDER_CONFIRMED unused | One CTA → creates Order |
| J8 | Upload customer design | ProductionDesignPanel | Order → Design |
| J9 | Generate product mockups | TEMPLATE_2D mockups | Order → Design |
| J10 | Prepare / maintain tech pack | Partial (design + notes); no named Tech Pack | Order → Design / Tech pack |
| J11 | Track production | Production stages, activity, filters | Order → Production |
| J12 | Know delayed work | delayFlag, OrderStatus, CEO, production filters | Home + Orders filters |
| J13 | Dispatch goods | Shipping fields, READY_DISPATCH/SHIPPED | Order → Shipping |
| J14 | Tell customer status | Tracking token, `/track/:token`, WA share | Order → Shipping / Share |
| J15 | Record payment | Production payments; invoice confusion | Order → Payments + Money |
| J16 | Raise invoice | generate-invoice on quotation | Order / Money from quote |
| J17 | Record business expenses | Expenses page + production expenses | Money (+ on Order for job costs) |
| J18 | See business performance | CEO dashboard | Home (owner) + optional Reports later |
| J19 | Message customers at scale | WhatsApp page, templates, auto-greet | Lead/Order actions + Settings templates |
| J20 | Connect lead sources | Integrations page | Settings → Connections |
| J21 | Ask the business questions | Loomrun AI | Ask AI |
| J22 | Set up brand / PDF look | Brand assets, document templates | Settings |
| J23 | Manage team & phones | Team, telephony settings | Settings |

---

## Jobs that must stay one-screen capable

These should complete **without** a forced navigation hop:

- Call + log + schedule follow-up  
- Create quote from lead + send  
- Accept quote → confirm order  
- Advance production stage + customer note  
- Upload design → generate mockup → send WA  
- Copy/share tracking link  
- Record payment against order  

---

## Open persona decision

**Should SALES see Orders and Quotes fully in UI?**  
Audit: backend already allows SALES/TELECALLER more than frontend.  
**Recommendation:** Yes — Sales needs quote + order confirmation; Production stays money-light.
