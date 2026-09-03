export function fmtINR(centsOrRupees: number | null | undefined, { cents = false }: { cents?: boolean } = {}) {
  if (centsOrRupees == null || Number.isNaN(Number(centsOrRupees))) return '—'
  const rupees = cents ? Number(centsOrRupees) / 100 : Number(centsOrRupees)
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: rupees % 1 === 0 ? 0 : 2 })}`
}

export function fmtPct(part: number, total: number, digits = 1) {
  if (!total) return '0%'
  return `${((part / total) * 100).toFixed(digits)}%`
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 14) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}
