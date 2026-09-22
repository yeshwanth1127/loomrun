export type AiChatMode = false | 'minimal' | 'advanced'

export type AiUsageWindow = {
  used: number
  limit: number | null
  remaining?: number | null
  resetsAt?: string | null
  periodStart?: string | null
}

export type AiUsageWindows = {
  session5h: AiUsageWindow
  weekly: AiUsageWindow
}

export type Entitlements = {
  plan: string
  max_users: number
  extra_user_price_inr: number
  ai_chat: AiChatMode
  ai_multilingual: boolean
  google_ads: boolean
  meta_lead_ads: boolean
  outbound_telephony_providers: boolean
  ai_voice_agents: boolean
  gmail_calendar: boolean
  event_automations: boolean
  messages_per_day: number | null
  ai_credits_per_5h: number | null
  ai_credits_per_week: number | null
  max_leads: number | null
}

export type TrialInfo = {
  is_trial: boolean
  trial_active: boolean
  trial_expired: boolean
  trial_ends_at: string | null
  trial_days: number
  days_left: number | null
}

export type PlanCatalogItem = {
  key: string
  name: string
  price_inr: number
  price_label: string
  included_users: number
  extra_user_price_inr: number
  highlight: boolean
  features: string[]
}

export type SubscriptionInfo = {
  plan: string
  plan_label: string
  status: string
  entitlements: Entitlements
  ai_mode: string
  trial: TrialInfo
  usage: {
    day: string
    whatsapp_outbound: { used: number; limit: number | null }
    ai: AiUsageWindows
  }
  seats: {
    used: number
    included: number
    extra: number
    limit: number
    extra_user_price_inr: number
  }
  leads: {
    used: number
    limit: number | null
  }
  catalog: PlanCatalogItem[]
  upgrade: {
    contact_email: string
    mailto: string
  }
  subscription: {
    id: string
    plan_key: string
    status: string
    current_period_end: string | null
    seat_count: number | null
  } | null
}

export type AiStatus = {
  available: boolean
  mode: string
  plan: string
  multilingual: boolean
  upgrade_required: boolean
  trial?: TrialInfo
  usage?: AiUsageWindows
  models?: {
    default: string
    items: { id: string; label: string; provider?: string }[]
  }
  memory?: {
    summary: string
    facts: Record<string, string>
    updated_at?: string | null
  }
  agent?: {
    tools_enabled: boolean
    writes_enabled: boolean
    memory_enabled?: boolean
  }
  qlix?: QlixState
}

export type QlixState = {
  connected: boolean
  status: 'disconnected' | 'provisioning' | 'connected' | 'error' | string
  /** Live probe: false when the stored Qlix key is rejected (401). */
  key_valid?: boolean
  // False when the server has no Qlix partner key — the org cannot activate
  // and shouldn't be shown a button that will fail.
  configured?: boolean
  agent_id?: string | null
  collection_id?: string | null
  backfill_done?: boolean
  backfill?: { queued?: number; started_at?: string } | null
  last_synced_at?: string | null
  last_error?: string | null
  sync?: {
    pending: number
    failed: number
    last_synced_at?: string | null
    backfill_done?: boolean
  }
}

/** True while the first CRM import is still running — chat must wait. */
export function qlixCrmSyncing(qlix?: QlixState): boolean {
  if (!qlix?.connected) return false
  return !(qlix.sync?.backfill_done ?? qlix.backfill_done)
}

export type QlixDocument = {
  id: string
  title: string
  file_name: string
  mime_type: string
  size_bytes: number
  status: 'uploading' | 'pending' | 'ready' | 'failed' | string
  last_error?: string | null
  created_at?: string | null
}

export function planBadgeClass(plan: string): string {
  const key = (plan || 'free').toLowerCase()
  if (key === 'scale') return 'badge-indigo'
  if (key === 'growth') return 'badge-blue'
  return 'badge-slate'
}

export function aiModeLabel(mode: string): string {
  if (mode === 'advanced') return 'Advanced AI'
  if (mode === 'minimal') return 'Basic AI'
  return 'AI unavailable'
}

export function isTrialExpiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return msg.includes('TRIAL_EXPIRED')
}

/** Compact “resets in …” label for AI credit windows. */
export function formatResetsIn(resetsAt?: string | null, now = Date.now()): string {
  if (!resetsAt) return ''
  const ms = new Date(resetsAt).getTime() - now
  if (Number.isNaN(ms) || ms <= 0) return 'soon'
  const mins = Math.ceil(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 48) return rem ? `${hours}h ${rem}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

/** Used % of a credit/message pool (0–100). */
export function usagePercent(used: number, limit: number | null | undefined): number {
  if (limit == null || limit <= 0) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}
