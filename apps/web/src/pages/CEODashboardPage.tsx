import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart2,
  Clock,
  FileText,
  Phone,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type CEO = {
  generated_at: string
  hot_leads: { count: number; threshold_value: number }
  pending_quotations: { count: number }
  delayed_followups: { count: number; overdue_days: number }
  production_bottlenecks: { by_stage: Record<string, number>; busiest_stage: string | null }
  collections_pending: { count: number }
  telecaller_today: { calls: number }
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

function fmt(s: string | null) {
  if (!s) return '—'
  return STAGE_LABELS[s] ?? s
}

export function CEODashboardPage() {
  const { orgId } = useAuth()
  const q = useQuery({
    queryKey: ['ceo', orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: () => apiFetch<CEO>(`/v1/orgs/${orgId}/dashboard/ceo`),
  })

  if (!orgId) return (
    <>
      <div className="page-header"><h1>CEO Dashboard</h1><p>Select an organization to view analytics.</p></div>
    </>
  )

  const d = q.data
  const generatedAt = d ? new Date(d.generated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null

  const byStage = d?.production_bottlenecks.by_stage ?? {}
  const stageEntries = Object.entries(byStage).sort(([, a], [, b]) => b - a)
  const maxCount = stageEntries[0]?.[1] ?? 1

  return (
    <>
      <div className="page-header">
        <h1>CEO Dashboard</h1>
        <p>
          Real-time business overview
          {generatedAt && <span className="muted"> · Updated {generatedAt}</span>}
        </p>
      </div>

      <div className="page-body stack" style={{ gap: '1.75rem' }}>
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {q.isLoading && (
          <div className="metrics-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="metric-card" style={{ opacity: 0.4, minHeight: 120 }} />
            ))}
          </div>
        )}

        {d && (
          <>
            {/* Metric cards */}
            <div className="metrics-grid">
              <div className="metric-card indigo">
                <div className="metric-icon indigo"><TrendingUp size={18} /></div>
                <div className="metric-label">Hot Leads</div>
                <div className="metric-value">{d.hot_leads.count}</div>
                <div className="metric-sub">Value ≥ ₹{d.hot_leads.threshold_value.toLocaleString('en-IN')}</div>
              </div>

              <div className="metric-card blue">
                <div className="metric-icon blue"><FileText size={18} /></div>
                <div className="metric-label">Pending Quotations</div>
                <div className="metric-value">{d.pending_quotations.count}</div>
                <div className="metric-sub">Awaiting customer response</div>
              </div>

              <div className={`metric-card ${d.delayed_followups.count > 0 ? 'red' : 'green'}`}>
                <div className={`metric-icon ${d.delayed_followups.count > 0 ? 'red' : 'green'}`}>
                  <Clock size={18} />
                </div>
                <div className="metric-label">Delayed Follow-ups</div>
                <div className="metric-value">{d.delayed_followups.count}</div>
                <div className="metric-sub">Overdue &gt; {d.delayed_followups.overdue_days} days</div>
              </div>

              <div className={`metric-card ${d.collections_pending.count > 0 ? 'amber' : 'green'}`}>
                <div className={`metric-icon ${d.collections_pending.count > 0 ? 'amber' : 'green'}`}>
                  <Wallet size={18} />
                </div>
                <div className="metric-label">Collections Pending</div>
                <div className="metric-value">{d.collections_pending.count}</div>
                <div className="metric-sub">Unpaid after dispatch</div>
              </div>

              <div className="metric-card purple">
                <div className="metric-icon purple"><Phone size={18} /></div>
                <div className="metric-label">Telecaller Today</div>
                <div className="metric-value">{d.telecaller_today.calls}</div>
                <div className="metric-sub">Calls logged today</div>
              </div>

              <div className="metric-card amber">
                <div className="metric-icon amber"><AlertTriangle size={18} /></div>
                <div className="metric-label">Production Bottleneck</div>
                <div className="metric-value" style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
                  {fmt(d.production_bottlenecks.busiest_stage)}
                </div>
                <div className="metric-sub">Most orders stuck here</div>
              </div>
            </div>

            {/* Production stage breakdown */}
            {stageEntries.length > 0 && (
              <section>
                <div className="section-title">
                  <div className="row" style={{ gap: '0.4rem' }}>
                    <BarChart2 size={16} />
                    Production Stage Breakdown
                  </div>
                </div>
                <div className="card">
                  <div className="stack" style={{ gap: '0.6rem' }}>
                    {stageEntries.map(([stage, count]) => (
                      <div key={stage}>
                        <div className="row spread" style={{ marginBottom: '0.3rem' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 500, color: '#374151' }}>
                            {fmt(stage)}
                          </span>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>{count}</span>
                        </div>
                        <div style={{ height: 7, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              borderRadius: 999,
                              background: stage === d.production_bottlenecks.busiest_stage
                                ? '#f59e0b'
                                : '#6366f1',
                              width: `${(count / maxCount) * 100}%`,
                              transition: 'width .4s ease',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}
