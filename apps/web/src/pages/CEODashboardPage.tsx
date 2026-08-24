import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart2,
  Clock,
  FileText,
  IndianRupee,
  Link2,
  Mail,
  MessageCircle,
  Phone,
  Receipt,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'

type Activity = {
  id: string
  type: string
  body: string
  lead_id: string
  lead_title: string | null
  user_name: string | null
  metadata: { from_stage?: string; to_stage?: string } | null
  created_at: string
}

type ClientPnl = {
  lead_id: string
  lead_title: string | null
  company: string | null
  production_order_id: string
  name?: string | null
  display_name?: string | null
  stage: string
  delay_flag: boolean
  revenue_cents: number | null
  budget_cents: number | null
  actual_cost_cents: number
  collected_cents: number
  margin_cents: number | null
  budget_variance_cents: number | null
  collection_gap_cents: number | null
  over_budget: boolean
  revenue_source: string | null
}

type PnlOverview = {
  revenue_cents: number
  jobs_with_revenue: number
  job_cost_cents: number
  overhead_cents: number
  expense_cents: number
  collected_cents: number
  budget_cents: number
  jobs_with_budget: number
  margin_cents: number
  collection_gap_cents: number | null
  client_count: number
  over_budget_count: number
}

type CountValue = { count: number; value_cents: number }

type CEO = {
  generated_at: string
  hot_leads: { count: number; threshold_value: number }
  total_leads: { count: number }
  follow_ups: { count: number }
  deals_won: CountValue
  deals_lost: CountValue
  win_rate: { percent: number | null; closed_count: number }
  quotations_sent: { count: number }
  invoices_created: { count: number }
  invoices_sent: { count: number }
  pending_quotations: { count: number }
  delayed_followups: { count: number; overdue_days: number }
  production_bottlenecks: { by_stage: Record<string, number>; busiest_stage: string | null }
  collections_pending: { count: number }
  telecaller_today: { calls: number }
  stage_changes_today: { count: number }
  job_cost_total: { amount_cents: number }
  overhead_total: { amount_cents: number }
  expense_total: { amount_cents: number }
  budget_overrun_count: { count: number }
  margin_aggregate: { amount_cents: number; jobs_with_revenue: number }
  pnl_overview?: PnlOverview
  client_pnl?: ClientPnl[]
  integrations: Integration[]
  recent_activity: Activity[]
}

type Integration = {
  key: string
  label: string
  status: string
  detail: string | null
  link: string
}

const INTEGRATION_ICONS: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  telephony: Phone,
  gmail: Mail,
  meta_ads: Link2,
  lead_sources: Link2,
}

const STAGE_LABELS: Record<string, string> = {
  FABRIC_CHECK:    'Fabric Check',
  PROCUREMENT:     'Procurement',
  FABRIC_RECEIVED: 'Fabric Received',
  CUTTING:         'Cutting',
  PRINTING:        'Printing',
  STITCHING:       'Stitching',
  QC:              'Quality Check',
  PACKING:         'Packing',
  PAYMENT_HOLD:    'Payment Hold',
  READY_DISPATCH:  'Ready to Dispatch',
  SHIPPED:         'Shipped',
  DELIVERED:       'Delivered',
}

const STAGE_COLORS: Record<string, string> = {
  FABRIC_CHECK:    'var(--primary)',
  PROCUREMENT:     '#f59e0b',
  FABRIC_RECEIVED: '#34d399',
  CUTTING:         'var(--primary)',
  PRINTING:        '#64748b',
  STITCHING:       '#ec4899',
  QC:              '#f97316',
  PACKING:         'var(--primary)',
  PAYMENT_HOLD:    '#ef4444',
  READY_DISPATCH:  '#10b981',
  SHIPPED:         '#3b82f6',
  DELIVERED:       '#059669',
}

function fmt(s: string | null) {
  if (!s) return '—'
  return STAGE_LABELS[s] ?? s
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const ACTIVITY_META: Record<string, { label: string; color: string }> = {
  STAGE_CHANGED:   { label: 'Stage Moved',     color: 'var(--primary)' },
  ORDER_CREATED:   { label: 'Order Started',   color: '#10b981' },
  DELAY_TOGGLED:   { label: 'Delay',           color: '#ef4444' },
  PAYMENT_RECORDED:{ label: 'Payment',         color: '#f59e0b' },
  EXPENSE_RECORDED:{ label: 'Expense',         color: '#0ea5e9' },
  BUDGET_SET:      { label: 'Budget',          color: '#64748b' },
  NAME_CHANGED:    { label: 'Renamed',         color: '#64748b' },
}

function fmtINR(cents: number | null | undefined) {
  if (cents == null) return '—'
  return `₹${(cents / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function Stat({
  label,
  value,
  hint,
  tone,
  to,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'ok' | 'warn' | 'bad'
  to?: string
}) {
  const color =
    tone === 'ok' ? 'var(--success)'
    : tone === 'warn' ? 'var(--warning)'
    : tone === 'bad' ? 'var(--destructive)'
    : undefined
  const inner = (
    <>
      <div className="ceo-stat-label">{label}</div>
      <div className="ceo-stat-value" style={color ? { color } : undefined}>{value}</div>
      {hint && <div className="ceo-stat-hint">{hint}</div>}
    </>
  )
  if (to) return <Link to={to} className="ceo-stat">{inner}</Link>
  return <div className="ceo-stat">{inner}</div>
}

function ClientPnlSection({ rows }: { rows: ClientPnl[] }) {
  const [query, setQuery] = useState('')
  const [onlyOverBudget, setOnlyOverBudget] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (onlyOverBudget && !r.over_budget) return false
      if (!q) return true
      const hay = `${r.display_name ?? ''} ${r.lead_title ?? ''} ${r.company ?? ''} ${r.stage}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query, onlyOverBudget])

  return (
    <section className="ceo-section" aria-labelledby="client-pnl-heading">
      <div className="ceo-section-head">
        <Users size={16} />
        <h2 id="client-pnl-heading" className="ceo-section-title">
          Client-wise P&amp;L
        </h2>
        <span className="muted small">{filtered.length} of {rows.length}</span>
        <div className="row" style={{ marginLeft: 'auto', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            className="input"
            type="search"
            placeholder="Search client…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search clients by name or company"
            style={{ minWidth: 180 }}
          />
          <label className="row small" style={{ gap: '0.35rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyOverBudget}
              onChange={(e) => setOnlyOverBudget(e.target.checked)}
            />
            Over budget only
          </label>
          <Link to="/app/expenses" className="btn btn-ghost btn-sm">Expenses</Link>
          <Link to="/app/production" className="btn btn-ghost btn-sm">Production</Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state ceo-empty">
          <p>No production clients yet. Start an order to see client P&amp;L.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state ceo-empty">
          <p>No clients match this filter.</p>
        </div>
      ) : (
        <div className="table-wrap ceo-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Stage</th>
                <th scope="col">Revenue</th>
                <th scope="col">Spend</th>
                <th scope="col">Budget</th>
                <th scope="col">Margin</th>
                <th scope="col">Collected</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.production_order_id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      <Link to="/app/production" style={{ color: 'inherit', textDecoration: 'none' }}>
                        {r.display_name ?? r.lead_title ?? 'Unnamed client'}
                      </Link>
                    </div>
                    {(r.company || (r.name && r.lead_title && r.name !== r.lead_title)) && (
                      <div className="muted small">
                        {[r.company, r.name && r.lead_title && r.name !== r.lead_title ? `Lead: ${r.lead_title}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="muted small">{STAGE_LABELS[r.stage] ?? r.stage}</span>
                  </td>
                  <td>{fmtINR(r.revenue_cents)}</td>
                  <td style={{ fontWeight: 600 }}>{fmtINR(r.actual_cost_cents)}</td>
                  <td>{fmtINR(r.budget_cents)}</td>
                  <td style={{ fontWeight: 700, color: (r.margin_cents ?? 0) < 0 ? 'var(--destructive)' : undefined }}>
                    {fmtINR(r.margin_cents)}
                  </td>
                  <td>{fmtINR(r.collected_cents)}</td>
                  <td>
                    <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                      {r.over_budget && <span className="badge badge-red">Over budget</span>}
                      {r.delay_flag && <span className="badge badge-amber">Delayed</span>}
                      {!r.over_budget && !r.delay_flag && <span className="badge badge-green">On track</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function CEODashboardPage() {
  const { orgId } = useAuth()
  const { dayParam, appendDay, isAll, isToday } = useDateFilter()
  const q = useQuery({
    queryKey: ['ceo', orgId, dayParam],
    enabled: !!orgId,
    refetchInterval: isAll || isToday ? 60_000 : false,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      return apiFetch<CEO>(`/v1/orgs/${orgId}/dashboard/ceo?${params}`)
    },
  })

  useEffect(() => {
    if (q.error) {
      toast.error((q.error as Error).message)
    }
  }, [q.error])

  if (!orgId) return (
    <>
      <div className="page-header"><h1>CEO Dashboard</h1><p>Select an organization to view analytics.</p></div>
    </>
  )

  const d = q.data
  const generatedAt = d ? new Date(d.generated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null

  const byStage = d?.production_bottlenecks.by_stage ?? {}
  const stageEntries = Object.entries(byStage).sort(([, a], [, b]) => b - a)
  const totalOrders = stageEntries.reduce((sum, [, count]) => sum + count, 0)

  const hasAlerts =
    d && (
      d.delayed_followups.count > 0
      || d.collections_pending.count > 0
      || d.pending_quotations.count > 0
      || (d.budget_overrun_count?.count ?? 0) > 0
    )

  const won = d?.deals_won
  const lost = d?.deals_lost
  const winRate = d?.win_rate
  const periodHint = isAll ? 'in the pipeline' : 'created this day'

  return (
    <>
      <div className="page-header">
        <h1>CEO Dashboard</h1>
        <p>
          {isAll ? 'Real-time business overview' : `Metrics for ${dayParam}`}
          {generatedAt && <span className="muted"> · Updated {generatedAt}</span>}
        </p>
      </div>

      <div className="page-body ceo-dash stack">
        {q.isLoading && (
          <div className="ceo-skel" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => <div key={i} />)}
          </div>
        )}

        {d && (
          <>
            {hasAlerts && (
              <div className="ceo-alert">
                <AlertTriangle size={18} style={{ color: 'var(--destructive)', marginTop: '0.1rem', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--foreground)', marginBottom: '0.25rem' }}>
                    Action Required
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--muted-fg)' }}>
                    {d.delayed_followups.count > 0 && `${d.delayed_followups.count} overdue follow-ups • `}
                    {d.collections_pending.count > 0 && `${d.collections_pending.count} pending payments • `}
                    {d.pending_quotations.count > 0 && `${d.pending_quotations.count} awaiting quotations`}
                    {(d.budget_overrun_count?.count ?? 0) > 0 && `${d.pending_quotations.count > 0 || d.collections_pending.count > 0 || d.delayed_followups.count > 0 ? ' • ' : ''}${d.budget_overrun_count.count} jobs over budget`}
                  </div>
                </div>
              </div>
            )}

            <div className="ceo-band">
              <Stat
                label="Deals Won"
                value={won?.count ?? 0}
                hint={`${fmtINR(won?.value_cents ?? 0)} estimated value`}
                tone={(won?.count ?? 0) > 0 ? 'ok' : undefined}
                to="/app/leads"
              />
              <Stat
                label="Deals Lost"
                value={lost?.count ?? 0}
                hint={`${fmtINR(lost?.value_cents ?? 0)} estimated value`}
                tone={(lost?.count ?? 0) > 0 ? 'bad' : undefined}
                to="/app/leads"
              />
              <Stat
                label="Win Rate"
                value={winRate?.percent == null ? '—' : `${winRate.percent}%`}
                hint={
                  (winRate?.closed_count ?? 0) === 0
                    ? 'No closed deals yet'
                    : `${winRate?.closed_count} closed (won + lost)`
                }
                tone={
                  winRate?.percent == null ? undefined
                  : winRate.percent >= 50 ? 'ok'
                  : 'warn'
                }
              />
              <Stat
                label="Total Leads"
                value={d.total_leads.count}
                hint={isAll ? 'All leads in pipeline' : 'Leads created this day'}
                to="/app/leads"
              />
              <Stat
                label="Follow-ups"
                value={d.follow_ups.count}
                hint={`Leads with a follow-up scheduled ${periodHint}`}
                to="/app/leads/follow-ups"
              />
            </div>

            <div className="ceo-band">
              <Stat
                label="Quotations Sent"
                value={d.quotations_sent.count}
                hint="Quotations delivered to customers"
                to="/app/quotations"
              />
              <Stat
                label="Pending Quotations"
                value={d.pending_quotations.count}
                hint="Awaiting customer response"
                tone={d.pending_quotations.count > 0 ? 'warn' : undefined}
                to="/app/quotations"
              />
              <Stat
                label="Invoices Created"
                value={d.invoices_created.count}
                hint="Quotations converted to invoices"
                to="/app/invoices"
              />
              <Stat
                label="Invoices Sent"
                value={d.invoices_sent.count}
                hint="Invoices delivered to customers"
                to="/app/invoices"
              />
              <Stat
                label="Telecaller Today"
                value={d.telecaller_today.calls}
                hint={isAll ? 'Calls logged today' : 'Calls logged this day'}
                to="/app/telecaller"
              />
            </div>

            <div className="ceo-band">
              <Stat
                label="Total Expenses"
                value={fmtINR(d.expense_total?.amount_cents ?? 0)}
                hint="Job + overhead spend"
                to="/app/expenses"
              />
              <Stat
                label="Overhead"
                value={fmtINR(d.overhead_total?.amount_cents ?? 0)}
                hint="Rent, utilities, non-job costs"
                to="/app/expenses"
              />
              <Stat
                label="Over Budget"
                value={d.budget_overrun_count?.count ?? 0}
                hint="Jobs exceeding cost budget"
                tone={(d.budget_overrun_count?.count ?? 0) > 0 ? 'bad' : 'ok'}
                to="/app/production"
              />
              <Stat
                label="Aggregate Margin"
                value={fmtINR(d.margin_aggregate?.amount_cents ?? 0)}
                hint={`Across ${d.margin_aggregate?.jobs_with_revenue ?? 0} jobs with revenue`}
                tone={(d.margin_aggregate?.amount_cents ?? 0) < 0 ? 'bad' : 'ok'}
                to="/app/production"
              />
            </div>

            {(() => {
              const ov = d.pnl_overview
              if (!ov) return null
              return (
                <section className="ceo-section" aria-labelledby="pnl-overview-heading">
                  <div className="ceo-section-head">
                    <IndianRupee size={16} />
                    <h2 id="pnl-overview-heading" className="ceo-section-title">
                      Overall P&amp;L
                    </h2>
                    <span className="muted small" style={{ marginLeft: 'auto' }}>
                      {ov.client_count} client{ov.client_count !== 1 ? 's' : ''} in production
                    </span>
                  </div>
                  <div className="ceo-band" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
                    <Stat label="Revenue" value={fmtINR(ov.revenue_cents)} />
                    <Stat label="Job costs" value={fmtINR(ov.job_cost_cents)} />
                    <Stat label="Overhead" value={fmtINR(ov.overhead_cents)} />
                    <Stat
                      label="Margin"
                      value={fmtINR(ov.margin_cents)}
                      tone={ov.margin_cents < 0 ? 'bad' : 'ok'}
                    />
                    <Stat label="Collected" value={fmtINR(ov.collected_cents)} />
                    <Stat label="Collection gap" value={fmtINR(ov.collection_gap_cents)} />
                  </div>
                </section>
              )
            })()}

            <ClientPnlSection rows={d.client_pnl ?? []} />

            <div className="ceo-band">
              <Stat
                label="Follow-up Status"
                value={d.delayed_followups.count}
                hint={d.delayed_followups.count > 0 ? `Overdue > ${d.delayed_followups.overdue_days} days` : 'All follow-ups on track'}
                tone={d.delayed_followups.count > 0 ? 'bad' : 'ok'}
                to="/app/leads/follow-ups"
              />
              <Stat
                label="Collections"
                value={d.collections_pending.count}
                hint={d.collections_pending.count > 0 ? 'Unpaid after dispatch' : 'All payments collected'}
                tone={d.collections_pending.count > 0 ? 'warn' : 'ok'}
                to="/app/production"
              />
            </div>

            {stageEntries.length > 0 && (
              <section className="ceo-section">
                <div className="ceo-section-head">
                  <BarChart2 size={16} />
                  <div className="ceo-section-title">Production Pipeline</div>
                  <div className="muted small" style={{ marginLeft: 'auto' }}>
                    {totalOrders} total orders
                  </div>
                </div>

                <div className="ceo-pipeline">
                  {stageEntries.map(([stage, count], idx) => {
                    const color = STAGE_COLORS[stage] || '#a8a29e'
                    const percentage = (count / totalOrders) * 100
                    const isBottleneck = stage === d.production_bottlenecks.busiest_stage

                    return (
                      <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          width: '20px',
                          color,
                          flexShrink: 0,
                        }}>
                          {idx + 1}
                        </div>

                        <div style={{ width: '140px', flexShrink: 0, borderLeft: `2px solid ${color}`, paddingLeft: '0.65rem' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)' }}>
                            {fmt(stage)}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--muted-fg)' }}>
                            {count} order{count !== 1 ? 's' : ''}
                          </div>
                        </div>

                        <div style={{ flex: 1, height: '2px', background: 'var(--border)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              background: color,
                              width: `${percentage}%`,
                              transition: 'width 0.4s ease',
                            }}
                          />
                        </div>

                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground)', minWidth: '40px', textAlign: 'right' }}>
                          {percentage.toFixed(0)}%
                        </div>

                        {isBottleneck && (
                          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--destructive)', whiteSpace: 'nowrap' }}>
                            BOTTLENECK
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            <section className="ceo-section">
              <div className="ceo-section-head">
                <Zap size={16} />
                <div className="ceo-section-title">Recent Stage Movements</div>
                <div className="muted small" style={{ marginLeft: 'auto' }}>
                  {d.stage_changes_today.count} stage change{d.stage_changes_today.count !== 1 ? 's' : ''} {isAll ? 'today' : 'this day'}
                </div>
              </div>

              {d.recent_activity.length === 0 ? (
                <div className="ceo-empty muted" style={{ fontSize: '0.85rem' }}>
                  No production activity yet. Move an order through stages on the Production page to see it here.
                </div>
              ) : (
                <div className="ceo-activity">
                  {d.recent_activity.map((a) => {
                    const meta = ACTIVITY_META[a.type] ?? { label: a.type, color: '#a8a29e' }
                    const from = a.metadata?.from_stage
                    const to = a.metadata?.to_stage
                    return (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', borderLeft: `2px solid ${meta.color}`, paddingLeft: '0.85rem' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: meta.color }}>
                              {meta.label}
                            </span>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)' }}>
                              {a.lead_title ?? 'Order'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginTop: '0.1rem' }}>
                            {a.type === 'STAGE_CHANGED' && from && to ? (
                              <>
                                {fmt(from)} <span style={{ color: meta.color }}>→</span> {fmt(to)}
                              </>
                            ) : (
                              a.body
                            )}
                            {a.user_name && <span> · {a.user_name}</span>}
                          </div>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--muted-fg)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {timeAgo(a.created_at)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="ceo-section">
              <div className="ceo-section-title" style={{ marginBottom: '1rem' }}>
                Quick Actions
              </div>
              <div className="ceo-actions">
                {([
                  { label: 'View Leads', to: '/app/leads', icon: Users, badge: d.total_leads.count },
                  { label: 'Follow-ups', to: '/app/leads/follow-ups', icon: Clock, badge: d.follow_ups.count },
                  { label: 'Send Quotes', to: '/app/quotations', icon: FileText, badge: d.pending_quotations.count },
                  { label: 'Invoices', to: '/app/invoices', icon: Receipt, badge: d.invoices_created.count },
                  { label: 'Call Pending', to: '/app/telecaller', icon: Phone, badge: d.delayed_followups.count },
                  { label: 'Production', to: '/app/production', icon: BarChart2, badge: totalOrders },
                  { label: 'Collect Payment', to: '/app/production', icon: Wallet, badge: d.collections_pending.count },
                  { label: 'Integrations', to: '/app/leads/connections', icon: Link2, badge: 0 },
                ] as { label: string; to: string; icon: LucideIcon; badge: number }[]).map((action) => {
                  const Icon = action.icon
                  return (
                    <Link key={action.label} to={action.to}>
                      <Icon size={14} />
                      {action.label}
                      {action.badge > 0 && (
                        <span className="muted small">{action.badge}</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </section>

            <section className="ceo-section" style={{ borderBottom: 'none' }}>
              <div className="ceo-section-title" style={{ marginBottom: '1rem' }}>
                Active Integrations
              </div>
              <div className="ceo-integrations">
                {d.integrations.map((integration) => {
                  const Icon = INTEGRATION_ICONS[integration.key] ?? Link2
                  const connected = integration.status === 'connected'
                  return (
                    <Link key={integration.key} to={integration.link}>
                      <Icon size={14} />
                      <span>{integration.label}</span>
                      <span className="muted small">
                        {connected ? 'Connected' : 'Not connected'}
                        {integration.detail ? ` · ${integration.detail}` : ''}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </>
  )
}
