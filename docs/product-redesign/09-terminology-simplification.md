# 09 — Terminology Simplification

Internal/API names may stay. **UI copy** uses business language.

---

## Glossary (UI ← technical)

| Avoid in UI | Prefer | Notes |
|-------------|--------|-------|
| Pipeline Workspace | Pipeline / List / “Organize lists” | |
| Routing Rule | Auto-assign rule / “Put new enquiries in…” | |
| ProductionOrder | Order | |
| Production (nav) | Orders | |
| LeadStage / PipelineStage | Stage | |
| systemKey | (never show) | |
| LeadStatus | (rarely show; use Won/Lost stage) | |
| Telecaller (nav) | Sales / Calls | Role name can stay in Team |
| Loomrun AI vs Noolrun | Pick one brand (**PO decision**) | Recommend one public name |
| CEO Dashboard | Home / Business overview | |
| Vendors | Suppliers (expense grouping) | |
| Outbound message | Message / WhatsApp message | |
| Provision telephony | Set up calling | |
| Document template | Quote/Invoice layout | |
| Qlix / Brain | “Activate AI” / Knowledge files | Hide vendor name unless needed |
| Entitlements / feature flags | Plan includes… | |
| Kanban | Board | |
| DRAFT/SENT/ACCEPTED | Draft / Sent / Accepted | Humanize |
| ORDER_CONFIRMED (outcome) | Order confirmed → triggers Confirm order | |
| CALLBACK_SCHEDULED | Follow up | Already partly done |
| FABRIC_CHECK etc. | Friendly stage labels | See Orders doc |
| Import CSV | Import enquiries from spreadsheet | |
| Score | Interest score / Fit (optional plain “Hot/Warm/Cold”) | |

---

## Microcopy principles

- Buttons: verbs users do — **Call**, **Send quote**, **Confirm order**, **Mark shipped**, **Share tracking**  
- Not: “Create ProductionOrder”, “Generate PDF job”, “Apply routing rules” (use “Apply to existing enquiries” with plain explanation)  
- Errors: business outcome first — “WhatsApp isn’t connected. Connect it in Settings.”  

---

## Brand decision (open)

Until decided, docs use **Loomrun** for product in planning text; UI audit shows **Noolrun** wordmark.  
**Recommendation:** one customer-facing name everywhere (app shell, AI, emails, tracking footer).
