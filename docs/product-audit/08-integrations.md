# 08 — Integrations

---

## 1. Meta Lead Ads (Facebook / Instagram)

| | |
|--|--|
| **Auth** | OAuth2; tokens in `LeadConnection` (META_ADS) |
| **Env** | META_APP_ID, META_APP_SECRET, META_FB_LOGIN_CONFIG_ID, META_WEBHOOK_VERIFY_TOKEN, PUBLIC_API_URL |
| **Scopes** (no config id) | leads_retrieval, pages_manage_metadata, pages_show_list, pages_read_engagement |
| **In** | Webhook `/v1/hooks/meta` + poll 10s + manual sync → Lead meta* fields |
| **Out** | Graph API lead fetch, page subscribe leadgen |
| **UI** | Settings → Integrations |
| **Status** | Production-ready |
| **Gate** | Feature `meta_lead_ads` (all paid plans / trial) |

## 2. Google Ads Lead Forms

| | |
|--|--|
| **Auth** | OAuth scope `https://www.googleapis.com/auth/adwords` + developer token + login customer id |
| **In** | Poll 60s / manual → Lead googleAds* fields |
| **Out** | Google Ads API v18 lead_form_submission_data |
| **UI** | Integrations |
| **Status** | Working-but-rough (test token limits) |
| **Gate** | `google_ads` (Scale/trial; not Growth) |

## 3. Google Gmail

| | |
|--|--|
| **Auth** | OAuth: gmail.send, gmail.readonly, gmail.modify + openid email profile |
| **Store** | AutomationConnection GMAIL |
| **In** | Inbox history poll → LeadActivity EMAIL |
| **Out** | Quotation/invoice email; gmail/send API |
| **UI** | Integrations connect; send used from Quotations (no inbox UI) |
| **Status** | Production-ready |
| **Gate** | `gmail_calendar` |

## 4. Google Calendar

| | |
|--|--|
| **Auth** | calendar + calendar.events scopes |
| **Store** | AutomationConnection GOOGLE_CALENDAR |
| **Execution** | exora MCP tools only — no FastAPI calendar routes |
| **UI** | Connect card only |
| **Status** | Partial |

## 5. IndiaMART

| | |
|--|--|
| **Auth** | API key in LeadConnection.credentials |
| **In** | Poll 10 min + push webhook (no signature) |
| **UI** | **None** — not in ALL_SOURCES connect list |
| **Status** | Backend only / Partial |

## 6. WhatsApp — Baileys (primary outbound)

| | |
|--|--|
| **Auth** | QR pairing; BAILEYS_SERVICE_SECRET |
| **Service** | Node sidecar `apps/whatsapp-baileys` |
| **Out** | Text, document (PDF), image (mockups) |
| **UI** | Integrations + used across send paths |
| **Status** | Production-ready |

## 7. WhatsApp — Meta Cloud API (fallback + inbound)

| | |
|--|--|
| **Auth** | WHATSAPP_ACCESS_TOKEN + PHONE_NUMBER_ID (platform-global) |
| **In** | `/v1/hooks/whatsapp/{org_id}` (no signature) |
| **Out** | Fallback when Baileys disconnected (except quotation PDF send — Baileys required) |
| **Status** | Working-but-rough |

## 8. n8n

| | |
|--|--|
| **Auth** | N8N_API_KEY provision; per-org webhook_secret |
| **Events in** | lead.created, lead.stage_changed, quotation.sent |
| **Out from n8n** | `/v1/automation/llm/chat` with LOOMRUN_AUTOMATION_API_KEY |
| **UI** | Code exists; **AutomationCard not rendered** |
| **Status** | Partial |
| **Gate** | `event_automations` |

## 9. Qlix (hosted AI)

| | |
|--|--|
| **Auth** | QLIX_PARTNER_KEY; per-org qlix_live_* key |
| **Base** | https://qlix.exora.solutions/api/v1 |
| **MCP** | Loomrun `/mcp` with signed X-Loomrun-Context |
| **UI** | AiChatPage activation |
| **Status** | Production-ready when qlix_ready |
| **Gate** | QLIX_ENABLED + partner key + MCP URL |

## 10. OpenRouter (LLM)

| | |
|--|--|
| **Auth** | OPENROUTER_API_KEY |
| **Use** | Local AI agent, memory extract, n8n LLM proxy |
| **Default model** | openai/gpt-4o-mini |
| **Status** | Production-ready when key set |

## 11. Telephony — Twilio

Browser SDK dialing; platform master credentials; TwiML + status/recording webhooks; usage metering. **Production-ready.** Gate: `outbound_telephony_providers`.

## 12. Telephony — Exotel

Click-to-call; platform master creds; webhook **without** signature. **Working.**

## 13. Telephony — VAPI

AI outbound; webhook secret; end-of-call report. **Production-ready.** Gate: `ai_voice_agents`.

## 14. Telephony — Plivo / Telnyx / Vonage / Retell / Bland

Adapters and/or stub webhooks. **Partial / stubbed.** BYO API exists; no self-serve UI.

## 15. Payment / billing

**No Stripe/Razorpay checkout.** Plans assigned by admin; upgrade via mailto. Schema has stripe* fields unused. **Manual billing.**

## 16. exora MCP server (`apps/mcp`)

Standalone Gmail/Calendar MCP on port 8003. **Not mounted** in main API / not in pm2 ecosystem. Separate from Qlix CRM MCP.

## 17. Google Drive

**Not implemented.**

---

## Entitlement feature keys (plans)

| Key | Free trial | Growth | Scale |
|-----|------------|--------|-------|
| ai_chat | advanced | minimal | advanced |
| ai_multilingual | yes | no | yes |
| google_ads | yes | no | yes |
| meta_lead_ads | yes | yes | yes |
| outbound_telephony_providers | yes | no | yes |
| ai_voice_agents | yes | no | yes |
| gmail_calendar | yes | no | yes |
| event_automations | yes | no | yes |
| messages_per_day | 15 | 50 | 500 |
| ai_credits_per_5h / week | 80/400 | 120/700 | 400/2500 |
| max_users | 3 | 10 | 10 |
| max_leads (trial) | 100 | unlimited | unlimited |
