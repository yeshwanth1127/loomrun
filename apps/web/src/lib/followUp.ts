/** Local date/time helpers for callback scheduling (avoid UTC midnight bugs). */

export function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** Format a Date (or ISO string) as YYYY-MM-DD in local time. */
export function toLocalDateInput(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Format as HH:MM in local time. */
export function toLocalTimeInput(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Combine local date + time into an ISO UTC string. Default time 10:00 if blank. */
export function localDateTimeToIso(date: string, time?: string | null): string | null {
  const d = (date || '').trim()
  if (!d) return null
  const t = (time || '').trim() || '10:00'
  const [y, m, day] = d.split('-').map(Number)
  const [hh, mm] = t.split(':').map(Number)
  if (!y || !m || !day || Number.isNaN(hh) || Number.isNaN(mm)) return null
  return new Date(y, m - 1, day, hh, mm, 0, 0).toISOString()
}

export function inOneHourLocal(): { date: string; time: string } {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  return { date: toLocalDateInput(d), time: toLocalTimeInput(d) }
}

export function tomorrowAt10Local(): { date: string; time: string } {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0)
  return { date: toLocalDateInput(d), time: '10:00' }
}

export type FollowUpBucket = 'overdue' | 'due_now' | 'later_today' | 'upcoming' | 'unscheduled'

export function followUpBucket(dt: string | null | undefined): FollowUpBucket {
  if (!dt) return 'unscheduled'
  const due = new Date(dt)
  if (Number.isNaN(due.getTime())) return 'unscheduled'
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  if (startDue.getTime() < startToday.getTime()) return 'overdue'
  if (startDue.getTime() > startToday.getTime()) return 'upcoming'
  if (due.getTime() <= now.getTime()) return 'due_now'
  return 'later_today'
}

/** A follow-up is active only when the latest call outcome is Follow Up — same rule as Follow ups page. */
export function hasActiveFollowUp(lastCallOutcome: string | null | undefined): boolean {
  return lastCallOutcome === 'CALLBACK_SCHEDULED'
}

export function activeFollowUpAt(
  nextFollowUpAt: string | null | undefined,
  lastCallOutcome: string | null | undefined,
): string | null {
  if (!nextFollowUpAt || !hasActiveFollowUp(lastCallOutcome)) return null
  return nextFollowUpAt
}

export function isFollowUpOverdue(
  nextFollowUpAt: string | null | undefined,
  lastCallOutcome: string | null | undefined,
): boolean {
  const dt = activeFollowUpAt(nextFollowUpAt, lastCallOutcome)
  if (!dt) return false
  const bucket = followUpBucket(dt)
  return bucket === 'overdue' || bucket === 'due_now'
}

export function fmtDateTime(dt: string | null | undefined): string {
  if (!dt) return '—'
  const d = new Date(dt)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtFollowUpRelative(dt: string): string {
  const due = new Date(dt)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (Math.abs(diffMin) < 1) return 'Now'
  if (diffMin > 0 && diffMin < 60) return `in ${diffMin} min`
  if (diffMin < 0 && diffMin > -60) return `${Math.abs(diffMin)} min overdue`
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((startDue.getTime() - startToday.getTime()) / 86400000)
  if (diffDays === 0) {
    return due.getTime() <= now.getTime() ? 'Due now' : `Today ${toLocalTimeInput(due)}`
  }
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays < 0) return `${Math.abs(diffDays)} days overdue`
  return `in ${diffDays} days`
}
