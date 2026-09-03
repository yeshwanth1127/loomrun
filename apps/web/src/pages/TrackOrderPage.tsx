import { useQuery } from '@tanstack/react-query'
import { Check, Circle, Package } from 'lucide-react'
import { useParams } from 'react-router-dom'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type Milestone = { key: string; label: string; state: 'done' | 'current' | 'upcoming' }
type TrackPayload = {
  order_number: string
  customer_name: string | null
  current_milestone: string
  current_milestone_label: string
  order_status: string
  milestones: Milestone[]
  expected_dispatch_at: string | null
  days_until_dispatch: number | null
  actual_dispatch_at: string | null
  courier_name: string | null
  courier_tracking_no: string | null
  last_updated_at: string | null
  updates: Array<{ body: string; created_at: string | null }>
  brand: { name: string; has_logo: boolean; logo_url: string | null }
}

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function etaText(days: number | null) {
  if (days == null) return null
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (days === 0) return 'Expected today'
  return `About ${days} day${days === 1 ? '' : 's'} remaining`
}

export function TrackOrderPage() {
  const { token } = useParams<{ token: string }>()

  const q = useQuery({
    queryKey: ['public-track', token],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`${apiBase}/v1/track/${token}`, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        const text = await res.text()
        let detail = 'Tracking link not found'
        try {
          detail = (JSON.parse(text) as { detail?: string }).detail ?? detail
        } catch {
          /* ignore */
        }
        throw new Error(detail)
      }
      return (await res.json()) as TrackPayload
    },
    retry: false,
  })

  if (q.isLoading) {
    return (
      <div className="track-page">
        <p className="muted">Loading order…</p>
      </div>
    )
  }

  if (q.error || !q.data) {
    return (
      <div className="track-page">
        <div className="track-card">
          <Package size={28} style={{ opacity: 0.5 }} />
          <h1>Link unavailable</h1>
          <p className="muted">
            {(q.error as Error)?.message || 'This tracking link is invalid or has been disabled.'}
          </p>
        </div>
      </div>
    )
  }

  const d = q.data
  const logoSrc = d.brand.logo_url ? `${apiBase}${d.brand.logo_url}` : null

  return (
    <div className="track-page">
      <div className="track-card">
        <div className="track-brand">
          {logoSrc ? (
            <img src={logoSrc} alt={d.brand.name} className="track-logo" />
          ) : (
            <div className="track-brand-name">{d.brand.name || 'Loomrun'}</div>
          )}
        </div>

        <div className="muted small" style={{ marginBottom: '0.25rem' }}>
          Order tracking
        </div>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.35rem' }}>{d.order_number}</h1>
        {d.customer_name && (
          <p className="muted" style={{ margin: '0 0 1.25rem' }}>
            {d.customer_name}
          </p>
        )}

        <div className="track-current">
          <div className="muted small">Current status</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.02em' }}>
            {d.current_milestone_label.toUpperCase()}
          </div>
        </div>

        <ol className="track-milestones">
          {d.milestones.map((m) => (
            <li key={m.key} className={`track-milestone track-milestone-${m.state}`}>
              <span className="track-milestone-icon">
                {m.state === 'done' ? (
                  <Check size={14} />
                ) : m.state === 'current' ? (
                  <Circle size={14} fill="currentColor" />
                ) : (
                  <Circle size={14} />
                )}
              </span>
              <span>{m.label}</span>
            </li>
          ))}
        </ol>

        <div className="track-meta">
          <div>
            <div className="muted small">Estimated dispatch</div>
            <div style={{ fontWeight: 600 }}>{fmtDate(d.expected_dispatch_at)}</div>
            {etaText(d.days_until_dispatch) && (
              <div className="muted small">{etaText(d.days_until_dispatch)}</div>
            )}
          </div>
          {d.courier_name && (
            <div>
              <div className="muted small">Courier</div>
              <div style={{ fontWeight: 600 }}>{d.courier_name}</div>
              {d.courier_tracking_no && (
                <div className="muted small">{d.courier_tracking_no}</div>
              )}
            </div>
          )}
          <div>
            <div className="muted small">Last updated</div>
            <div style={{ fontWeight: 600 }}>{fmtDate(d.last_updated_at)}</div>
          </div>
        </div>

        {d.updates.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <div className="muted small" style={{ marginBottom: '0.5rem' }}>
              Updates
            </div>
            <ul className="track-updates">
              {d.updates.map((u, i) => (
                <li key={`${u.created_at}-${i}`}>
                  <div>{u.body}</div>
                  <time className="muted small">{fmtDate(u.created_at)}</time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="track-footer muted small">Powered by Loomrun</p>
    </div>
  )
}
