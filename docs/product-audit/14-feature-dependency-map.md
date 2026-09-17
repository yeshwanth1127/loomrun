# Feature Dependency Map

Shows how modules share data — critical for redesign sequencing.

---

## Primary commercial chain

```
Lead
  ├── Pipeline / PipelineStage / RoutingRule
  ├── LeadActivity
  ├── TelecallerCallLog  →  Follow-ups (nextFollowUpAt)
  ├── Quotation (+ lines, PDF, template)
  │     └── Invoice fields (same Quotation row)
  └── ProductionOrder
        ├── ProductionActivity → public Track milestones
        ├── Payment
        ├── Expense (job)
        ├── DesignAsset / Mockup
        └── trackingToken
```

## Shared hubs

| Hub entity | Consumed by |
|------------|-------------|
| **Lead** | Almost everything — quotes, calls, WA, production, expenses, AI tools, dashboard |
| **Organization** | Brand PDFs, plan entitlements, WA settings, telephony, Qlix |
| **Quotation** | Invoices page, production link, dashboard conversion metrics, AI tools |
| **ProductionOrder** | CEO ops metrics, tracking, expenses P&L, design |
| **Expense** | Expenses page, Vendors page, Production P&L, CEO financials |
| **OutboundMessage** | WhatsApp page, greetings, quote send, reminders |
| **CatalogItem** | Quotations form, Brand assets CSV, AI list_catalog |
| **DocumentTemplate** | Quotations/Invoices PDF |
| **TelephonyConfig** | Telecaller dialing |
| **QlixConnection** | AI chat primary path |

## Cross-module side effects (today)

| When… | Also updates… |
|-------|----------------|
| Lead created | Pipeline assignment, score, optional greet, optional AI call, n8n, Qlix dirty |
| Call logged | Lead activity; NEW→CONTACTED; maybe follow-up fields; maybe WA send |
| Quote sent | Quotation SENT; lead→QUOTATION; OutboundMessage; n8n quotation.sent |
| Quote edited | Maybe lead→NEGOTIATION |
| Invoice generated | Quotation invoiceNumber + PDF |
| Production stage change | ProductionActivity; customer milestone view; Qlix dirty (**not** n8n) |
| Expense created | Optional production activity; Qlix; Vendors aggregation |
| WA send | UsageDaily; OutboundMessage |

## Redesign implication (observation)

Changing Lead identity (e.g. introducing Customer) or collapsing stage systems touches: Leads UI, Pipeline Workspace, Telecaller, Follow-ups, automations (`systemKey`), AI tools, CEO funnel, Qlix sync documents, and n8n payloads.
