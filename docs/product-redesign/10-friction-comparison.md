# 10 — Friction Comparison

Estimates based on audited flows. “Pages” = distinct routes/major modes. “Actions” = meaningful clicks/submits (not every keystroke).

---

## 1. Follow up a lead due today

### Current
```
Home/toast → Follow-ups page → Click Call
  → Telecaller (re-select or ?lead=) → Make call → Log result → Save
```
- Pages: **3** (Follow-ups, Telecaller, often back to Leads for edits)  
- Context switches: high  
- Repeated: lead identity, sometimes outcome fields duplicated with Leads drawer  

### Proposed
```
Home card / Sales → Follow-ups today → Open enquiry
  → Call panel → Log + schedule → Save
```
- Pages: **1–2** (Home optional → Sales detail)  
- Same screen for call + schedule + notes  

**Friction removed:** Telecaller as separate app; forced hop; re-finding the lead.

---

## 2. New enquiry → first contact logged

### Current
```
Leads → open drawer → tel: or navigate Telecaller → log call
```
- Pages: **1–2**  
- Drawer lacks full call provider UX → often Telecaller  

### Proposed
```
Sales → New → open detail → Call → Save log
```
- Pages: **1**  
- Full call capability in detail  

---

## 3. Send first quotation

### Current
```
Leads drawer → Send Quote (needs ready PDF) 
  OR navigate Quotations → New → lines → PDF → Send
  OR Telecaller send quote path
```
- Pages: **1–2**; duplicated send logic  
- Fail path: “ask owner for draft PDF” dead-end  

### Proposed
```
Sales detail → Quotes → New quote → Create & send
```
- Pages: **1**  
- Guided PDF+send in one sheet  

---

## 4. Accepted deal → work started on floor

### Current
```
Mark won somehow / call ORDER_CONFIRMED (no order)
  → Leads drawer Production tab → Create order (optional quote)
  OR Production → Start order (no quote)
```
- Pages: **2**  
- Mental model: unclear; two create UIs  
- Data: quote often not linked  

### Proposed
```
Sales quote → Mark accepted → Confirm order → lands on Order
```
- Pages: **1 transition** (Sales → Order — justified)  
- Actions: **≤2**  
- Quote always linkable  

**Friction removed:** Biggest handoff hole in the product.

---

## 5. Share tracking with customer

### Current
```
Production → find order → Tracking tab → enable/regenerate → WhatsApp
```
- Pages: **1** but buried in expand panels  

### Proposed
```
Orders → order → Shipping → Share tracking
```
- Same capability; clearer IA; fewer hunt-clicks  

---

## 6. Upload design & send mockup

### Current
```
Production → Design tab → upload → place → generate → WA
```
- Already fairly linear; buried  

### Proposed
```
Order → Design → same steps + Approve for production
```
- Add approval milestone; same core actions  

---

## 7. Record payment vs see “invoice paid”

### Current
```
Record payment on Production
  vs Invoices page shows Paid from wrong status logic
```
- Confusion / double mental model  

### Proposed
```
Order → Payments is source of truth
Money → Invoices shows settlement from payments
```

---

## 8. Owner morning triage

### Current
```
CEO page + Follow-ups badge + Production filters + Quotations strip
```
- Pages: **3–4**  

### Proposed
```
Home attention cards → one click each into context
```
- Pages: **1** hub  

---

## Summary table

| Job | Current pages (approx) | Proposed | Win |
|-----|------------------------|----------|-----|
| Due follow-up call | 3 | 1–2 | High |
| First contact | 1–2 | 1 | Medium |
| Send quote | 1–2 + dup | 1 | High |
| Confirm order | 2 + confusion | 1 CTA | **Critical** |
| Share tracking | 1 buried | 1 clear | Medium |
| Morning triage | 3–4 | 1 | High |

---

## Repeated data entry to kill

- Re-selecting lead on Telecaller after Follow-ups  
- Re-entering contact fields in call log when Overview already has them (edit-in-place, don’t duplicate forms)  
- Starting order without pulling quotation totals/lines context  
- Separate expense category systems without shared suggestions
