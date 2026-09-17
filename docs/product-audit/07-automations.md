# 07 — Automations

Format: TRIGGER → CONDITION → ACTION → DATA UPDATED

Scheduler: FastAPI lifespan starts **8 asyncio poll loops** (not ARQ for routine work). ARQ jobs exist in `workers.py` but are largely unused by the main process.

---

## Poll loops (`main.py`)

| Name | Interval | Startup delay |
|------|----------|---------------|
| whatsapp_outbound | 60s | 0 |
| gmail_sync | 300s | 30s |
| indiamart_sync | 600s | 15s |
| meta_leads_sync | 10s | 5s |
| google_ads_sync | 60s | 25s |
| follow_up_reminders | 60s | 20s |
| qlix_brain_sync | 30s | 20s |
| qlix_brain_sweep | 3600s | 180s |

Errors: logged per poll; org-level failures swallowed so loop continues.

---

## Automation catalog

### 1. WhatsApp outbound queue
**TRIGGER** Poll 60s  
**CONDITION** OutboundMessage QUEUED, channel WHATSAPP  
**ACTION** Baileys send_text if connected, else Meta Cloud API  
**DATA** status SENT/FAILED, attempts, lastError

### 2. Auto-greet new leads
**TRIGGER** `schedule_greeting` after live lead create (manual, Meta webhook, IndiaMART upsert, WA inbound)  
**CONDITION** autoGreetNewLeads; phone present; lead age ≤10 min; no prior greeting message  
**ACTION** Send GREETING template via Baileys or Meta  
**DATA** OutboundMessage + LeadActivity WHATSAPP  
**SKIP** CSV import, Meta/Google bulk sync

### 3. Pipeline auto-routing
**TRIGGER** Lead create/ingest without pipeline  
**CONDITION** Active routing rules by priority, else default Sales pipeline  
**ACTION** Assign pipelineId + pipelineStageId; sync Lead.stage + leadStatus  
**DATA** Lead fields  
**NOTE** Does not re-route assigned leads on later attribute edits

### 4. Call → stage
**TRIGGER** Call logged / telephony webhook path via `sync_lead_after_call`  
**CONDITION** Lead stage == NEW  
**ACTION** advance to CONTACTED via systemKey  
**DATA** Lead stage fields + LeadActivity CALL

### 5. Follow-up scheduling
**TRIGGER** Call outcome CALLBACK_SCHEDULED + next_call_at  
**ACTION** Set nextFollowUpAt; clear reminder acks  
**DATA** Lead.nextFollowUpAt, followUpRemindedAt, followUpWaRemindedAt

### 6. In-app follow-up toasts
**TRIGGER** AppShell poll `/follow-ups/due` 30s  
**ACTION** Toast + POST ack  
**DATA** followUpRemindedAt

### 7. WhatsApp follow-up to telecaller
**TRIGGER** Poll 60s  
**CONDITION** due nextFollowUpAt; last outcome CALLBACK_SCHEDULED; telecaller whatsappPhone set  
**ACTION** WA message to **telecaller** (not lead)  
**DATA** followUpWaRemindedAt

### 8. Quotation send → stage
**TRIGGER** send_document success  
**CONDITION** Lead not WON/LOST; only_if_earlier  
**ACTION** Advance to QUOTATION  
**DATA** Lead + Quotation SENT + OutboundMessage

### 9. Quotation edit → negotiation
**TRIGGER** Update quotation that was already quoted  
**ACTION** Advance to NEGOTIATION (from QUOTATION)  
**DATA** Lead

### 10. PDF generation
**TRIGGER** generate-pdf / create+finalize  
**ACTION** asyncio task renders PDF to STORAGE_DIR  
**DATA** Quotation.pdfUrl

### 11. Meta / Google Ads / IndiaMART sync
See integrations doc — poll + webhook + manual sync; create/update Lead + LeadConnection stats.

### 12. Gmail inbox → lead activity
**TRIGGER** Poll 5 min  
**CONDITION** Gmail AutomationConnection connected  
**ACTION** History API; match sender email to Lead.email  
**DATA** LeadActivity EMAIL; connection credentials cursor

### 13. AI auto-call (5 min)
**TRIGGER** create_lead → sleep 300s → check_lead_call_needed  
**CONDITION** No prior call log; phone; AI_CALL TelephonyConfig active  
**ACTION** VAPI initiate; log AI_AUTO  
**DATA** TelecallerCallLog + lead CONTACTED if NEW

### 14. Domain events → n8n
**TRIGGER** org_events.emit  
**EVENTS ACTUALLY EMITTED:** `lead.created`, `lead.stage_changed`, `quotation.sent`  
**NOT EMITTED:** `production.stage_changed` (documented only)  
**ACTION** POST webhooks with optional signature  
**DATA** none locally (external)

### 15. Qlix Brain sync
**TRIGGER** org_events.record_changed → queue; drain 30s; sweep hourly  
**ACTION** Upsert/delete CRM docs in Qlix Brain  
**DATA** QlixSyncQueue status; lastSyncedAt

### 16. AI memory extraction
**TRIGGER** After chat turn (async)  
**CONDITION** Capacity available; not routine CRUD heuristics  
**ACTION** LLM extract facts/summary  
**DATA** AiOrgMemory (+ usage event source=memory)

### 17. Usage metering
**WhatsApp:** increment UsageDaily on send; plan daily caps  
**AI:** debit AiUsageWindow session_5h + weekly on chat/memory/automation/qlix; 429 at limit

### 18. Production activity logging
**TRIGGER** Stage/status/shipment/payment/expense/design mutations  
**ACTION** ProductionActivity create  
**NOTE** Does not emit n8n production event

### 19. Startup seed
**TRIGGER** App lifespan  
**ACTION** ensure_system_templates(); storage dir; start polls; mount MCP

---

## Automatic vs manual (summary)

| Happens automatically | Always manual |
|-----------------------|---------------|
| Routing new leads | Create production order |
| Greet (when enabled) | Convert to invoice |
| NEW→CONTACTED on call | Advance production stages |
| Quote send→QUOTATION stage | Accept quotation status |
| Connector polls | Record payments |
| Outbound WA queue | Most CRM edits |
| Follow-up reminders | Start order from won lead |
| AI delayed auto-call | — |
| Qlix dirty sync | — |
