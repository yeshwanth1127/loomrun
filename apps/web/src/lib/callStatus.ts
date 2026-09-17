/**
 * Canonical Call Status — single source of truth for Sales / Calls / Lead Detail.
 *
 * Values are persisted as TelecallerCallLog.outcome (CallOutcome). Some statuses
 * also move LeadStage / pipeline systemKey when semantically appropriate; others
 * are contact/activity only and must not destroy pipeline position.
 */

export type CallStatusKind =
  | 'contact'
  | 'follow_up'
  | 'meeting'
  | 'sample'
  | 'outcome'
  | 'closed'
  | 'activity'

export type CallStatusDef = {
  value: string
  label: string
  color: string
  group: string
  kind: CallStatusKind
  /** Pipeline systemKey to advance to, if any. null = do not change stage. */
  stageKey: string | null
  /** Counts as a connected conversation (WhatsApp catalog/quote allowed). */
  connected?: boolean
  /** Schedules a follow-up (requires next_call_at when date_set). */
  followUp?: boolean
  requiresFollowUpDate?: boolean
  /** Legacy codes still shown when reading old logs. */
  legacy?: boolean
}

export const CALL_STATUS_GROUPS = [
  'INITIAL CONTACT',
  'FOLLOW UP',
  'MEETING',
  'SAMPLE / PRODUCTION',
  'OUTCOME',
  'CLOSED / OTHERS',
] as const

/** Preferred picker order — matches the client Call Status list. */
export const CALL_STATUS_OPTIONS: CallStatusDef[] = [
  // INITIAL CONTACT
  {
    value: 'CONNECTED_INTERESTED',
    label: 'Connected - Interested',
    color: 'badge-green',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: 'CONTACTED',
    connected: true,
  },
  {
    value: 'CONNECTED_NOT_INTERESTED',
    label: 'Connected - Not Interested',
    color: 'badge-red',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: 'CONTACTED',
    connected: true,
  },
  {
    value: 'NO_ANSWER',
    label: 'No Answer',
    color: 'badge-slate',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: null,
  },
  {
    value: 'WRONG_NUMBER',
    label: 'Wrong Number',
    color: 'badge-red',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: null,
  },
  {
    value: 'NOT_REACHABLE',
    label: 'Not Reachable',
    color: 'badge-slate',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: null,
  },
  {
    value: 'BUSY',
    label: 'Busy',
    color: 'badge-amber',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: null,
  },
  {
    value: 'CALL_BACK_LATER',
    label: 'Call Back Later',
    color: 'badge-blue',
    group: 'INITIAL CONTACT',
    kind: 'follow_up',
    stageKey: null,
    followUp: true,
  },
  {
    value: 'WHATSAPP_SENT',
    label: 'WhatsApp Sent',
    color: 'badge-green',
    group: 'INITIAL CONTACT',
    kind: 'activity',
    stageKey: null,
  },
  {
    value: 'EMAIL_SENT',
    label: 'Email Sent',
    color: 'badge-blue',
    group: 'INITIAL CONTACT',
    kind: 'activity',
    stageKey: null,
  },

  // FOLLOW UP
  {
    value: 'FOLLOW_UP',
    label: 'Follow Up',
    color: 'badge-blue',
    group: 'FOLLOW UP',
    kind: 'follow_up',
    stageKey: null,
    followUp: true,
  },
  {
    value: 'FOLLOW_UP_DATE_SET',
    label: 'Follow Up (Date Set)',
    color: 'badge-blue',
    group: 'FOLLOW UP',
    kind: 'follow_up',
    stageKey: null,
    followUp: true,
    requiresFollowUpDate: true,
  },

  // MEETING
  {
    value: 'PHYSICAL_MEETING_REQUESTED',
    label: 'Physical Meeting Requested',
    color: 'badge-indigo',
    group: 'MEETING',
    kind: 'meeting',
    stageKey: 'QUALIFICATION',
  },
  {
    value: 'PHYSICAL_MEETING_PENDING',
    label: 'Physical Meeting Pending',
    color: 'badge-amber',
    group: 'MEETING',
    kind: 'meeting',
    stageKey: 'NEGOTIATION',
  },
  {
    value: 'PHYSICAL_MEETING_DONE',
    label: 'Physical Meeting Done',
    color: 'badge-green',
    group: 'MEETING',
    kind: 'meeting',
    stageKey: 'NEGOTIATION',
  },

  // SAMPLE / PRODUCTION
  {
    value: 'SAMPLE_REQUESTED',
    label: 'Sample Requested',
    color: 'badge-indigo',
    group: 'SAMPLE / PRODUCTION',
    kind: 'sample',
    stageKey: 'SAMPLE',
  },
  {
    value: 'SAMPLE_PRODUCTION_IN_PROGRESS',
    label: 'Sample Production In Progress',
    color: 'badge-amber',
    group: 'SAMPLE / PRODUCTION',
    kind: 'sample',
    stageKey: 'SAMPLE',
  },
  {
    value: 'SAMPLE_SENT',
    label: 'Sample Sent',
    color: 'badge-green',
    group: 'SAMPLE / PRODUCTION',
    kind: 'sample',
    stageKey: 'SAMPLE',
  },
  {
    value: 'FOLLOW_UP_AFTER_SAMPLE',
    label: 'Follow Up (After Sample)',
    color: 'badge-blue',
    group: 'SAMPLE / PRODUCTION',
    kind: 'follow_up',
    stageKey: 'SAMPLE',
    followUp: true,
    requiresFollowUpDate: true,
  },

  // OUTCOME
  {
    value: 'DEAL_WON_AFTER_SAMPLE',
    label: 'Deal Won (After Sample)',
    color: 'badge-green',
    group: 'OUTCOME',
    kind: 'outcome',
    stageKey: 'WON',
    connected: true,
  },
  {
    value: 'DEAL_WON',
    label: 'Deal Won',
    color: 'badge-green',
    group: 'OUTCOME',
    kind: 'outcome',
    stageKey: 'WON',
    connected: true,
  },
  {
    value: 'DEAL_REJECTED_AFTER_SAMPLE',
    label: 'Deal Rejected (After Sample)',
    color: 'badge-red',
    group: 'OUTCOME',
    kind: 'outcome',
    stageKey: 'LOST',
  },
  {
    value: 'DEAL_LOST',
    label: 'Deal Lost',
    color: 'badge-red',
    group: 'OUTCOME',
    kind: 'outcome',
    stageKey: 'LOST',
  },

  // CLOSED / OTHERS
  {
    value: 'CLOSED_NOT_NOW',
    label: 'Closed (Not Now)',
    color: 'badge-slate',
    group: 'CLOSED / OTHERS',
    kind: 'closed',
    stageKey: null,
  },
  {
    value: 'DO_NOT_CONTACT',
    label: 'Do Not Contact',
    color: 'badge-red',
    group: 'CLOSED / OTHERS',
    kind: 'closed',
    stageKey: 'LOST',
  },
]

/** Old codes still valid when reading history / webhooks. */
export const LEGACY_CALL_STATUS: CallStatusDef[] = [
  {
    value: 'CONNECTED',
    label: 'Connected',
    color: 'badge-green',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: 'CONTACTED',
    connected: true,
    legacy: true,
  },
  {
    value: 'RINGING_NO_RESPONSE',
    label: 'Ringing - No Response',
    color: 'badge-slate',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: null,
    legacy: true,
  },
  {
    value: 'SWITCHED_OFF',
    label: 'Switched Off / Not Reachable',
    color: 'badge-slate',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: null,
    legacy: true,
  },
  {
    value: 'NOT_INTERESTED',
    label: 'Not Interested',
    color: 'badge-red',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: 'CONTACTED',
    legacy: true,
  },
  {
    value: 'CALLBACK_SCHEDULED',
    label: 'Follow Up',
    color: 'badge-blue',
    group: 'FOLLOW UP',
    kind: 'follow_up',
    stageKey: null,
    followUp: true,
    requiresFollowUpDate: true,
    legacy: true,
  },
  {
    value: 'QUALIFIED',
    label: 'Qualified',
    color: 'badge-indigo',
    group: 'INITIAL CONTACT',
    kind: 'contact',
    stageKey: 'QUALIFICATION',
    connected: true,
    legacy: true,
  },
  {
    value: 'ORDER_CONFIRMED',
    label: 'Order Confirmed',
    color: 'badge-indigo',
    group: 'OUTCOME',
    kind: 'outcome',
    stageKey: 'WON',
    connected: true,
    legacy: true,
  },
]

export const ALL_CALL_STATUSES: CallStatusDef[] = [...CALL_STATUS_OPTIONS, ...LEGACY_CALL_STATUS]

export const CALL_STATUS_MAP: Record<string, CallStatusDef> = Object.fromEntries(
  ALL_CALL_STATUSES.map((o) => [o.value, o]),
)

export const CONNECTED_CALL_STATUSES = new Set(
  ALL_CALL_STATUSES.filter((o) => o.connected).map((o) => o.value),
)

export const FOLLOW_UP_CALL_STATUSES = new Set(
  ALL_CALL_STATUSES.filter((o) => o.followUp).map((o) => o.value),
)

/** Statuses that should appear in the follow-ups queue. */
export const FOLLOW_UP_QUEUE_OUTCOMES = [
  'FOLLOW_UP',
  'FOLLOW_UP_DATE_SET',
  'FOLLOW_UP_AFTER_SAMPLE',
  'CALL_BACK_LATER',
  'CALLBACK_SCHEDULED',
] as const

export function callStatusLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return CALL_STATUS_MAP[value]?.label ?? value.replace(/_/g, ' ')
}

export function callStatusColor(value: string | null | undefined): string {
  if (!value) return 'badge-slate'
  return CALL_STATUS_MAP[value]?.color ?? 'badge-slate'
}

export function callStatusRequiresDate(value: string): boolean {
  return !!CALL_STATUS_MAP[value]?.requiresFollowUpDate
}

export function callStatusIsFollowUp(value: string): boolean {
  return FOLLOW_UP_CALL_STATUSES.has(value)
}

export function callStatusesByGroup(): Array<{ group: string; options: CallStatusDef[] }> {
  return CALL_STATUS_GROUPS.map((group) => ({
    group,
    options: CALL_STATUS_OPTIONS.filter((o) => o.group === group),
  })).filter((g) => g.options.length > 0)
}
