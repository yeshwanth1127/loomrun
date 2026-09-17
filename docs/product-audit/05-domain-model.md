# 05 — Domain Model Map

**Source:** `prisma/schema.prisma` (1128 lines). Business meaning + relationships + flags.

---

## Entity tree (simplified)

```
Organization
├── Membership → User
├── Subscription (plan display; Stripe fields unused)
├── Pipeline[]
│     ├── PipelineStage[]
│     └── PipelineRoutingRule[] (also org-scoped)
├── Lead[]
│     ├── LeadActivity[]
│     ├── TelecallerCallLog[]
│     ├── Quotation[] → QuotationLine[]
│     │     └── (optional) ProductionOrder
│     ├── ProductionOrder[]
│     │     ├── ProductionActivity[]
│     │     ├── Payment[]
│     │     ├── Expense[] (job-linked)
│     │     ├── ProductionDesignAsset[] → ProductionMockup[]
│     │     └── trackingToken (public)
│     ├── Expense[] (lead-linked overhead/job)
│     ├── WhatsAppThread[] → WhatsAppMessage[]
│     └── OutboundMessage[]
├── CatalogItem[]
├── DocumentTemplate[] (+ system templates)
├── Expense[] (org-wide)
├── LeadConnection[]          (Meta, Google Ads, IndiaMART, …)
├── AutomationConnection[]    (Gmail, Calendar, n8n)
├── WhatsAppConnection
├── WhatsAppTemplate[]
├── TelephonyConfig[] → TelephonyUsage[]
├── UsageDaily[]
├── AiUsageWindow[] / AiUsageEvent[]
├── AiOrgMemory
├── AiConversation[] → AiMessage[]
├── AiPendingAction[]
├── QlixConnection
├── QlixSyncQueue[]
├── QlixDocument[]
└── QlixToolGrant[]
```

**No Customer, Order, Shipment, Vendor, or Invoice models.** Those concepts are:
- Customer → Lead (won)
- Order → ProductionOrder
- Shipment → ProductionOrder shipping fields + stages
- Vendor → Expense.vendor string
- Invoice → Quotation with invoiceNumber

---

## Major entities (business meaning)

| Entity | Means |
|--------|-------|
| **Organization** | Tenant / factory workspace; brand, bank, plan, trial, auto-greet |
| **User** | Login identity; may belong to many orgs |
| **Membership** | User↔Org with role + optional telecaller WhatsApp phone |
| **Pipeline** | Named sales workspace (campaign/region/product/…) |
| **PipelineStage** | Custom column; kind OPEN/WON/LOST; optional `systemKey` maps to LeadStage |
| **PipelineRoutingRule** | Auto-assign new leads by source/campaign/region/product/sector |
| **Lead** | Prospect / deal; dual stage fields; attribution; score; follow-up |
| **LeadActivity** | Timeline event on a lead |
| **Quotation** | Quote document (+ invoice fields when converted) |
| **QuotationLine** | Line item |
| **DocumentTemplate** | PDF layout JSON for quote/invoice |
| **CatalogItem** | Product catalog for quoting |
| **ProductionOrder** | Job/order for a lead (optional linked quotation) |
| **ProductionActivity** | Ops timeline (also feeds customer tracking notes) |
| **Payment** | Money collected against a production order |
| **Expense** | Cost — job-linked and/or org overhead |
| **ProductionDesignAsset** | Uploaded artwork |
| **ProductionMockup** | Composed garment preview |
| **TelecallerCallLog** | Call attempt with outcome, recording, AI fields |
| **TelephonyConfig / Usage** | Provider provisioning + metered calls |
| **WhatsAppConnection** | Baileys session status |
| **WhatsAppTemplate** | Outbound message templates |
| **OutboundMessage** | Queued/sent WA/SMS/email payload |
| **WhatsAppThread/Message** | Inbound conversation storage |
| **LeadConnection** | External lead-source credentials |
| **AutomationConnection** | Gmail/Calendar/n8n credentials |
| **Subscription** | Plan record (admin-managed) |
| **UsageDaily** | WhatsApp daily counters |
| **Ai*** / **Qlix*** | AI chat, memory, metering, hosted agent sync |

---

## Duplicate / overlapping concepts

| Pair | Issue |
|------|-------|
| `Lead.stage` (LeadStage) vs `Lead.pipelineStageId` | Two stage systems kept in sync via `systemKey`; Leads UI uses one, Pipeline Workspace the other |
| `Lead.leadStatus` vs stage WON/LOST | Parallel closed-state; UI barely uses leadStatus |
| `LeadSource.WEB` vs `WEBSITE` | Both exist |
| Quotation status vs “is invoice” | Invoice = same row with invoiceNumber |
| ProductionOrder.stage vs orderStatus | Factory step vs health flag (DELAYED/ON_HOLD/…) |
| Production delayFlag vs OrderStatus.DELAYED | Overlapping delay signals |
| Org expenses vs production expenses | Same Expense model, different create UIs/APIs |
| OutboundMessage vs WhatsAppMessage | Outbound queue vs inbound thread messages |
| CallOutcome legacy vs telecaller codes | CONNECTED/NO_ANSWER/… vs CONNECTED_INTERESTED/… |
| Organization.plan vs Subscription.planKey | Dual plan storage |

## Legacy / compatibility fields

| Field | Why |
|-------|-----|
| `Lead.stage` | Historical global stage; still used by Leads board & automations |
| `PipelineStage.systemKey` | Bridge to LeadStage for call/quote hooks |
| `Organization.stripeCustomerId`, `Subscription.stripeSubscriptionId` | Payment integration never wired |
| Legacy CallOutcome values | Old logs / webhooks |
| `Quotation.version` | Present; limited UI |
| `Lead.tags` | Schema only |
| `ProductionOrder` default stage PENDING | Create path uses FABRIC_CHECK |

## Likely unused / thin entities

| Entity | Note |
|--------|------|
| WhatsAppThread/Message | Inbound path writes; no rich inbox UI |
| Subscription | Mostly plan mirrored on Organization |
| AiPendingAction | Infrastructure active; governance mostly auto |
| exora MCP server tables | Uses AutomationConnection; not mounted in main app |

---

## Key relationships for redesign

```
Lead ──1:N── Quotation ──?── ProductionOrder
Lead ──1:N── ProductionOrder
Lead ──1:N── TelecallerCallLog
Lead ──N:1── Pipeline / PipelineStage
ProductionOrder ──1:N── Payment, Expense, Activity, Design, Mockup
Quotation ── “becomes” ── Invoice (same row)
Expense.vendor ── aggregates to ── Vendors page (no FK)
```
