# Telecaller → Sales Calls parity checklist

Inspected: `TelecallerPage.tsx` (original), `LeadCallPanel.tsx`, `CallingView.tsx`,
telecaller/telephony routers, product-audit §Telecaller.

**Status after 2026-09-15 restore:** Calls workspace embeds dial/log in-place.

| # | Capability | Old location | New home |
|---|---|---|---|
| 1 | Lead picker without leaving page | Telecaller left column | Sales → Calls |
| 2 | Continuous call → log → next lead | Same page, pick another lead | Sales → Calls (due queue + Next) |
| 3 | Deep link `?lead=` | `/app/telecaller?lead=` | `/app/sales?view=calling&lead=` |
| 4 | Provider list (VOICE + provisioned + connected) | Telecaller | Calls + Lead → Call |
| 5 | Provider auto-select | Telecaller | Calls + Lead → Call |
| 6 | Manual / own phone | Telecaller | Calls + Lead → Call |
| 7 | Agent phone + localStorage | Telecaller | Calls + Lead → Call |
| 8 | Click-to-call (Exotel / Plivo) | Telecaller | Calls + Lead → Call |
| 9 | Browser call (Twilio) + mute/hangup/timer | Telecaller | Calls + Lead → Call |
| 10 | AI auto-call | Telecaller | Calls + Lead → Call |
| 11 | `tel:` fallback | Telecaller | Calls + Lead → Call + Lead header |
| 12 | Two-step Make call → Log result | Telecaller | Calls + Lead → Call |
| 13 | All dispositions / outcomes | Telecaller | Calls + Lead → Call |
| 14 | Duration (minutes → seconds) | Telecaller | Calls + Lead → Call |
| 15 | Notes | Telecaller | Calls + Lead → Call |
| 16 | Follow-up schedule on CALLBACK_SCHEDULED | Telecaller | Calls + Lead → Call |
| 17 | WhatsApp send catalog on log | Telecaller | Calls + Lead → Call |
| 18 | WhatsApp send quotation on log | Telecaller | Calls + Lead → Call |
| 19 | Inline lead field corrections on log | Telecaller | Calls + Lead → Call |
| 20 | Stage change on log | Telecaller | Calls + Lead → Call |
| 21 | Quick WhatsApp / Email / tel while calling | Telecaller | Calls workspace chrome + Lead header |
| 22 | Send Quote dropdown (WA / email) | Telecaller | Calls chrome + Lead header |
| 23 | Daily summary metrics | Telecaller right column | Sales → Calls |
| 24 | Qualified metric | Telecaller | Sales → Calls |
| 25 | Outcome donut | Telecaller | Sales → Calls |
| 26 | Call log list | Telecaller | Sales → Calls |
| 27 | Call detail modal (transcript, recording, AI, follow-up) | Telecaller | Sales → Calls |
| 28 | Telecaller-scoped summary (`user_id`) | Telecaller | Sales → Calls |
| 29 | Call-first default for TELECALLER role | Telecaller home | Sales defaults to Calls |
| 30 | Best-hours tip banner | Telecaller | Sales → Calls |

## Root cause (fixed)

Lead Call tab preserved dial/log APIs, but Sales → Calling was only a **dashboard +
redirect**. The old Telecaller was a **single-page queue**. Restored by embedding
`LeadCallPanel` in Sales → Calls with due-follow-up queue and Next after log.
