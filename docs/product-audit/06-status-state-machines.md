# 06 — Status / State Machines

Every enum and lifecycle system found in schema + UI.

---

## 1. LeadStage (global / legacy)

**Values:** `NEW`, `CONTACTED`, `QUALIFICATION`, `QUOTATION`, `NEGOTIATION`, `SAMPLE`, `WON`, `LOST`

**UI labels (Leads):** New, Contacted, Requirement Collected, Quoted, Negotiation, Sample Sent, Won, Lost

**Used by:** LeadsPage kanban, Telecaller stage select, Follow-ups, filters, automations via `systemKey`

**Changed by:**
- Manual DnD / select on Leads
- Telecaller log (user picks stage)
- `advance_lead_by_system_key` — call→CONTACTED (if NEW); quote send→QUOTATION; quote edit→NEGOTIATION
- Pipeline stage move syncs this from `PipelineStage.systemKey`

**Overlaps:** PipelineStage (custom names with systemKey mapping)

---

## 2. LeadStatus

**Values:** `ACTIVE`, `WON`, `LOST`, `UNQUALIFIED`

**Used by:** Backend when pipeline stage kind is WON/LOST; AI `update_lead`; barely shown in UI

**Overlaps:** LeadStage WON/LOST and PipelineStageKind

---

## 3. PipelineStageKind

**Values:** `OPEN`, `WON`, `LOST`

**Used by:** Pipeline stage editor; board “closed” columns; blocks further systemKey advances when WON/LOST

---

## 4. PipelineType

**Values:** `GENERAL`, `CAMPAIGN`, `REGION`, `PRODUCT`, `SECTOR`, `TEAM`, `CUSTOM`

Metadata only (not a lifecycle).

---

## 5. LeadSource

**Values:** `WHATSAPP`, `TELECALLER`, `WEB`, `INSTAGRAM`, `REFERRAL`, `OTHER`, `META_ADS`, `GOOGLE_ADS`, `INDIAMART`, `WEBSITE`, `MANUAL`

**Note:** WEB and WEBSITE both exist; UI lists differ slightly between pages.

---

## 6. LeadActivityType

`NOTE`, `STAGE_CHANGE`, `ASSIGNMENT`, `CALL`, `WHATSAPP`, `EMAIL`, `SYSTEM`

---

## 7. CallOutcome

**Telecaller UI (preferred):**
`CONNECTED_INTERESTED`, `CONNECTED_NOT_INTERESTED`, `CALLBACK_SCHEDULED`, `RINGING_NO_RESPONSE`, `BUSY`, `SWITCHED_OFF`, `WRONG_NUMBER`, `ORDER_CONFIRMED`

**Legacy (still valid):**
`CONNECTED`, `NO_ANSWER`, `NOT_INTERESTED`, `QUALIFIED`

**Effects:**
- Any call on NEW lead → CONTACTED
- `CALLBACK_SCHEDULED` + next_call_at → follow-up system
- Connected outcomes unlock post-call WhatsApp catalog/quote options
- `ORDER_CONFIRMED` does **not** create ProductionOrder

---

## 8. QuotationStatus

`DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`

**Changed by:** create (DRAFT), send (SENT), generate-invoice (does not require ACCEPTED)

**UI gap:** No controls to set ACCEPTED/REJECTED/EXPIRED; Invoices page treats ACCEPTED||PAID as “Paid” (PAID is not a QuotationStatus — likely bug/confusion with PaymentStatus)

---

## 9. DocumentType

`QUOTATION`, `INVOICE` — template doc type only.

---

## 10. ProductionStage (factory steps)

`PENDING`, `FABRIC_CHECK`, `PROCUREMENT`, `FABRIC_RECEIVED`, `CUTTING`, `PRINTING`, `STITCHING`, `QC`, `PACKING`, `PAYMENT_HOLD`, `READY_DISPATCH`, `SHIPPED`, `DELIVERED`

**Default on create (service):** FABRIC_CHECK  
**Schema default:** PENDING

**Customer milestone mapping:**
| Internal stages | Customer milestone |
|-----------------|--------------------|
| PENDING, FABRIC_CHECK | CONFIRMED |
| PROCUREMENT, FABRIC_RECEIVED | MATERIALS |
| CUTTING, PRINTING, STITCHING | PRODUCTION |
| QC | QC |
| PACKING, PAYMENT_HOLD, READY_DISPATCH | PACKING |
| SHIPPED | SHIPPED |
| DELIVERED | DELIVERED |

---

## 11. OrderStatus (order health)

`ON_TRACK`, `AT_RISK`, `DELAYED`, `ON_HOLD`, `COMPLETED`, `CANCELLED`

**Overlaps:** `delayFlag` boolean; ProductionStage SHIPPED/DELIVERED vs COMPLETED status

---

## 12. PaymentStatus

`PENDING`, `PARTIAL`, `PAID` — on Payment records (production finance)

---

## 13. ProductionActivityType

`ORDER_CREATED`, `STAGE_CHANGED`, `DELAY_TOGGLED`, `PAYMENT_RECORDED`, `EXPENSE_RECORDED`, `BUDGET_SET`, `NAME_CHANGED`, `NOTE_ADDED`, `STATUS_CHANGED`, `ETA_UPDATED`, `SHIPMENT_UPDATED`

---

## 14. OutboundChannel / OutboundMessageStatus

Channel: `WHATSAPP`, `SMS`, `EMAIL`  
Status: `QUEUED`, `SENDING`, `SENT`, `FAILED`

---

## 15. WhatsAppTemplateCategory

`QUOTATION`, `INVOICE`, `FOLLOW_UP`, `THANK_YOU`, `GREETING`

---

## 16. MembershipRole

`OWNER`, `SALES`, `TELECALLER`, `PRODUCTION`, `VIEWER`

---

## 17. String statuses (not Prisma enums)

| Field | Values (from code) |
|-------|--------------------|
| WhatsAppConnection.status | connecting, connected, disconnected |
| LeadConnection.status | connected, disconnected, … |
| AutomationConnection.status | connected, disconnected |
| TelephonyConfig.status | disconnected / provisioned states |
| QlixConnection.status | disconnected, provisioning, connected, error |
| QlixSyncQueue.status | pending, done, failed |
| QlixDocument.status | uploading, pending, ready, failed |
| ProductionMockup.status | READY, FAILED |
| AiPendingAction.status | pending, confirmed, cancelled, expired |
| Organization.plan | free, growth, scale |
| Subscription.status | inactive, … |

---

## Confusing / duplicated state machines

1. **LeadStage vs PipelineStage** — primary product confusion for redesign
2. **LeadStatus vs closed stages** — third closed-state axis
3. **QuotationStatus.ACCEPTED vs PaymentStatus.PAID vs invoice “Paid” UI** — mixed money language
4. **OrderStatus vs ProductionStage vs delayFlag** — three ways to say “delayed / done”
5. **CallOutcome dual sets** — legacy + telecaller codes
6. **LeadSource WEB vs WEBSITE**
