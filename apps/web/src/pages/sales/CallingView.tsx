import { useQuery } from '@tanstack/react-query'
import { Mail, MessageCircle, Phone, PhoneCall, SkipForward } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LeadSearchSelect } from '../../components/LeadSearchSelect'
import { SendQuoteMenu } from '../../components/SendQuoteMenu'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { DonutChart, DonutLegend, MetricCard } from '../../components/ui/dashboard'
import { useAuth } from '../../context/AuthContext'
import { useDateFilter } from '../../context/DateFilterContext'
import { apiFetch } from '../../lib/api'
import { routes } from '../../lib/appRoutes'
import { CALL_STATUS_MAP } from '../../lib/callStatus'
import { activeFollowUpAt, isFollowUpOverdue } from '../../lib/followUp'
import type { Lead } from '../../lib/leads'
import { isTelecallerRole, membershipForOrg } from '../../lib/membership'
import { LeadCallPanel } from './LeadCallPanel'
import { useLeadWorkspace } from './useLeadWorkspace'

type DailySummary = {
  date: string
  total_calls: number
  by_outcome: Record<string, number>
  calls: {
    id: string
    lead_title: string | null
    logged_by: string | null
    outcome: string
    created_at: string
  }[]
}

type CallDetail = {
  id: string
  lead_title: string | null
  logged_by: string | null
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
}

const DONUT_COLORS = ['#3D7A5A', '#B42318', '#0E7490', '#B07A2E', '#0F766E', '#64748b']

/**
 * Sales → Calls — focused telecaller workspace.
 *
 * Same single-page loop as the old Telecaller page: pick a lead, call, log,
 * then take the next one without leaving. Dial/log reuses LeadCallPanel
 * (shared with Lead Detail → Call).
 */
export function CallingView({ orgId }: { orgId: string }) {
  const { me } = useAuth()
  const { dayParam, appendDay, isAll, isToday } = useDateFilter()
  const [searchParams, setSearchParams] = useSearchParams()
  const membership = membershipForOrg(me, orgId)
  const isTelecaller = isTelecallerRole(membership)
  const summaryUserId = isTelecaller ? (me?.id ?? null) : null

  const [activeLeadId, setActiveLeadId] = useState(() => searchParams.get('lead') ?? '')
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)
  const [justLogged, setJustLogged] = useState(false)

  function selectLead(leadId: string) {
    setActiveLeadId(leadId)
    setJustLogged(false)
    const next = new URLSearchParams(searchParams)
    if (leadId) next.set('lead', leadId)
    else next.delete('lead')
    if (!next.get('view')) next.set('view', 'calling')
    setSearchParams(next, { replace: true })
  }

  function clearLead() {
    selectLead('')
  }

  const summary = useQuery({
    queryKey: ['tele-summary', orgId, summaryUserId, dayParam],
    enabled: !!orgId,
    refetchInterval: isAll ? false : isToday ? 30_000 : false,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      if (summaryUserId) params.set('user_id', summaryUserId)
      return apiFetch<DailySummary>(`/v1/orgs/${orgId}/telecaller/daily-summary?${params}`)
    },
  })

  const callDetail = useQuery({
    queryKey: ['call-detail', orgId, selectedCallId],
    enabled: !!orgId && !!selectedCallId,
    queryFn: () => apiFetch<CallDetail>(`/v1/orgs/${orgId}/telecaller/calls/${selectedCallId}`),
  })

  
  const newLeadsQ = useQuery({
    queryKey: ['calls-new-queue', orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: () =>
      apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads?stage=NEW&day=all&include_last_call=true`),
  })

const dueQ = useQuery({
    queryKey: ['calls-queue', orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: () =>
      apiFetch<{ items: Lead[] }>(
        `/v1/orgs/${orgId}/leads?last_call_outcome=FOLLOW_UP,FOLLOW_UP_DATE_SET,FOLLOW_UP_AFTER_SAMPLE,CALL_BACK_LATER,CALLBACK_SCHEDULED&day=all`,
      ),
  })

  const workspace = useLeadWorkspace(orgId, activeLeadId)
  const activeLead = workspace.detailQ.data

  const queue = useMemo(() => {
    const due = (dueQ.data?.items ?? [])
      .filter(
        (l) =>
          l.id !== activeLeadId &&
          !!activeFollowUpAt(l.next_follow_up_at, l.last_call_outcome),
      )
      .sort((a, b) => {
        const aOver = isFollowUpOverdue(a.next_follow_up_at, a.last_call_outcome) ? 0 : 1
        const bOver = isFollowUpOverdue(b.next_follow_up_at, b.last_call_outcome) ? 0 : 1
        if (aOver !== bOver) return aOver - bOver
        const aAt = activeFollowUpAt(a.next_follow_up_at, a.last_call_outcome) ?? ''
        const bAt = activeFollowUpAt(b.next_follow_up_at, b.last_call_outcome) ?? ''
        return aAt.localeCompare(bAt)
      })
    const dueIds = new Set(due.map((l) => l.id))
    const fresh = (newLeadsQ.data?.items ?? []).filter(
      (l) => l.id !== activeLeadId && !l.last_call_outcome && !dueIds.has(l.id),
    )
    return [...due, ...fresh]
  }, [dueQ.data?.items, newLeadsQ.data?.items, activeLeadId])

  const nextInQueue = queue[0] ?? null

  const data = summary.data
  const byOutcome = data?.by_outcome ?? {}
  const total = data?.total_calls ?? 0
  const connected =
    (byOutcome.CONNECTED_INTERESTED ?? 0) +
    (byOutcome.CONNECTED ?? 0) +
    (byOutcome.QUALIFIED ?? 0) +
    (byOutcome.ORDER_CONFIRMED ?? 0)
  const notInterested =
    (byOutcome.CONNECTED_NOT_INTERESTED ?? 0) + (byOutcome.NOT_INTERESTED ?? 0)
  const noResponse =
    (byOutcome.RINGING_NO_RESPONSE ?? 0) +
    (byOutcome.NO_ANSWER ?? 0) +
    (byOutcome.SWITCHED_OFF ?? 0)
  const qualified = (byOutcome.QUALIFIED ?? 0) + (byOutcome.ORDER_CONFIRMED ?? 0)

  const segments = Object.entries(byOutcome).map(([k, v], i) => ({
    label: CALL_STATUS_MAP[k]?.label ?? k,
    value: v,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }))

  const leadPhone = activeLead?.phone ?? ''
  const leadEmail = activeLead?.email ?? ''
  const waDigits = leadPhone.replace(/\D/g, '')

  return (
    <div className="calls-workspace stack" style={{ gap: '1.25rem' }}>
      {summary.error && <p className="error">{(summary.error as Error).message}</p>}

      <div className="metrics-grid">
        <MetricCard
          tone="purple"
          icon={PhoneCall}
          label="Calls"
          value={total}
          hint={isAll ? 'All time' : isToday ? 'Today' : (data?.date ?? '')}
        />
        <MetricCard
          tone="green"
          icon={Phone}
          label="Connected"
          value={connected}
          hint={total ? `${((connected / total) * 100).toFixed(1)}%` : '0%'}
        />
        <MetricCard tone="red" label="Not interested" value={notInterested} />
        <MetricCard tone="slate" label="No response" value={noResponse} />
        <MetricCard tone="amber" label="Busy" value={byOutcome.BUSY ?? 0} />
        <MetricCard tone="purple" label="Qualified" value={qualified} />
        <MetricCard
          tone="green"
          label="Follow-ups set"
          value={byOutcome.CALLBACK_SCHEDULED ?? 0}
        />
      </div>

      <div className="page-grid-2">
        <div className="stack" style={{ gap: '1rem' }}>
          <section className="card stack" style={{ gap: '0.85rem' }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: '0.75rem' }}>
              <div>
                <strong>Who are you calling?</strong>
                <p className="muted small" style={{ margin: '0.15rem 0 0' }}>
                  Call, log the outcome, then take the next lead — without leaving this screen.
                </p>
              </div>
              {activeLeadId ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearLead}>
                  Clear
                </button>
              ) : null}
            </div>

            <LeadSearchSelect
              orgId={orgId}
              value={activeLeadId}
              onChange={(leadId) => selectLead(leadId)}
              placeholder="Search a lead to call…"
            />

            {justLogged ? (
              <div className="calls-next-bar">
                <span className="small">Call saved.</span>
                {nextInQueue ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => selectLead(nextInQueue.id)}
                  >
                    <SkipForward size={14} />
                    Next: {nextInQueue.title}
                  </button>
                ) : (
                  <span className="muted small">Pick another lead above to keep going.</span>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearLead}>
                  Done for now
                </button>
              </div>
            ) : null}

            {!activeLeadId && queue.length > 0 ? (
              <div className="calls-queue">
                <div className="muted small" style={{ fontWeight: 600 }}>
                  Call queue ({queue.length})
                </div>
                <ul>
                  {queue.slice(0, 8).map((l) => {
                    const overdue = isFollowUpOverdue(l.next_follow_up_at, l.last_call_outcome)
                    return (
                      <li key={l.id}>
                        <button type="button" onClick={() => selectLead(l.id)}>
                          <span className="calls-queue-main">
                            <span style={{ fontWeight: 600 }}>{l.title}</span>
                            <span className="muted small">
                              {[l.company, l.phone].filter(Boolean).join(' · ') || '—'}
                            </span>
                          </span>
                          <span className={`badge ${overdue ? 'badge-red' : 'badge-blue'}`}>
                            {overdue ? 'Overdue' : 'Due'}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </section>

          {activeLeadId && workspace.detailQ.isLoading ? (
            <p className="muted small">Loading lead…</p>
          ) : null}
          {activeLeadId && workspace.detailQ.error ? (
            <p className="error">{(workspace.detailQ.error as Error).message}</p>
          ) : null}

          {activeLead ? (
            <>
              <section className="card stack" style={{ gap: '0.65rem' }}>
                <div
                  className="row"
                  style={{ justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{activeLead.title}</div>
                    <div className="muted small">
                      {[activeLead.company, activeLead.phone, activeLead.city]
                        .filter(Boolean)
                        .join(' · ') || 'No contact details yet'}
                    </div>
                  </div>
                  <Link className="btn btn-ghost btn-sm" to={routes.lead(activeLead.id, 'call')}>
                    Open lead
                  </Link>
                </div>
                <div className="quick-actions">
                  {leadPhone ? (
                    <a className="quick-action-btn" href={`tel:${leadPhone}`}>
                      <Phone size={13} /> Call
                    </a>
                  ) : null}
                  {waDigits ? (
                    <a
                      className="quick-action-btn"
                      href={`https://wa.me/${waDigits}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle size={13} /> WhatsApp
                    </a>
                  ) : null}
                  {leadEmail ? (
                    <a className="quick-action-btn" href={`mailto:${leadEmail}`}>
                      <Mail size={13} /> Email
                    </a>
                  ) : null}
                  <SendQuoteMenu
                    orgId={orgId}
                    leadId={activeLead.id}
                    phone={activeLead.phone}
                    email={activeLead.email}
                  />
                </div>
              </section>

              <LeadCallPanel
                key={activeLead.id}
                lead={activeLead}
                orgId={orgId}
                workspace={workspace}
                onLogged={() => {
                  setJustLogged(true)
                  void dueQ.refetch()
                }}
              />
            </>
          ) : null}

          {!activeLeadId ? (
            <EmptyState
              icon={PhoneCall}
              title="Pick a lead to start calling"
              description="Search above, or tap a due follow-up. After you log the call, the next one is ready."
            />
          ) : null}
        </div>

        <div className="stack" style={{ gap: '1rem' }}>
          <section className="insight-card">
            <div className="insight-card-head">
              <h3>How calls went</h3>
            </div>
            <div className="insight-card-body">
              {total > 0 ? (
                <>
                  <DonutChart
                    segments={segments}
                    center={{ value: total, label: 'Calls' }}
                  />
                  <DonutLegend segments={segments} total={total} />
                </>
              ) : (
                <p className="muted small">
                  {isAll
                    ? 'No calls logged yet.'
                    : isToday
                      ? 'No calls logged today.'
                      : 'No calls logged on this date.'}
                </p>
              )}
            </div>
          </section>

          <section className="insight-card">
            <div className="insight-card-head">
              <h3>Call log</h3>
            </div>
            <div className="insight-card-body">
              {summary.isLoading ? (
                <p className="muted small">Loading…</p>
              ) : (data?.calls ?? []).length === 0 ? (
                <EmptyState icon={PhoneCall} description="No calls logged for this period." />
              ) : (
                <ul className="calling-log">
                  {(data?.calls ?? []).map((c) => {
                    const outcome = CALL_STATUS_MAP[c.outcome]
                    return (
                      <li key={c.id}>
                        <button type="button" onClick={() => setSelectedCallId(c.id)}>
                          <span className="calling-log-main">
                            <span style={{ fontWeight: 600 }}>{c.lead_title ?? '—'}</span>
                            <span className="muted small">
                              Logged by {c.logged_by ?? 'AI Auto-Call'}
                            </span>
                          </span>
                          <span className={`badge ${outcome?.color ?? 'badge-slate'}`}>
                            {outcome?.label ?? c.outcome}
                          </span>
                          <span className="muted small">
                            {isAll
                              ? new Date(c.created_at).toLocaleString('en-IN')
                              : new Date(c.created_at).toLocaleTimeString('en-IN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="tips-banner">
        <span>
          Call between 11:00 AM – 1:00 PM and 4:00 PM – 8:00 PM for a better connect rate.
        </span>
      </div>

      <Modal
        open={!!selectedCallId}
        onClose={() => setSelectedCallId(null)}
        title="Call details"
        size="lg"
      >
        {callDetail.isLoading ? (
          <p className="muted small">Loading…</p>
        ) : callDetail.data ? (
          <div className="stack" style={{ gap: '0.65rem' }}>
            <div className="info-grid">
              <div className="info-field">
                <label>Customer</label>
                <div className="value">{callDetail.data.lead_title ?? '—'}</div>
              </div>
              <div className="info-field">
                <label>Logged by</label>
                <div className="value">{callDetail.data.logged_by ?? 'AI Auto-Call'}</div>
              </div>
              <div className="info-field">
                <label>Outcome</label>
                <div className="value">
                  <span
                    className={`badge ${CALL_STATUS_MAP[callDetail.data.outcome]?.color ?? 'badge-slate'}`}
                  >
                    {CALL_STATUS_MAP[callDetail.data.outcome]?.label ?? callDetail.data.outcome}
                  </span>
                </div>
              </div>
              <div className="info-field">
                <label>Attempt #</label>
                <div className="value">{callDetail.data.attempt_number}</div>
              </div>
              <div className="info-field">
                <label>Placed by</label>
                <div className="value">
                  {callDetail.data.call_source === 'HUMAN'
                    ? 'Manual / Browser call'
                    : 'AI Auto-Call'}
                </div>
              </div>
              <div className="info-field">
                <label>Time</label>
                <div className="value">
                  {new Date(callDetail.data.created_at).toLocaleString('en-IN')}
                </div>
              </div>
              {callDetail.data.duration_seconds != null ? (
                <div className="info-field">
                  <label>Duration</label>
                  <div className="value">
                    {Math.floor(callDetail.data.duration_seconds / 60)}m{' '}
                    {callDetail.data.duration_seconds % 60}s
                  </div>
                </div>
              ) : null}
              {callDetail.data.next_call_at ? (
                <div className="info-field">
                  <label>Next follow-up</label>
                  <div className="value">
                    {new Date(callDetail.data.next_call_at).toLocaleDateString('en-IN')}
                  </div>
                </div>
              ) : null}
            </div>

            {callDetail.data.notes ? (
              <div className="form-field">
                <label className="input-label">Notes</label>
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
                  {callDetail.data.notes}
                </p>
              </div>
            ) : null}
            {callDetail.data.ai_summary ? (
              <div className="form-field">
                <label className="input-label">AI summary</label>
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
                  {callDetail.data.ai_summary}
                </p>
              </div>
            ) : null}
            {callDetail.data.transcript_raw ? (
              <div className="form-field">
                <label className="input-label">Transcript</label>
                <div
                  className="surface-muted small"
                  style={{
                    whiteSpace: 'pre-wrap',
                    maxHeight: 220,
                    overflow: 'auto',
                    padding: '0.6rem',
                  }}
                >
                  {callDetail.data.transcript_raw}
                </div>
              </div>
            ) : null}
            {callDetail.data.recording_url ? (
              <div className="form-field">
                <label className="input-label">Recording</label>
                <audio controls src={callDetail.data.recording_url} style={{ width: '100%' }} />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted small">Could not load this call.</p>
        )}
      </Modal>
    </div>
  )
}
