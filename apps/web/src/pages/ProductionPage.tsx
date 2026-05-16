import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Plus, Zap } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type Lead = { id: string; title: string }
type Row = {
  id: string
  lead_id: string
  quotation_id: string | null
  stage: string
  delay_flag: boolean
  stage_entered_at: string
  lead_title: string | null
  payments: { id: string; amount_cents: number; status: string }[]
}

const STAGES = [
  'PENDING', 'FABRIC_CHECK', 'PROCUREMENT', 'FABRIC_RECEIVED',
  'CUTTING', 'PRINTING', 'STITCHING', 'QC',
  'PACKING', 'PAYMENT_HOLD', 'READY_DISPATCH', 'SHIPPED', 'DELIVERED',
]

const STAGE_LABELS: Record<string, string> = {
  PENDING:        'Pending',
  FABRIC_CHECK:   'Fabric Check',
  PROCUREMENT:    'Procurement',
  FABRIC_RECEIVED:'Fabric Received',
  CUTTING:        'Cutting',
  PRINTING:       'Printing',
  STITCHING:      'Stitching',
  QC:             'Quality Check',
  PACKING:        'Packing',
  PAYMENT_HOLD:   'Payment Hold',
  READY_DISPATCH: 'Ready to Dispatch',
  SHIPPED:        'Shipped',
  DELIVERED:      'Delivered',
}

const STAGE_COLOR: Record<string, string> = {
  PENDING:        '#94a3b8',
  FABRIC_CHECK:   '#60a5fa',
  PROCUREMENT:    '#f59e0b',
  FABRIC_RECEIVED:'#34d399',
  CUTTING:        '#6366f1',
  PRINTING:       '#8b5cf6',
  STITCHING:      '#ec4899',
  QC:             '#f97316',
  PACKING:        '#14b8a6',
  PAYMENT_HOLD:   '#ef4444',
  READY_DISPATCH: '#10b981',
  SHIPPED:        '#3b82f6',
  DELIVERED:      '#059669',
}

function daysAgo(dt: string) {
  const diff = Date.now() - new Date(dt).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day'
  return `${days} days`
}

export function ProductionPage() {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [leadId, setLeadId] = useState('')

  const leadsQ = useQuery({
    queryKey: ['leads-select', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads`),
  })

  const q = useQuery({
    queryKey: ['production', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Row[] }>(`/v1/orgs/${orgId}/production`),
  })

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/production`, { method: 'POST', json: { lead_id: leadId } }),
    onSuccess: () => {
      setLeadId(''); setShowForm(false)
      void qc.invalidateQueries({ queryKey: ['production', orgId] })
    },
  })

  const advance = useMutation({
    mutationFn: (p: { id: string; stage: string }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}`, { method: 'PATCH', json: { stage: p.stage } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['production', orgId] }),
  })


  if (!orgId) return (
    <>
      <div className="page-header"><h1>Production</h1><p>Select an organization.</p></div>
    </>
  )

  const orders = q.data?.items ?? []
  const leads = leadsQ.data?.items ?? []
  const delayedCount = orders.filter((r) => r.delay_flag).length

  return (
    <>
      <div className="page-header">
        <h1>Production</h1>
        <p>
          {orders.length} order{orders.length !== 1 ? 's' : ''} in pipeline
          {delayedCount > 0 && <span className="error"> · {delayedCount} delayed</span>}
        </p>
      </div>

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        <div className="row spread">
          <span />
          <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
            <Plus size={15} />
            Start order
          </button>
        </div>

        {showForm && (
          <div className="card" style={{ maxWidth: 480 }}>
            <div style={{ fontWeight: 700, marginBottom: '1rem' }}>Start Production Order</div>
            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                if (leadId) void create.mutateAsync()
              }}
            >
              <div className="form-field">
                <label className="input-label">Lead *</label>
                <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)} style={{ width: '100%' }} required>
                  <option value="">Select lead…</option>
                  {leads.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>
              {create.error && <p className="error">{(create.error as Error).message}</p>}
              <div className="row">
                <button type="submit" className="btn" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Start order'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {q.isLoading && <p className="muted">Loading orders…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {orders.length > 0 ? (
          <div className="stack" style={{ gap: '0.75rem' }}>
            {orders.map((r) => {
              const stageIdx = STAGES.indexOf(r.stage)
              const progress = ((stageIdx + 1) / STAGES.length) * 100
              const nextStage = STAGES[stageIdx + 1]

              return (
                <div
                  key={r.id}
                  className="card"
                  style={{ borderLeft: `3px solid ${r.delay_flag ? '#ef4444' : (STAGE_COLOR[r.stage] ?? '#6366f1')}` }}
                >
                  <div className="row spread" style={{ marginBottom: '0.75rem' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                        {r.lead_title ?? 'Unnamed lead'}
                        {r.delay_flag && (
                          <span style={{ marginLeft: '0.5rem', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}>
                            <AlertTriangle size={13} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                            Delayed
                          </span>
                        )}
                      </div>
                      <div className="muted small">
                        In {STAGE_LABELS[r.stage] ?? r.stage} for {daysAgo(r.stage_entered_at)}
                      </div>
                    </div>
                    <div className="row" style={{ gap: '0.5rem' }}>
                      {nextStage && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={advance.isPending}
                          onClick={() => advance.mutate({ id: r.id, stage: nextStage })}
                        >
                          <ChevronRight size={14} />
                          Next: {STAGE_LABELS[nextStage]}
                        </button>
                      )}
                      <select
                        className="select"
                        value={r.stage}
                        style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', minWidth: 0 }}
                        onChange={(e) => advance.mutate({ id: r.id, stage: e.target.value })}
                      >
                        {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 999, background: '#f1f5f9', marginBottom: '0.5rem' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 999,
                        background: r.delay_flag ? '#ef4444' : (STAGE_COLOR[r.stage] ?? '#6366f1'),
                        width: `${progress}%`,
                        transition: 'width .3s ease',
                      }}
                    />
                  </div>

                  <div className="row spread">
                    <span className="muted small">{Math.round(progress)}% complete</span>
                    <label className="row small muted" style={{ gap: '0.35rem', cursor: 'pointer' }}>
                      <span>Mark delayed</span>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={r.delay_flag}
                          onChange={() => apiFetch(`/v1/orgs/${orgId}/production/${r.id}`, {
                            method: 'PATCH',
                            json: { stage: r.stage, delay_flag: !r.delay_flag },
                          }).then(() => qc.invalidateQueries({ queryKey: ['production', orgId] }))}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          !q.isLoading && (
            <div className="empty-state card">
              <Zap size={28} />
              <p>No production orders yet. Start one from a confirmed lead.</p>
            </div>
          )
        )}
      </div>
    </>
  )
}
