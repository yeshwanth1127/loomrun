# Loomrun — Owner's Manual

*A plain-English guide for the person who owns/runs the business workspace.*

---

## 1. What is Loomrun?

Loomrun is software for businesses that make custom, made-to-order products (like garment or apparel manufacturers) and need to manage the whole journey of a customer order:

1. A potential customer gets in touch (through Facebook/Instagram ads, your website, IndiaMART, WhatsApp, a phone call, or just walking in) → this becomes a **Lead**.
2. Your team follows up, quotes a price → this becomes a **Quotation**.
3. The customer agrees → the quotation becomes an **Invoice**, and the order moves to the factory floor as a **Production Order**.
4. The order is tracked through every manufacturing step (fabric, cutting, stitching, quality check, packing, shipping) until it's delivered and paid for.
5. You, as the owner, get a **CEO Dashboard** that shows how the whole business is doing at a glance — leads, sales, production bottlenecks, money in and out — all in real time.

Everything lives in one place, so nothing falls through the cracks between "someone enquired" and "the order shipped and got paid for."

---

## 2. Getting Started

### Creating your account
When you sign up (the "Create workspace" link on the login page), you give your company name, your email, and a password. This automatically:
- Creates your company's private workspace
- Makes you the **Owner** — the only role with full control
- Starts a **14-day free trial** with every premium feature unlocked (see [Section 8](#8-your-subscription--billing))
- Sets up starter designs for your quotations and invoices, ready to use immediately

### Logging in
Go to the login page, enter your email and password. If you belong to more than one company workspace, you can switch between them from the dropdown at the bottom of the left-hand menu.

---

## 3. Your Team and Roles

When you invite someone to join your workspace (see [Section 5.6](#56-managing-your-team--team)), you give them one of these roles: **Sales, Telecaller, Production,** or **Viewer**. You are the **Owner** — there's only one level of "everyday employee" access today, no matter which of those four role names you pick.

**Every non-Owner teammate, regardless of role, only gets these four pages:**

- **Leads** — the sales pipeline
- **Follow-ups** — the callback worklist
- **Telecaller** — the calling workspace
- **Loomrun AI** — the chat assistant

That's it. They cannot see or open Quotations, Invoices, Production, Expenses, WhatsApp, the CEO Dashboard, or anything under Settings (Integrations, Telephony, Connectors, Document templates, Brand assets, Team, Subscription) — those menu items simply don't appear for them, and even if someone typed the web address directly, the app sends them back to Leads. This isn't just a hidden button: the restriction is enforced on the server too, so it can't be bypassed by a technically savvy employee.

In other words: **as Owner, you are currently the only one who can create/send quotations and invoices, move orders through production, log expenses, send WhatsApp messages or manage templates, view the CEO Dashboard, or touch any setup/billing screen.** Your team's day-to-day job is working leads, making calls, and using the AI assistant — everything downstream of a won deal is on you (or whoever else you personally handle it as). See [Section 4](#4-what-your-employees-can-do) for exactly what that looks like.

If that's tighter than you need for a particular teammate — say, you want one Sales person to also send quotations — that's not configurable from the Team page today; it would need a support request to set up differently.

The role label you choose (Sales/Telecaller/Production/Viewer) doesn't change which pages someone can reach — they're all identical on that front. The one exception: if you specifically pick **Telecaller**, that person's call summary on the Telecaller page shows only *their own* calls instead of the whole team's.

---

## 4. What Your Employees Can Do

Your team isn't locked out of the app — they have a focused set of tools for the front end of the sales process: finding out what a customer wants and getting them on the phone. Here's exactly what's available to them, page by page.

### Leads
- Switch between a **Board view** (drag-and-drop between pipeline stages) and a **Table view**.
- **Add a new lead**: name, source, phone, email, city, product interest, quantity estimate, notes, and estimated value.
- **Search and filter** by name/phone, source, pipeline stage, or lead score.
- **Open any lead** to call or WhatsApp them directly, edit any field inline (phone, email, city, product interest, follow-up date, notes, etc.), log an activity note, and see its full activity timeline.
- Leads move through: New → Contacted → Requirement Collected → Quoted → Negotiation → Sample Sent → Won/Lost, and each one carries a 0–100 lead score to help prioritize who to call first.

### Follow-ups
A worklist of every lead with a promised callback, automatically sorted into Overdue / Today / Upcoming / No date set, with one-click Call and WhatsApp buttons. Purely a view — nothing to configure.

### Telecaller
- Place a call (in-browser, click-to-call, manual, or AI Auto-Call, depending on what you've set up in [Section 5.5](#55-setting-up-phone-calling--telephony)) and log the outcome (Connected, No Answer, Busy, Wrong Number, Not Interested, Callback Scheduled, Qualified), plus duration and notes.
- Update the lead's stage and contact details as part of logging the call.
- On a **Connected** call, tick a box to instantly WhatsApp the customer your **product catalog** and/or their **latest quotation** — this works even though they don't have their own access to the Quotations or WhatsApp pages.
- See a daily call summary — a Telecaller-role teammate sees only their own calls; every other role sees the whole team's.

### Loomrun AI
- Ask questions in plain language, and — on the Scale plan — ask it to create a lead, move a stage, reassign it, or set a follow-up date, always with a confirmation step before anything actually changes.
- It will **not** create or send quotations/invoices, or look up your product catalog, on an employee's behalf — those tools are only available when you, the Owner, are the one chatting (see [Section 6](#6-running-your-business-day-to-day)).

That's the full extent of it. Anything beyond these four pages needs you.

---

## 5. Setting Up Your Company (Owner-only tasks)

These are the one-time (or occasional) setup jobs that only you can do. They're all found under **Settings** in the left menu.

### 5.1 Brand & Business Details — "Brand assets"

This is where your company's identity gets set up so it appears correctly on every quotation and invoice you send:

- **Logo** — upload an image (PNG/JPEG/WebP/GIF, up to 2MB). It shows in your sidebar and on your PDF documents.
- **Signature** — upload a signature image (up to 500KB) to appear on documents.
- **UPI QR code** — upload a payment QR code (up to 200KB) so Indian customers can scan-to-pay straight from an invoice.
- **Business details** — legal/trading name, address, phone, billing email, website, tax ID (GST/VAT).
- **Bank details** — bank name, account number, account holder name, IFSC code, and (optional) SWIFT code, AD code, branch. These print on your invoices so customers know exactly where to send payment.
- **Product Catalog** — your master price list. You can add items one by one, or upload a spreadsheet (CSV file) of your whole catalog at once — the system is smart about reading different column layouts (name, price, SKU, etc.) and will tell you if anything looks off before it saves. This catalog is what you pick from when building a quotation, so it's worth keeping accurate.

Your logo appears in everyone's sidebar automatically, but the rest of this page — including the full business/bank details and the product catalog — is only visible and editable by you.

### 5.2 Designing Your Quotations & Invoices — "Document templates"

Every new workspace starts with a ready-made design for quotations and invoices. As Owner, you can customize it further:

- Clone a starting design and give it your own name.
- Pick a theme color and currency symbol.
- Turn sections on or off (header, title, customer details, line items, totals, payment info, terms, signature, footer — line items and totals can't be turned off since they're the point of the document).
- Reorder sections up or down.
- Fine-tune each section (e.g., which columns show in the line-items table, whether to show your UPI QR code and a payment note, custom terms/footer text).
- Preview exactly what the PDF will look like before saving.
- Mark one design as the **default** used automatically for new quotations, and one for invoices.

This whole page — and quotations/invoices generally — is only reachable by you today, since sending quotations and invoices is one of the Owner-only tools (see [Section 3](#3-your-team-and-roles)).

### 5.3 Connecting Where Your Leads Come From — "Integrations"

This page (also reachable from the Leads page) is your control center for plugging in every channel that brings you new customers:

- **Meta Ads (Facebook/Instagram)** — sign in with your Facebook account; Loomrun finds your Facebook Pages and automatically pulls in everyone who fills out a lead form on your ads, both going forward and (with a "Sync now" button) your past leads too.
- **Google Ads** — connect by pasting in an access key from your Google Ads account.
- **IndiaMART** — paste in your IndiaMART access key; new buy-leads flow in automatically, plus a "sync now" button to pull in older ones.
- **WhatsApp** — connect your WhatsApp messaging so unknown numbers that message you automatically become new leads.
- **Website** — you get a special link to wire into your own website's contact/enquiry form so submissions land directly in Loomrun.
- **Manual/Referral** — always available; your team simply types leads in by hand.
- **Gmail & Google Calendar** — sign in with your Google account so Loomrun can help send emails and manage your calendar on your behalf.
- **Automations** — one click sets up a handful of ready-made automated workflows (for example, auto-sending a follow-up email) tied to a sender email address you choose.

A helpful detail: if the same person contacts you through two different channels (same phone or email), Loomrun automatically recognizes them as one lead instead of creating duplicates.

**Note:** Google Ads, multi-provider phone calling, Gmail/Calendar, and automated workflows are premium features — see [Section 8](#8-your-subscription--billing) for which plan unlocks them.

### 5.4 Setting Up WhatsApp Messaging — "Connectors" and WhatsApp settings

- **Connectors page:** connect your own business WhatsApp number by scanning a QR code, the same way you'd link a device on WhatsApp Web. Once connected, messages sent from Loomrun come from your real business number, and you can disconnect any time.
- **WhatsApp page (Owner-only):** turn on **"Automatically greet new leads"**, so every brand-new lead with a phone number gets an instant welcome message. You can also build and edit a library of reusable message templates (for quotations, invoices, follow-ups, thank-yous, and greetings) with fill-in-the-blank placeholders for the customer's name, company, etc., and send one-off messages yourself. Your team can't send WhatsApp messages from Loomrun directly — but note that the Telecaller call-logging screen has its own separate "send catalog / send quotation" checkboxes that anyone can use (see [Section 4](#4-what-your-employees-can-do)).

### 5.5 Setting Up Phone Calling — "Telephony"

This is where you turn on real phone-calling capability for your telecallers:

- **Browser Calls** — lets your team call leads straight from their computer, no phone needed. Gives you a dedicated business phone number.
- **AI Auto-Calls** — an AI voice assistant that can call leads automatically on your behalf (needs Browser Calls set up first).
- **Click-to-Call** — your team's own phone rings first, then gets connected to the lead — no special equipment needed.
- A **"Provision Everything"** button sets up Browser Calls and AI Auto-Calls together in one step.
- Once set up, you'll see a running usage report: total calls, total minutes, and cost, broken down by which calling service was used.

### 5.6 Managing Your Team — "Team"

- **Add a team member**: enter their email, set an initial password for them, their name, and their role. They're now able to log in immediately.
- You'll see a running count of how many of your plan's included seats are used (e.g., "4 of 10 seats").
- **Note on roles:** the invite form currently offers the Telecaller role by default in the app; other roles (Sales, Production, Viewer) can be requested through support if you need them set up for a new teammate.
- There's currently no button to remove someone or change their role after they're added — contact support if you need a change like that.

---

## 6. Running Your Business Day to Day

Your team's shared tools (Leads, Follow-ups, Telecaller, Loomrun AI) are covered in [Section 4](#4-what-your-employees-can-do). Everything below is yours alone:

- **Quotations** — build a priced quote from your catalog or by hand, generate a PDF, and send it by WhatsApp or email.
- **Invoices** — once a quotation is confirmed, turn it into an invoice with one click, then send or download it.
- **Production** — track every order through your 13-step manufacturing process, log costs and payments against each job, and see live profit/margin per order.
- **Expenses** — your running ledger of both job-specific costs and general business overhead (rent, utilities, etc.).
- **WhatsApp** — send one-off messages, manage templates, and control auto-greeting (see [Section 5.4](#54-setting-up-whatsapp-messaging--connectors-and-whatsapp-settings)).
- **CEO Dashboard** — your one-screen business health check: hot leads, overdue follow-ups, unpaid invoices, production bottlenecks, and full profit-and-loss, updated live.

**A note on the AI assistant:** Loomrun AI respects the same Owner/employee boundary as the rest of the app. Your team can use it for anything Leads-related (look things up, create a lead, move a stage, schedule a follow-up), and they'll always be asked to confirm before anything changes. But if an employee asks it to create or send a quotation/invoice, or look up the catalog, the assistant simply doesn't have access to those tools for them — it can't do it on their behalf, and won't pretend to. Those actions only work through the assistant when you, the Owner, are the one chatting.

---

## 7. Understanding the Order Lifecycle (the numbers behind it)

A few things worth knowing as the business owner:

- **Lead score**: every lead gets an automatic 0–100 "hotness" score based on where it came from and how complete its details are — helps your team prioritize who to call first.
- **Quotation numbers** look like `Q-2026-00001` and reset each new year. When you convert one to an invoice, it becomes `INV-2026-00001` — it's the same document, just relabeled, so nothing needs re-typing.
- **Production stages**, in order: Fabric Check → Procurement → Fabric Received → Cutting → Printing → Stitching → Quality Check → Packing → Payment Hold → Ready to Dispatch → Shipped → Delivered.
- **Automatic actions** that happen without anyone lifting a finger: a brand-new lead with a phone number gets an instant WhatsApp greeting (if you've turned that on) and, if nobody calls them within 5 minutes and you have AI calling set up, the AI will call them for you.

---

## 8. Your Subscription & Billing

Every new company starts on a **14-day free trial** with every premium feature unlocked, just at lower daily limits, so you can try everything before deciding what you need.

| | **Free Trial** (14 days) | **Growth** — ₹2,899/month | **Scale** — ₹5,799/month |
|---|---|---|---|
| Team members included | 3 | 10 | 10 |
| Extra team member | ₹750/month each | ₹750/month each | ₹750/month each |
| Leads you can store | up to 100 | Unlimited | Unlimited |
| WhatsApp messages/day | 15 | 50 | 500 |
| AI assistant messages/day | 15 | 30 | 200 |
| AI assistant can take actions (not just answer questions) | Yes | No — answers questions only | Yes, and understands multiple languages |
| Google Ads as a lead source | Yes | No | Yes |
| Meta (Facebook/Instagram) Ads as a lead source | Yes | Yes | Yes |
| Multiple phone-calling providers | Yes | No | Yes |
| AI voice calling agents | Yes | No | Yes |
| Gmail & Google Calendar | Yes | No | Yes |
| Automated workflows | Yes | No | Yes |

**What happens when the trial ends:** if you haven't picked a paid plan, the app locks — nearly everything stops working except this Subscription page and your Brand assets page, with a reminder to upgrade.

**How to upgrade:** the Subscription page has a "Request [Plan]" button. This opens a pre-filled email to our support team rather than an instant checkout — there's no self-serve credit card payment yet, so upgrades are applied by our team once you reach out.

---

## 9. Getting Help

If something isn't working or you need a setup only support can do (like adding a new role type or an extra plan feature), reach out through the contact link on your Subscription page. Occasionally, if you request help, our support team may need to join your workspace temporarily to troubleshoot on your behalf — this is only ever done to help resolve an issue you've raised.

---

*This manual covers what an Owner can see and do in Loomrun today. For the guide aimed at your team members, see the Employee Manual.*
