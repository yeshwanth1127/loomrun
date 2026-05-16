import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, PhoneCall } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type Lead = { id: string; title: string }

const OUTCOMES = [
  { value: 'CONNECTED',         label: 'Connected',         color: 'badge-green' },
  { value: 'NO_ANSWER',         label: 'No Answer',         color: 'badge-slate' },
  { value: 'BUSY',              label: 'Busy',              color: 'badge-amber' },
  { value: 'WRONG_NUMBER',      label: 'Wrong Number',      color: 'badge-red' },
  { value: 'NOT_INTERESTED',    label: 'Not Interested',    color: 'badge-red' },
  { value: 'CALLBACK_SCHEDULED',label: 'Callback Scheduled',color: 'badge-blue' },
  { value: 'QUALIFIED',         label: 'Qualified',         color: 'badge-indigo' },
]

const OUTCOME_MAP = Object.fromEntries(OUTCOMES.map((o) => [o.value, o]))

export function TelecallerPage() {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const [leadId, setLeadId] = useState('')
  const [outcome, setOutcome] = useState('CONNECTED')
  const [notes, setNotes] = useState('')

  const leadsQ = useQuery({
    queryKey: ['leads-select', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads`),
  })

  const summary = useQuery({
    queryKey: ['tele-summary', orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: () =>
      apiFetch<{
        date: string
        total_calls: number
        by_outcome: Record<string, number>
        calls: { id: string; lead_title: string | null; user_email: string | null; outcome: string; created_at: string }[]
      }>(`/v1/orgs/${orgId}/telecaller/daily-summary`),
  })

  const logCall = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/telecaller/calls`, {
        method: 'POST',
        json: { lead_id: leadId, outcome, notes: notes || null },
      }),
    onSuccess: () => {
      setNotes('')
      void qc.invalidateQueries({ queryKey: ['tele-summary', orgId] })
    },
  })

  if (!orgId) return (
    <>
      <div className="page-header"><h1>Telecaller</h1><p>Select an organization.</p></div>
    </>
  )

  const data = summary.data
  const calls = data?.calls ?? []
  const byOutcome = data?.by_outcome ?? {}

  return (
    <>
      <div className="page-header">
        <h1>Telecaller</h1>
        <p>Log calls and track daily performance</p>
      </div>

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>

        {/* Log call */}
        <div className="stack" style={{ gap: '1.25rem' }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <PhoneCall size={16} style={{ color: '#6366f1' }} />
              Log Call
            </div>
            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                if (leadId) void logCall.mutateAsync()
              }}
            >
              <div className="form-field">
                <label className="input-label">Lead *</label>
                <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)} style={{ width: '100%' }} required>
                  <option value="">Select lead…</option>
                  {(leadsQ.data?.items ?? []).map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="input-label">Outcome</label>
                <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ width: '100%' }}>
                  {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="input-label">Notes</label>
                <textarea className="input" rows={3} placeholder="Call notes…" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
              </div>
              {logCall.error && <p className="error">{(logCall.error as Error).message}</p>}
              {logCall.isSuccess && <p className="success">Call logged.</p>}
              <button type="submit" className="btn" disabled={logCall.isPending}>
                <Phone size={14} />
                {logCall.isPending ? 'Saving…' : 'Save call'}
              </button>
            </form>
          </div>
        </div>

        {/* Summary */}
        <div className="stack" style={{ gap: '1.25rem' }}>
          {data && (
            <>
              {/* Outcome breakdown */}
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: '1rem' }}>
                  Today — {data.date}
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                  {data.total_calls}
                </div>
                <div className="muted small" style={{ marginBottom: '1rem' }}>calls logged</div>

                <div className="stack" style={{ gap: '0.5rem' }}>
                  {Object.entries(byOutcome).map(([k, v]) => {
                    const meta = OUTCOME_MAP[k]
                    return (
                      <div key={k} className="row spread">
                        <span className={`badge ${meta?.color ?? 'badge-slate'}`}>{meta?.label ?? k}</span>
                        <span style={{ fontWeight: 700 }}>{v}</span>
                      </div>
                    )
                  })}
                  {Object.keys(byOutcome).length === 0 && (
                    <p className="muted small">No calls logged today.</p>
                  )}
                </div>
              </div>

              {/* Recent calls */}
              {calls.length > 0 && (
                <div className="card">
                  <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Recent Calls</div>
                  <div className="stack" style={{ gap: '0.5rem' }}>
                    {calls.slice(0, 10).map((c) => {
                      const meta = OUTCOME_MAP[c.outcome]
                      return (
                        <div key={c.id} className="row spread" style={{ padding: '0.4rem 0', borderBottom: '1px solid #f8fafc' }}>
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{c.lead_title ?? '—'}</div>
                            <div className="muted small">{c.user_email}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span className={`badge ${meta?.color ?? 'badge-slate'}`}>{meta?.label ?? c.outcome}</span>
                            <div className="muted small" style={{ marginTop: '0.2rem' }}>
                              {new Date(c.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          {summary.isLoading && <div className="card muted">Loading summary…</div>}
        </div>
      </div>
    </>
  )
}
