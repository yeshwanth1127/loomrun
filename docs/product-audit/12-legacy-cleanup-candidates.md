# 12 — Legacy / Cleanup Candidates

**DO NOT DELETE.** Candidates that appear unused, duplicated, superseded, temporary, test-only, or legacy — with WHY.

---

## Strong candidates (appear removable after product confirmation)

| Item | Why |
|------|-----|
| **Fabblen_*.svg + Fabblen docs references** | Pre-rename product diagrams; not used by app runtime |
| **RegisterPage placeholder “Fabblen Exports”** | Legacy brand string in form placeholder |
| **`/app/orders` redirect** | Alias only; keep URL if external links exist, else drop later |
| **`/app/admin` redirect** | Alias to `/platform` |
| **n8n AutomationCard / N8nSetupModal (unrendered)** | Dead UI; either ship or remove to reduce confusion |
| **AiPendingAction + approval UI path** | Dormant while Qlix governance=`auto` and propose_writes=False — product must choose: enable JIT or remove UX |
| **Stripe fields** (`stripeCustomerId`, `stripeSubscriptionId`) | No checkout; keep only if payments planned |
| **Legacy CallOutcome values in new UI lists** | Keep for DB reads; stop offering in new log forms if migrated |
| **LeadSource.WEB vs WEBSITE** | Consolidate to one |
| **exora MCP server** | Unwired standalone; supersede with Qlix tools or document as optional |
| **ARQ job definitions for PDF/outbound** | Main app uses asyncio/polls; worker is optional/orphaned |
| **`GET /ai/memory`, `GET /qlix/status`, `POST /ai/chat` (non-stream)** | Superseded by status embed / stream UI |
| **`GET /leads/meta-campaigns`** | No frontend caller |
| **`RowActions` unused on CRM pages** | Component exists; Quotations/Invoices use it — CRM doesn’t |
| **CEO `integrations` response field** | API returns; UI never renders |
| **Telephony stub webhooks** (plivo/telnyx/vonage/retell/bland) | Accept POST, no-op — remove or implement |
| **MANAGED_PROVIDERS unused constant** on TelephonyPage | Dead code |
| **Production duplicate empty-state block** | Bug / leftover markup |
| **WhatsApp Automations tab stub** | Placeholder links only |

---

## Soft candidates (don’t remove without redesign decision)

| Item | Why caution |
|------|-------------|
| **Global LeadStage enum + Leads board** | Core UX today; redesign may replace with pipelines-only |
| **Invoices as Quotation subset** | Works; may become first-class Invoice later |
| **Vendors page** | Thin but used as expense rollup |
| **Organization.plan vs Subscription** | Dual storage; migrate carefully |
| **WhatsAppThread/Message** | Inbound storage; inbox UI may come |
| **leadStatus field** | Sparse UI use; automations may rely |
| **Quotation.version** | Limited UI; may matter for audit |
| **delayFlag vs OrderStatus.DELAYED** | Both written today |

---

## Temporary / new (keep — not cleanup)

| Item | Note |
|------|------|
| Production design/mockups | New, complete v1 |
| Pipeline workspaces | New, core CRM direction |
| AI usage windows | New metering |
| Qlix integration | Primary AI path |

---

## Test-only / samples

| Item | Note |
|------|------|
| `apps/api/tests/*` | Keep |
| `samples/` | Sample data files — not product UI |
| Client-generated `loomrun-leads-sample.csv` | Helpful; fix stage labels |

---

## Config / env gaps (cleanup of docs, not code)

- `.env.example` omits some `config.py` vars (e.g. WHATSAPP_PHONE_NUMBER_ID)
- README still describes ARQ as primary PDF/outbound path — outdated vs poll loops
