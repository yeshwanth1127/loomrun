# 11 — Product / UX Problems & Technical Issues

**CURRENT-STATE ONLY.** No redesign proposals — observations that matter for a future redesign.

---

## PRODUCT / UX ISSUES

### Navigation & information architecture
1. **Two lead boards, two stage languages** — Leads (global LeadStage) vs Pipeline Workspace (custom stages). Same lead can “look” different in each place.
2. **Pipeline Workspace has no lead detail** — dead end; user must leave to Leads or Telecaller.
3. **Pipelines in sidebar for employees who cannot open them** — trust-breaking redirect.
4. **Settings is one nav item** — Telephony, Templates, Brand, Team, Usage buried in inner nav.
5. **WhatsApp appears twice** — Ops page + Integrations connector; Automations tab is empty.
6. **“Orders” vs “Production”** — alias redirect; customer-facing “order” language vs ops “production”.
7. **Invoices aren’t first-class** — filtered quotations; “New invoice” goes to Quotations.
8. **Vendors aren’t first-class** — expense string aggregation.
9. **Brand naming split** — Noolrun (UI) vs Loomrun (AI/API) vs Fabblen (legacy SVGs) vs Exora (company).

### Broken or confusing flows
10. **No Accept Quotation action** — ACCEPTED status exists but unused; invoice convert doesn’t need it.
11. **ORDER_CONFIRMED call outcome does not create an order** — label implies it should.
12. **Won lead ≠ production order** — fully manual handoff; easy to lose context.
13. **Quotation → Production not available on Quotations page** — only from Leads drawer (with quotation) or Production start (without).
14. **Follow-ups always open Telecaller** — cannot open full lead drawer from follow-up queue.
15. **No Customer entity** — won leads stay “leads”; language switches to “client” only on CEO P&L.
16. **Payment recorded on Production, “Paid” shown on Invoices** — disconnected money UX.
17. **Team UI only adds TELECALLER** — other roles require Platform Admin or API.
18. **IndiaMART not connectable in UI** despite backend sync.
19. **n8n UI built but not shipped** — automations metrics fetched into dead code path.
20. **Gmail connected but no inbox UI** — sync silent; users may not know it works.
21. **Calendar connected with nowhere to use it** in main app.
22. **AI approval cards mostly dormant** — product copy says confirm-before-write; runtime is auto.
23. **Landing pricing hardcoded** vs Subscription API catalog — can drift.
24. **Global date filter** surprises pages that hardcode `day=all` (Follow-ups, Pipeline leads).

### Discovery & duplication
25. **Call status / send quote / follow-up** duplicated across Leads drawer and Telecaller.
26. **Two expense entry systems** with different category models.
27. **CEO integrations field unused**; several typed metrics unused as widgets.
28. **Tracking / Design / Finance** buried inside Production expand panels — powerful but dense.

### Dead ends
29. Telecaller empty-provider text “Go to Telephony settings” is not a link.
30. Pipeline table rows not clickable.
31. Sample CSV stage labels don’t match API enums.

---

## TECHNICAL ISSUES

1. **Dual stage persistence** — Lead.stage + pipelineStageId kept in sync via systemKey; fragile for custom stages without keys.
2. **~191 API routes** with many backend-only endpoints (Gmail list/send UI-less, qlix deactivate/resync, telephony BYO, catalog create item, etc.).
3. **Public webhook security gaps** — WhatsApp inbound, IndiaMART push, Meta without secret, Exotel/Twilio recording without signature.
4. **JWT in localStorage** — XSS-sensitive; no HttpOnly cookies.
5. **ARQ/Redis underused** — polls + asyncio tasks instead; worker docs outdated.
6. **Quotation WhatsApp PDF requires Baileys** while other outbound falls back to Meta — inconsistent.
7. **n8n `production.stage_changed` never emitted**.
8. **Invoice “Paid” uses ACCEPTED \|\| PAID** but PAID is PaymentStatus, not QuotationStatus.
9. **ProductionPage duplicate empty states** in JSX.
10. **EmployeeRouteGuard path matching** is exact-path list — nested pipeline routes fail closed for employees (OK) but Pipelines root also blocked despite SALES backend rights.
11. **Stripe schema fields** with no payment integration.
12. **exora MCP** unwired from main process / Qlix tool path.
13. **Qlix memory Brain sync lag** — extract doesn’t mark dirty.
14. **Hardcoded FX `* 83`** on telephony usage display.
15. **STORAGE_DIR local disk** — no object storage abstraction.
16. **Growth plan locks** many integrations users may expect after seeing trial Scale features.

---

## Separation reminder

| Type | Examples |
|------|----------|
| PRODUCT/UX | Dual boards, no accept flow, buried settings, naming |
| TECHNICAL | Webhook auth, dual stage sync, unused ARQ, JWT storage |
