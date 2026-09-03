/** Shared call-status options — Contacted board, lead drawer, and Telecaller. */
export const CALL_STATUS_OPTIONS = [
  { value: 'CONNECTED_INTERESTED',     label: 'Connected - Interested',          color: 'badge-green' },
  { value: 'CONNECTED_NOT_INTERESTED', label: 'Connected - Not Interested',      color: 'badge-red' },
  { value: 'CALLBACK_SCHEDULED',       label: 'Follow Up',                       color: 'badge-blue' },
  { value: 'RINGING_NO_RESPONSE',      label: 'Ringing - No Response',           color: 'badge-slate' },
  { value: 'BUSY',                     label: 'Busy',                            color: 'badge-amber' },
  { value: 'SWITCHED_OFF',             label: 'Switched Off / Not Reachable',    color: 'badge-slate' },
  { value: 'WRONG_NUMBER',             label: 'Wrong Number',                    color: 'badge-red' },
  { value: 'ORDER_CONFIRMED',          label: 'Order Confirmed',                 color: 'badge-indigo' },
] as const

export const LEGACY_CALL_STATUS = [
  { value: 'CONNECTED',      label: 'Connected',      color: 'badge-green' },
  { value: 'NO_ANSWER',      label: 'No Answer',      color: 'badge-slate' },
  { value: 'NOT_INTERESTED', label: 'Not Interested', color: 'badge-red' },
  { value: 'QUALIFIED',      label: 'Qualified',      color: 'badge-indigo' },
] as const

export const CALL_STATUS_MAP: Record<string, { value: string; label: string; color: string }> = Object.fromEntries(
  [...CALL_STATUS_OPTIONS, ...LEGACY_CALL_STATUS].map((o) => [o.value, o]),
)

export const CONNECTED_CALL_STATUSES = new Set([
  'CONNECTED',
  'CONNECTED_INTERESTED',
  'CONNECTED_NOT_INTERESTED',
  'ORDER_CONFIRMED',
  'QUALIFIED',
])
