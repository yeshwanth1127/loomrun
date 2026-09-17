# 10 — Route / Screen Matrix

Complete sitemap of the product.

| Module | Page | Route | Primary entity | Main purpose | Main actions | Status | Dependencies |
|--------|------|-------|----------------|--------------|--------------|--------|--------------|
| Public | Landing | `/` | — | Marketing | Signup/Login CTAs | Complete | — |
| Auth | Login | `/login` | User | Sign in | Login | Complete | Auth API |
| Auth | Register | `/register` | Organization, User | Create workspace | Register | Complete | Auth, default pipeline |
| Auth | Super-admin register | `/register-super-admin` | User | Platform admin signup | Register | Complete | SUPER_ADMIN_EMAILS |
| Public | Track order | `/track/:token` | ProductionOrder | Customer status | View milestones | Complete | trackingToken |
| CRM | Leads | `/app/leads` | Lead | CRM hub | CRUD, board, drawer, CSV, quote, order | Complete | Pipeline, Quotation, Production, Calls |
| CRM | Follow ups | `/app/leads/follow-ups` | Lead | Due callbacks | Open Telecaller, WhatsApp | Complete | Call outcomes |
| CRM | Pipelines | `/app/pipelines` | Pipeline | Manage workspaces | Create, archive, default | Complete | PipelineStage |
| CRM | Pipeline workspace | `/app/pipelines/:id` | Pipeline, Lead | Board + settings + analytics | DnD stages, rules, stages editor | Partial | RoutingRule, Lead |
| CRM | Telecaller | `/app/telecaller` | TelecallerCallLog, Lead | Call + log | Dial, log, AI call, send quote | Complete | Telephony, Quotations |
| Settings | Integrations | `/app/leads/connections` | LeadConnection | Connect sources | OAuth, sync, WA QR | Partial | Meta, Google, Baileys, n8n |
| Commerce | Quotations | `/app/quotations` | Quotation | Quotes + PDF + send | Create, PDF, send, invoice | Complete | Lead, Catalog, Templates, Gmail/WA |
| Commerce | Invoices | `/app/invoices` | Quotation | View invoices | Preview, send, delete | Partial | Quotations |
| Ops | Production | `/app/production` | ProductionOrder | Factory orders | Stages, finance, tracking, design | Complete | Lead, Quotation, Expense, Payment |
| Ops | Orders (alias) | `/app/orders` | — | Redirect | — | Legacy | → Production |
| Ops | Vendors | `/app/vendors` | Expense.vendor | Vendor rollup | Search, link to expenses | Partial | Expenses |
| Ops | Expenses | `/app/expenses` | Expense | Cost ledger | CRUD multi-line | Complete | Lead |
| Ops | WhatsApp | `/app/whatsapp` | OutboundMessage | Messaging | Send, templates, history | Partial | Lead, Templates, WA |
| AI | Loomrun AI | `/app/ai` | AiConversation | Assistant | Chat, docs, grants | Complete | Qlix/OpenRouter, tools |
| Analytics | CEO Dashboard | `/app/ceo` | Aggregates | Business KPIs | View, deep links | Complete | Most CRM/ops models |
| Settings | Telephony | `/app/settings/telephony` | TelephonyConfig | Provision phones | Provision Twilio/VAPI/Exotel | Complete* | Telephony providers |
| Settings | Document templates | `/app/document-templates` | DocumentTemplate | PDF layouts | Clone, edit, preview, default | Complete | Brand |
| Settings | Brand assets | `/app/brand-assets` | Organization | Brand + catalog | Upload, bank, CSV catalog | Complete | CatalogItem |
| Settings | Team | `/app/team` | Membership | Users | Add telecaller, WA phone | Partial | Subscription seats |
| Settings | Usage | `/app/settings/usage` | Usage meters | AI/WA usage | View | Complete | Subscription API |
| Settings | Subscription | `/app/subscription` | Organization.plan | Plans / trial | Mailto upgrade | Complete | Entitlements |
| Platform | Admin | `/platform` | Organization, User | SaaS control | Plan, seats, suspend, join | Complete | Super-admin |
| Platform | Admin alias | `/app/admin` | — | Redirect | — | Legacy | → /platform |

\*Telephony BYO is backend-only.

---

## Embedded / non-route screens

| Screen | Hosted in | Entity |
|--------|-----------|--------|
| Lead detail drawer | LeadsPage | Lead |
| Production Design panel | ProductionPage | DesignAsset, Mockup |
| Call detail modal | TelecallerPage | TelecallerCallLog |
| PDF preview modal | Quotations / Invoices | Quotation |
| Qlix activation / knowledge | AiChatPage | QlixConnection, QlixDocument |
| Agent activity dock | AppShell global | AI run |
| Follow-up toast | AppShell | Lead |
