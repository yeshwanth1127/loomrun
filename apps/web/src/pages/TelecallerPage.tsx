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
  const [durationMinutes, setDurationMinutes] = useState('')
  const [nextFollowUpDate, setNextFollowUpDate] = useState('')
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)

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

  const callDetail = useQuery({
    queryKey: ['call-detail', orgId, selectedCallId],
    enabled: !!orgId && !!selectedCallId,
    queryFn: () =>
      apiFetch<{
        id: string
        lead_title: string | null
        user_email: string | null
        outcome: string
        notes: string | null
        duration_seconds: number | null
        call_source: string
        attempt_number: number
        recording_url: string | null
        transcript_raw: string | null
        ai_summary: string | null
        created_at: string
        next_call_at: string | null
      }>(`/v1/orgs/${orgId}/telecaller/calls/${selectedCallId}`),
  })

  const logCall = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; attempt_number: number; outcome: string; created_at: string }>(
        `/v1/orgs/${orgId}/telecaller/calls`,
        {
          method: 'POST',
          json: {
            lead_id: leadId,
            outcome,
            notes: notes || null,
            duration_seconds: durationMinutes ? parseInt(durationMinutes) * 60 : null,
            next_call_at: nextFollowUpDate ? new Date(nextFollowUpDate).toISOString() : null,
          },
        }
      ),
    onSuccess: () => {
      setNotes('')
      setDurationMinutes('')
      setNextFollowUpDate('')
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
              <div className="row" style={{ gap: '0.75rem' }}>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Duration (minutes)</label>
                  <input
                    className="input"
                    type="number"
                    placeholder="e.g. 5"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Next follow-up</label>
                  <input
                    className="input"
                    type="date"
                    value={nextFollowUpDate}
                    onChange={(e) => setNextFollowUpDate(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <div className="form-field">
                <label className="input-label">Notes / Summary</label>
                <textarea className="input" rows={3} placeholder="What was discussed…" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
              </div>
              {logCall.error && <p className="error">{(logCall.error as Error).message}</p>}
              {logCall.isSuccess && logCall.data && (
                <div style={{ padding: '0.75rem', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '0.375rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#166534' }}>✓ Call logged</div>
                  <div className="stack" style={{ gap: '0.25rem', fontSize: '0.85rem' }}>
                    <div><strong>Outcome:</strong> {logCall.data.outcome}</div>
                    <div><strong>Attempt #:</strong> {logCall.data.attempt_number}</div>
                    <div><strong>Logged at:</strong> {new Date(logCall.data.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                    {notes && <div><strong>Notes:</strong> {notes}</div>}
                    {durationMinutes && <div><strong>Duration:</strong> {durationMinutes} min</div>}
                    {nextFollowUpDate && <div><strong>Follow-up:</strong> {nextFollowUpDate}</div>}
                  </div>
                </div>
              )}
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
                        <div
                          key={c.id}
                          onClick={() => setSelectedCallId(c.id)}
                          className="row spread"
                          style={{
                            padding: '0.4rem 0',
                            borderBottom: '1px solid #f8fafc',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
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

      {/* Call detail modal */}
      {selectedCallId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSelectedCallId(null)}
        >
          <div
            className="card"
            style={{ maxWidth: '500px', width: '90%', maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Call Details</div>
              <button
                type="button"
                onClick={() => setSelectedCallId(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#64748b',
                }}
              >
                ×
              </button>
            </div>

            {callDetail.isLoading && <p className="muted">Loading…</p>}

            {callDetail.data && (
              <div className="stack" style={{ gap: '0.75rem' }}>
                <div>
                  <div className="muted small">Lead</div>
                  <div style={{ fontWeight: 600 }}>{callDetail.data.lead_title ?? '—'}</div>
                </div>

                <div>
                  <div className="muted small">Caller</div>
                  <div>{callDetail.data.user_email ?? 'AI Auto-Call'}</div>
                </div>

                <div>
                  <div className="muted small">Outcome</div>
                  <div>
                    <span className={`badge ${OUTCOME_MAP[callDetail.data.outcome]?.color ?? 'badge-slate'}`}>
                      {OUTCOME_MAP[callDetail.data.outcome]?.label ?? callDetail.data.outcome}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="muted small">Attempt #</div>
                  <div>{callDetail.data.attempt_number}</div>
                </div>

                <div>
                  <div className="muted small">Call Source</div>
                  <div>{callDetail.data.call_source === 'HUMAN' ? 'Manual / Browser Call' : 'AI Auto-Call'}</div>
                </div>

                <div>
                  <div className="muted small">Time</div>
                  <div>{new Date(callDetail.data.created_at).toLocaleString('en-IN')}</div>
                </div>

                {callDetail.data.duration_seconds !== null && (
                  <div>
                    <div className="muted small">Duration</div>
                    <div>{Math.floor(callDetail.data.duration_seconds / 60)}m {callDetail.data.duration_seconds % 60}s</div>
                  </div>
                )}

                {callDetail.data.notes && (
                  <div>
                    <div className="muted small">Notes</div>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{callDetail.data.notes}</div>
                  </div>
                )}

                {callDetail.data.transcript_raw && (
                  <div>
                    <div className="muted small">Transcript</div>
                    <div
                      style={{
                        backgroundColor: '#f1f5f9',
                        padding: '0.5rem',
                        borderRadius: '0.375rem',
                        fontSize: '0.85rem',
                        maxHeight: '200px',
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {callDetail.data.transcript_raw}
                    </div>
                  </div>
                )}

                {callDetail.data.ai_summary && (
                  <div>
                    <div className="muted small">AI Summary</div>
                    <div style={{ fontSize: '0.9rem' }}>{callDetail.data.ai_summary}</div>
                  </div>
                )}

                {callDetail.data.recording_url && (
                  <div>
                    <div className="muted small">Recording</div>
                    <audio controls style={{ width: '100%' }} src={callDetail.data.recording_url} />
                  </div>
                )}

                {callDetail.data.next_call_at && (
                  <div>
                    <div className="muted small">Next Follow-up</div>
                    <div>{new Date(callDetail.data.next_call_at).toLocaleDateString('en-IN')}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
