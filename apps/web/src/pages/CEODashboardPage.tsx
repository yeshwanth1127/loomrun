import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart2,
  Clock,
  FileText,
  Link2,
  MessageCircle,
  Phone,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { MetricSkeleton } from '../components/ui/Skeleton'
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

const STAGE_COLORS: Record<string, string> = {
  FABRIC_CHECK:    '#6366f1',
  PROCUREMENT:     '#f59e0b',
  FABRIC_RECEIVED: '#34d399',
  CUTTING:         '#6366f1',
  PRINTING:        '#8b5cf6',
  STITCHING:       '#ec4899',
  QC:              '#f97316',
  PACKING:         '#14b8a6',
  PAYMENT_HOLD:    '#ef4444',
  READY_DISPATCH:  '#10b981',
  SHIPPED:         '#3b82f6',
  DELIVERED:       '#059669',
}

function fmt(s: string | null) {
  if (!s) return '—'
  return STAGE_LABELS[s] ?? s
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
    d && (d.delayed_followups.count > 0 || d.collections_pending.count > 0 || d.pending_quotations.count > 0)

  return (
    <>
      <div className="page-header">
        <h1>CEO Dashboard</h1>
        <p>
          {isAll ? 'Real-time business overview' : `Metrics for ${dayParam}`}
          {generatedAt && <span className="muted"> · Updated {generatedAt}</span>}
        </p>
      </div>

      <div className="page-body stack" style={{ gap: '2rem' }}>
        {q.isLoading && <MetricSkeleton />}

        {d && (
          <>
            {/* Alert Banner */}
            {hasAlerts && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(249,115,22,0.08) 100%)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 'var(--radius)',
                padding: '1rem 1.25rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}>
                <AlertTriangle size={18} style={{ color: 'var(--destructive)', marginTop: '0.1rem', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--foreground)', marginBottom: '0.25rem' }}>
                    Action Required
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--muted-fg)' }}>
                    {d.delayed_followups.count > 0 && `${d.delayed_followups.count} overdue follow-ups • `}
                    {d.collections_pending.count > 0 && `${d.collections_pending.count} pending payments • `}
                    {d.pending_quotations.count > 0 && `${d.pending_quotations.count} awaiting quotations`}
                  </div>
                </div>
              </div>
            )}

            {/* Key Metrics - 3 Column */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.25rem',
            }}>
              {/* Hot Leads */}
              <div className="card" style={{ border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: '80px', height: '80px', background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(99,102,241,0.01) 100%)' }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div className="row spread" style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-fg)' }}>
                      Hot Leads
                    </div>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>
                      <TrendingUp size={16} />
                    </div>
                  </div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
                    {d.hot_leads.count}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                    Value ≥ ₹{d.hot_leads.threshold_value.toLocaleString('en-IN')}
                  </div>
                </div>
              </div>

              {/* Pending Quotations */}
              <div className="card" style={{ border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: '80px', height: '80px', background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.01) 100%)' }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div className="row spread" style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-fg)' }}>
                      Pending Quotations
                    </div>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(59,130,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
                      <FileText size={16} />
                    </div>
                  </div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
                    {d.pending_quotations.count}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                    Awaiting customer response
                  </div>
                </div>
              </div>

              {/* Telecaller Activity */}
              <div className="card" style={{ border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: '80px', height: '80px', background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(139,92,246,0.01) 100%)' }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div className="row spread" style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-fg)' }}>
                      Telecaller Today
                    </div>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
                      <Phone size={16} />
                    </div>
                  </div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
                    {d.telecaller_today.calls}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                    Calls logged today
                  </div>
                </div>
              </div>
            </div>

            {/* Issues Section - 2 Column */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.25rem',
            }}>
              {/* Delayed Follow-ups */}
              <div className="card" style={{
                border: d.delayed_followups.count > 0 ? '1px solid rgba(239,68,68,0.2)' : '1px solid var(--border)',
                background: d.delayed_followups.count > 0 ? 'linear-gradient(135deg, rgba(239,68,68,0.02) 0%, rgba(239,68,68,0.01) 100%)' : undefined,
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: '60px', height: '60px', background: d.delayed_followups.count > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)' }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div className="row spread" style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-fg)' }}>
                      Follow-up Status
                    </div>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: d.delayed_followups.count > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: d.delayed_followups.count > 0 ? '#ef4444' : '#10b981' }}>
                      <Clock size={16} />
                    </div>
                  </div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color: d.delayed_followups.count > 0 ? '#ef4444' : '#10b981', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
                    {d.delayed_followups.count}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                    {d.delayed_followups.count > 0 ? `Overdue > ${d.delayed_followups.overdue_days} days` : 'All follow-ups on track'}
                  </div>
                </div>
              </div>

              {/* Collections Status */}
              <div className="card" style={{
                border: d.collections_pending.count > 0 ? '1px solid rgba(249,115,22,0.2)' : '1px solid var(--border)',
                background: d.collections_pending.count > 0 ? 'linear-gradient(135deg, rgba(249,115,22,0.02) 0%, rgba(249,115,22,0.01) 100%)' : undefined,
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: '60px', height: '60px', background: d.collections_pending.count > 0 ? 'rgba(249,115,22,0.08)' : 'rgba(16,185,129,0.08)' }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div className="row spread" style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-fg)' }}>
                      Collections
                    </div>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: d.collections_pending.count > 0 ? 'rgba(249,115,22,0.12)' : 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: d.collections_pending.count > 0 ? '#f59e0b' : '#10b981' }}>
                      <Wallet size={16} />
                    </div>
                  </div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color: d.collections_pending.count > 0 ? '#f59e0b' : '#10b981', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
                    {d.collections_pending.count}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                    {d.collections_pending.count > 0 ? 'Unpaid after dispatch' : 'All payments collected'}
                  </div>
                </div>
              </div>
            </div>

            {/* Production Pipeline */}
            {stageEntries.length > 0 && (
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                    <BarChart2 size={14} />
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--foreground)' }}>
                    Production Pipeline
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginLeft: 'auto' }}>
                    {totalOrders} total orders
                  </div>
                </div>

                <div className="card">
                  <div className="stack" style={{ gap: '1rem' }}>
                    {stageEntries.map(([stage, count], idx) => {
                      const color = STAGE_COLORS[stage] || '#a8a29e'
                      const percentage = (count / totalOrders) * 100
                      const isBottleneck = stage === d.production_bottlenecks.busiest_stage

                      return (
                        <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          {/* Stage indicator */}
                          <div style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: color,
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            {idx + 1}
                          </div>

                          {/* Stage name and count */}
                          <div style={{ width: '140px', flexShrink: 0 }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)' }}>
                              {fmt(stage)}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--muted-fg)' }}>
                              {count} order{count !== 1 ? 's' : ''}
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'var(--secondary)', overflow: 'hidden' }}>
                            <div
                              style={{
                                height: '100%',
                                background: color,
                                width: `${percentage}%`,
                                transition: 'width 0.4s ease',
                                boxShadow: isBottleneck ? `0 0 8px ${color}40` : undefined,
                              }}
                            />
                          </div>

                          {/* Percentage */}
                          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground)', minWidth: '40px', textAlign: 'right' }}>
                            {percentage.toFixed(0)}%
                          </div>

                          {/* Bottleneck badge */}
                          {isBottleneck && (
                            <div style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#dc2626', padding: '0.2rem 0.5rem', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                              BOTTLENECK
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* Quick Actions */}
            <section>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--foreground)', marginBottom: '1rem' }}>
                Quick Actions
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '0.75rem',
              }}>
                <button style={{
                  background: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  padding: '0.75rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                }} onMouseEnter={(e) => e.currentTarget.style.background = '#a83817'} onMouseLeave={(e) => e.currentTarget.style.background = 'var(--primary)'}>
                  <TrendingUp size={16} />
                  View Hot Leads
                </button>
                <button style={{
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  padding: '0.75rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                }} onMouseEnter={(e) => e.currentTarget.style.background = '#2563eb'} onMouseLeave={(e) => e.currentTarget.style.background = '#3b82f6'}>
                  <FileText size={16} />
                  Send Quotes
                </button>
                <button style={{
                  background: '#8b5cf6',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  padding: '0.75rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                }} onMouseEnter={(e) => e.currentTarget.style.background = '#7c3aed'} onMouseLeave={(e) => e.currentTarget.style.background = '#8b5cf6'}>
                  <Phone size={16} />
                  Call Pending
                </button>
                <button style={{
                  background: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  padding: '0.75rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                }} onMouseEnter={(e) => e.currentTarget.style.background = '#059669'} onMouseLeave={(e) => e.currentTarget.style.background = '#10b981'}>
                  <Wallet size={16} />
                  Collect Payment
                </button>
              </div>
            </section>

            {/* Integrations Status */}
            <section>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--foreground)', marginBottom: '1rem' }}>
                Active Integrations
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '1rem',
              }}>
                {[
                  { name: 'WhatsApp', icon: '💬', status: 'connected' },
                  { name: 'Telephony', icon: '☎️', status: 'connected' },
                  { name: 'Lead Integrations', icon: '🔗', status: 'connected' },
                ].map((integration) => (
                  <div key={integration.name} style={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '1rem',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
                      {integration.icon}
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: '0.5rem' }}>
                      {integration.name}
                    </div>
                    <div style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      background: '#d1fae5',
                      color: '#047857',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      display: 'inline-block',
                    }}>
                      ✓ Connected
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </>
  )
}
