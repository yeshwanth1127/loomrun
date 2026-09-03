import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type MetricTone = 'purple' | 'green' | 'amber' | 'red' | 'blue' | 'slate'

export function MetricCard({
  icon: Icon,
  tone = 'purple',
  label,
  value,
  hint,
}: {
  icon?: LucideIcon
  tone?: MetricTone
  label: string
  value: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className={`metric-card metric-card--${tone}`}>
      {Icon ? (
        <div className={`metric-card-icon tone-${tone}`}>
          <Icon size={16} />
        </div>
      ) : null}
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value">{value}</div>
      {hint != null && hint !== '' ? <div className="metric-card-hint">{hint}</div> : null}
    </div>
  )
}

export type DonutSegment = { label: string; value: number; color: string }

export function DonutChart({
  segments,
  center,
  size = 148,
  thickness = 16,
}: {
  segments: DonutSegment[]
  center?: { value: ReactNode; label?: string }
  size?: number
  thickness?: number
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  const radius = (size - thickness) / 2
  const circ = 2 * Math.PI * radius
  let offset = 0
  const visible = total > 0 ? segments.filter((s) => s.value > 0) : []

  return (
    <div className="donut-chart">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={thickness}
        />
        {visible.map((seg) => {
          const len = (seg.value / total) * circ
          const dash = `${len} ${circ - len}`
          const el = (
            <circle
              key={seg.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )
          offset += len
          return el
        })}
      </svg>
      {center ? (
        <div className="donut-center">
          <div className="donut-center-value">{center.value}</div>
          {center.label ? <div className="donut-center-label">{center.label}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

export function DonutLegend({ segments, total }: { segments: DonutSegment[]; total?: number }) {
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0)
  return (
    <ul className="donut-legend">
      {segments.map((seg) => (
        <li key={seg.label}>
          <span className="donut-swatch" style={{ background: seg.color }} />
          <span className="donut-legend-label">{seg.label}</span>
          <span className="donut-legend-value">
            {typeof seg.value === 'number' && seg.value > 1000
              ? seg.value.toLocaleString('en-IN')
              : seg.value}
            {sum > 0 ? ` · ${((seg.value / sum) * 100).toFixed(0)}%` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function BarList({
  items,
  formatValue,
}: {
  items: { label: string; value: number; color?: string }[]
  formatValue?: (value: number) => string
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="bar-list">
      {items.length === 0 ? (
        <li className="muted small">No data yet.</li>
      ) : (
        items.map((item) => (
          <li key={item.label}>
            <div className="bar-list-row">
              <span>{item.label}</span>
              <span>
                {formatValue ? formatValue(item.value) : item.value.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="bar-list-track">
              <div
                className="bar-list-fill"
                style={{
                  width: `${(item.value / max) * 100}%`,
                  background: item.color ?? 'var(--primary)',
                }}
              />
            </div>
          </li>
        ))
      )}
    </ul>
  )
}

export function FunnelChart({
  steps,
}: {
  steps: { label: string; value: number; color: string }[]
}) {
  const max = Math.max(1, ...steps.map((s) => s.value))
  return (
    <div className="funnel-chart">
      {steps.map((step) => (
        <div key={step.label} className="funnel-row">
          <div
            className="funnel-bar"
            style={{
              width: `${Math.max(18, (step.value / max) * 100)}%`,
              background: step.color,
            }}
          >
            <span>{step.label}</span>
            <strong>{step.value.toLocaleString('en-IN')}</strong>
          </div>
        </div>
      ))}
    </div>
  )
}

export function InsightGrid({ children }: { children: ReactNode }) {
  return <div className="insight-grid">{children}</div>
}

export function InsightCard({
  title,
  action,
  children,
}: {
  title: string
  action?: { label: string; to?: string; onClick?: () => void }
  children: ReactNode
}) {
  return (
    <section className="insight-card">
      <div className="insight-card-head">
        <h3>{title}</h3>
        {action?.to ? (
          <Link to={action.to} className="insight-card-action">
            {action.label}
          </Link>
        ) : action?.onClick ? (
          <button type="button" className="insight-card-action" onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}
      </div>
      <div className="insight-card-body">{children}</div>
    </section>
  )
}

export function Sparkline({
  points,
  color = 'var(--primary)',
}: {
  points: number[]
  color?: string
}) {
  if (points.length === 0) return <p className="muted small">No trend yet.</p>
  const w = 320
  const h = 88
  const max = Math.max(1, ...points)
  const min = Math.min(0, ...points)
  const span = Math.max(1, max - min)
  const d = points
    .map((v, i) => {
      const x = points.length === 1 ? w / 2 : (i / (points.length - 1)) * w
      const y = h - ((v - min) / span) * (h - 8) - 4
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
