---
name: Org Brain (central org memory)
overview: "Replace the single LLM-written `ai_org_memories` blob with a tiered, provenance-tracked, time-aware Org Brain: one row per fact, three trust tiers (declared > derived > observed), a proposal/confirm pipeline instead of silent LLM writes, a derived-facts engine that recomputes truth from CRM data, absolute-dated validity with expiry and decay, retrieval-based prompt assembly, and a real owner-facing control surface. Consumed by AI chat, the Qlix Brain mirror, WhatsApp replies and quotation drafting."
todos:
  - id: p0-control-surface
    content: "Ship an edit path on the existing blob: PUT/PATCH/DELETE /orgs/{id}/ai/memory (OWNER-gated), editable Org memory panel in AiChatPage, and a record_changed call so Qlix stops serving corrected-away facts"
    status: pending
  - id: p1-facts-table
    content: "Add OrgFact model + migration with partial unique index on (organization_id, key) WHERE status='active'; backfill existing facts JSON as tier=observed/confidence=0.4/review_after=now(); brain/store.py with dual-read shim so nothing breaks"
    status: pending
  - id: p2-arbitration
    content: "Proposal pipeline: extractor writes status='proposed' only; brain/arbitrate.py applies tier precedence + conflict rules; activation is a transaction that supersedes (never deletes); review queue endpoints (confirm/reject/pin)"
    status: pending
  - id: p3-derived
    content: "brain/derive.py computing primary_markets, products, revenue vs goal, win rate, avg deal size, sales cycle, team roster, active channels from CRM tables; PollTask 'brain_derive' on a 6h interval + manual rebuild endpoint"
    status: pending
  - id: p4-temporal
    content: "Absolute-date resolution in the extractor (no relative dates persisted), valid_from/valid_until/review_after, expiry + confidence decay job, stale-fact review queue with UI badge"
    status: pending
  - id: p5-retrieval
    content: "brain/brief.py: pinned+declared+derived always, top-K observed scored by key match/confidence/recency within a per-mode token budget; render with age and confidence annotations; replace format_memory_block in the prompt path"
    status: pending
  - id: p6-fanout
    content: "Brain as a service: get_brief(org, purpose, query) consumed by Qlix render_memory, WhatsApp auto-reply, quotation drafting and telecaller scripts; immediate mirror refresh on every fact change"
    status: pending
  - id: p7-safety-cost
    content: "Secret/PII deny-list before persisting observed facts, idempotency hash to skip duplicate proposals, prefilter + batching so extraction is not one LLM call per turn"
    status: pending
isProject: false
---

# Org Brain — a central, trustworthy org memory

## 1. What is wrong with the current design

Today the whole thing is one row in `ai_org_memories`: a `summary` string and a flat
`facts` JSONB dict, written only by an unsupervised LLM pass after each chat turn
(`ai_agent/memory.py`), read only by prompt injection (`ai_agent/service.py:493`).

| Property | Today | Consequence |
|---|---|---|
| Granularity | one JSON blob | non-atomic read-modify-write → concurrent turns lose patches |
| Provenance | none | cannot answer "why does the agent believe this?" |
| Confidence | none | an offhand remark ranks equal to a deliberate statement |
| Time validity | none | `org_goal: 5 lakhs in the next 60 days` never expires and has no anchor date |
| Writers | LLM extractor only | owner cannot correct a wrong fact except by hoping the extractor notices |
| Deletion | destructive `forget` | no history, no rollback |
| Scale | `_MAX_FACTS = 40`, whole set dumped into every prompt | does not grow into a real brain |
| Sync | no `record_changed` on write | Qlix mirror keeps serving superseded facts until the hourly sweep |

The root mistake is treating **every** fact as the same kind of thing. Some org facts
are declarations only a human can make, some are measurements the CRM already knows
better than any LLM, and some are inferences from conversation. Collapsing all three
into one untyped dict is what makes the brain both wrong and uncorrectable.

## 2. Core model: three tiers, strict precedence

```
declared  (human-entered, structured)      trust 1.0   never overwritten by an LLM
   ↑ beats
derived   (computed from CRM tables)       trust 0.9   recomputed on a schedule, self-correcting
   ↑ beats
observed  (LLM-extracted from chat)        trust ≤0.7  proposal-first, confirmable, decays
```

Precedence is a hard rule, not a heuristic: a lower tier can never activate over a
higher tier for the same key. It resolves most "slightly wrong" cases with no human in
the loop — `primary_markets` computed from the actual distribution of `Lead.city` beats
an LLM's guess of "bangalore", permanently and automatically.

Applying it to the current contents of this org's memory:

| Key | Correct tier | Why |
|---|---|---|
| `org_owner` | declared | it is a fact about the account, not an inference |
| `industry` | declared | not derivable; owner picks from a list |
| `products` | derived | top `Lead.productInterest` + catalog items actually quoted |
| `primary_markets` | derived | distribution of `Lead.city` over the trailing 180 days |
| `org_goal` | declared + derived progress | the target is a declaration; attainment is measured |
| `brand_voice`, `pricing_notes` | observed | genuinely conversational, confirmable |

## 3. Data model

```prisma
model OrgFact {
  id             String    @id @default(cuid())
  organizationId String    @map("organization_id")

  /// Dotted namespace, stable across supersessions: "org.industry", "goal.revenue", "pref.language"
  key            String
  /// Prompt-facing text.
  value          String    @db.Text
  /// Structured payload for derived/numeric facts: { "amount": 500000, "currency": "INR" }
  valueJson      Json?     @map("value_json")

  /// declared | derived | observed
  tier           String    @default("observed")
  /// proposed | active | superseded | rejected | expired
  status         String    @default("proposed")
  confidence     Float     @default(0.5)

  /// "ui:user:<id>" | "chat:<message_id>" | "derive:lead_city_distribution" | "migration:v1"
  source         String
  sourceRef      String?   @map("source_ref")

  validFrom      DateTime  @default(now()) @map("valid_from")
  /// Absolute expiry. Time-boxed facts get one; evergreen facts do not.
  validUntil     DateTime? @map("valid_until")
  /// When this should be re-surfaced for confirmation.
  reviewAfter    DateTime? @map("review_after")
  confirmedAt    DateTime? @map("confirmed_at")
  confirmedBy    String?   @map("confirmed_by")

  /// Append-only history: the row this one replaced.
  supersedesId   String?   @map("supersedes_id")
  /// Always in the brief, exempt from retrieval scoring.
  pinned         Boolean   @default(false)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, status, tier])
  @@index([organizationId, key, status])
  @@index([organizationId, status, reviewAfter])
  @@map("org_facts")
}
```

Add by raw SQL in the same migration — Prisma cannot express it, and it is the piece
that makes the lost-update race structurally impossible:

```sql
CREATE UNIQUE INDEX org_facts_one_active_per_key
  ON org_facts (organization_id, key) WHERE status = 'active';
```

One active value per key, enforced by Postgres. Two concurrent activations now fail
loudly on the second insert instead of silently clobbering each other.

`ai_org_memories` is **kept**, demoted from source of truth to a cache of the rendered
brief (`summary` = generated narrative, `facts` = last rendered snapshot). Existing
readers — including `qlix/documents.py:render_memory` and the chat status payload —
keep working through P1 with no change.

## 4. Write pipeline: propose → arbitrate → activate

Extraction never writes an active fact again. `extract_memory_from_turn` emits
proposals; `brain/arbitrate.py` decides what happens to each:

```
proposal (key, value, tier, confidence, correction?)
   │
   ├─ deny-list hit (secret/PII/one-off) ────────────────► drop, log
   ├─ idempotency hash matches active fact ─────────────► touch confirmedAt, done
   ├─ no active fact for key ──┬─ confidence ≥ 0.75 ────► activate
   │                           └─ else ─────────────────► status='proposed' → review queue
   ├─ active fact is a HIGHER tier ─────────────────────► reject, log the disagreement
   └─ active fact is SAME tier ─┬─ correction flag set ─► supersede + activate, surface "Undo" in UI
                                └─ else ────────────────► status='proposed' → review queue
```

Activation is one transaction: `UPDATE ... SET status='superseded'` on the incumbent,
then `INSERT` the new row with `supersedesId` pointing at it. Nothing is ever deleted —
`DELETE` in the API means `status='rejected'`. The supersession chain *is* the audit
log, so "why does the agent think X, and what did it think before?" is a single query.

The extractor prompt changes in three ways: it must (1) return absolute ISO dates, never
relative phrases, (2) set `correction: true` when the user is explicitly overriding a
prior belief, and (3) emit a `tier` hint so it can never propose `declared`.

## 5. Derived facts engine

The highest-leverage piece, and the one with no LLM in the loop at all. `brain/derive.py`
recomputes these from tables that are already correct:

| Key | Computation |
|---|---|
| `market.primary` | top 3 `Lead.city` by count, trailing 180d |
| `product.top` | top `Lead.productInterest` by count + `CatalogItem`s appearing on `ACCEPTED` quotations |
| `sales.revenue_accepted` | `SUM(Quotation.total)` where `status = ACCEPTED`, current goal window |
| `sales.win_rate` | `WON / (WON + LOST)` over `Lead.stage`, trailing 90d |
| `sales.avg_deal_size` | mean `Quotation.total` on `ACCEPTED` |
| `sales.cycle_days` | median days from `Lead.createdAt` to first `ACCEPTED` quotation |
| `channel.active` | `LeadSource` values producing leads in the trailing 30d |
| `team.roster` | `Membership` grouped by `MembershipRole` |

Runs as a `PollTask(name="brain_derive", interval=21600, startup_delay=240)` alongside
the existing pollers in `main.py`, plus a manual `POST /orgs/{id}/brain/rebuild`.
Derived facts are rewritten wholesale each pass (supersede + insert only when the value
actually changed, so the history stays meaningful).

This is what makes the brain self-correcting: if the org starts selling hoodies, the
brain notices within six hours without anyone saying anything to the chat.

## 6. Temporal model — the "changes over time" fix

Three mechanisms, in order of bluntness:

1. **Absolute dating at write time.** "in the next 60 days" stated on 2026-08-19 is
   persisted as `validUntil = 2026-10-18`. No relative phrase ever reaches the database.
2. **Expiry.** A daily job flips `status='active' AND validUntil < now()` to `expired`.
   Expired facts leave the brief automatically; the goal stops being asserted as current
   the day it lapses. Where a goal expires, the review queue offers "renew / revise / drop".
3. **Decay.** `observed` facts not reconfirmed within 90 days lose confidence on a curve;
   below 0.35 they move to the review queue rather than silently persisting. `declared`
   and `derived` never decay — declared because a human owns it, derived because it is
   recomputed anyway.

The brief renders age so the model can reason about staleness instead of treating
everything as eternal truth:

```
## Org brain
- org.industry: clothing — declared by owner, 2026-08-19
- product.top: t-shirts, hoodies — derived from 142 leads, 3h ago
- goal.revenue: ₹5,00,000 by 2026-10-18 — declared 2026-08-19; ₹2,14,500 accepted so far (43%)
- brand.voice: warm, direct, no jargon — observed, unconfirmed
```

## 7. Read pipeline: retrieval, not dump

`brain/brief.py::build_brief(organization_id, *, purpose, query=None, budget=None)`:

- **Always included:** `pinned` + all `declared` + all `derived` (bounded and small by
  construction — a few dozen short lines).
- **Selected:** top-K `observed` facts scored by key/token overlap with the current
  query, times confidence, times a recency factor. Postgres full-text over `key || value`
  is enough here; there is no pgvector in this stack and adding one is a P7 concern.
- **Budgeted** per mode, mirroring the existing `knowledge.py::_BUDGET` split
  (`minimal` / `advanced`).
- **Annotated** with tier, age and an explicit `unconfirmed` marker, so the system prompt
  can carry one rule that actually resolves conflicts: *prefer declared over derived over
  observed, and prefer a tool result over any of them.*

This replaces `format_memory_block` in `prompts.py`.

## 8. Control surface

API (`routers/brain.py`, all under the existing `get_org_context`):

| Method | Path | Role |
|---|---|---|
| `GET` | `/orgs/{id}/brain` | any member — facts grouped by tier + review queue |
| `POST` | `/orgs/{id}/brain/facts` | `OWNER` — declare a fact (tier=declared, active) |
| `PATCH` | `/orgs/{id}/brain/facts/{fact_id}` | `OWNER` — edit value / pin / set validity |
| `POST` | `/orgs/{id}/brain/facts/{fact_id}/confirm` | `OWNER` — promote a proposal |
| `POST` | `/orgs/{id}/brain/facts/{fact_id}/reject` | `OWNER` — status=rejected |
| `GET` | `/orgs/{id}/brain/facts/{fact_id}/history` | `OWNER` — supersession chain |
| `POST` | `/orgs/{id}/brain/rebuild` | `OWNER` — force derived recompute |

Use `Depends(require_roles("OWNER"))` as the other settings routers do.

UI — a dedicated **Org Brain** settings page, not a 140px read-only strip in the chat
sidebar. Three sections plus a review queue:

- **Declared** — a real form (industry, products, goal + target date, markets, brand
  voice, language). This is where the owner fixes what is wrong today, in ten seconds.
- **Derived** — read-only, each row showing its computation and freshness, with one
  "Recompute now" button.
- **Observed** — list with confirm / reject / pin per row, and the source turn linked.
- **Needs review** — expired goals, decayed facts, conflicting proposals; badge count in
  the nav so it gets attention without a notification system.

The chat sidebar keeps a compact read-only summary that deep-links here.

## 9. Fan-out — one brain, many consumers

Org memory is currently a chat-only feature. Once it is a service, the same brief should
feed WhatsApp auto-replies, quotation drafting tone, and telecaller scripts — a single
place to fix "the AI keeps getting our business wrong" everywhere at once.

Concretely: every activation calls `org_events.record_changed(entity_type=ENTITY_MEMORY,
entity_id=SUMMARY_KEY)` so the Qlix mirror refreshes on the next 30s drain instead of the
hourly sweep, and `qlix/documents.py::render_memory` renders from `build_brief` rather
than the raw dict.

## 10. Safety and cost

- **Deny-list before persistence.** The current prompt *asks* the model not to store
  passwords; a prompt instruction is not a control. Add a regex/keyword filter for
  credentials, API keys, card and Aadhaar-shaped numbers, and personal contact details of
  non-org individuals, applied to every proposal before it is written.
- **Idempotency.** Hash `(org, key, normalized value)`; a proposal matching the active
  fact refreshes `confirmedAt` instead of creating churn.
- **Extraction cost.** Today every turn fires a second LLM call. Add a cheap heuristic
  prefilter (does the turn contain first-person org statements, numbers, corrections?) and
  batch on conversation idle rather than per turn. Expect a large majority of turns to
  skip the call entirely.
- **Tenancy.** Every query already scopes by `organizationId`; keep it in the store layer
  so no call site can forget.

## 11. Migration

1. Ship P0 on the existing blob — the owner can fix wrong data the same day, no migration
   risk.
2. Create `org_facts` + the partial unique index.
3. Backfill each key in the existing `facts` JSON as `tier='observed'`, `status='active'`,
   `confidence=0.4`, `source='migration:v1'`, `reviewAfter=now()`. Active, so the agent
   loses nothing; low confidence with immediate review, so everything inherited surfaces
   in the queue for a one-pass cleanup.
4. `brain/store.py` reads facts and falls back to the blob when the table is empty; the
   blob keeps being written as a cache. Delete the fallback once every org has rows.
5. Run the derive pass once — several inherited observed facts get immediately superseded
   by measured ones.

## 12. Open decisions

- **Goal modelling.** Is `goal.revenue` one fact with a window, or a first-class
  `OrgGoal` model with periods and progress history? A brain fact is cheaper; a model is
  right if goal tracking ever gets its own dashboard.
- **Review queue notification.** Nav badge only, or does an expiring goal warrant an email
  / WhatsApp nudge to the owner?
- **Per-entity memory.** The same machinery generalises to per-lead and per-customer
  memory ("this buyer always asks for GSM specs"). Out of scope here, but the key
  namespace should leave room for it — `lead:<id>/pref.packaging` — rather than being
  retrofitted later.
- **Semantic retrieval.** pgvector is not in this stack. Full-text ranking is adequate up
  to a few hundred facts; revisit if the observed tier grows past that.
