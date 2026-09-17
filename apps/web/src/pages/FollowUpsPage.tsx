import { useQuery } from '@tanstack/react-query'
import { Calendar, MessageCircle, Phone, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState } from '../components/ui/EmptyState'
import { FilterToolbar } from '../components/ui/FilterToolbar'
import { PageHeader } from '../components/ui/PageHeader'
import { InsightCard, InsightGrid, MetricCard } from '../components/ui/dashboard'
import { TableSkeleton } from '../components/ui/Skeleton'
import { useAuth } from '../context/AuthContext'
import { routes } from '../lib/appRoutes'
import { apiFetch } from '../lib/api'
import {
  followUpBucket,
  fmtDateTime,
  fmtFollowUpRelative,
  type FollowUpBucket,
} from '../lib/followUp'
import { fmtPct } from '../lib/format'

type FollowUpLead = {
  id: string
  title: string
  stage: string
  source: string
  company: string | null
  phone: string | null
  product_interest: string | null
  notes: string | null
  next_follow_up_at: string | null
  last_call_outcome?: string | null
  last_call_logged_by?: string | null
  last_call_notes?: string | null
  last_call_at?: string | null
}

const STAGE_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFICATION: 'Requirement Collected',
  QUOTATION: 'Quoted',
  NEGOTIATION: 'Negotiation',
  SAMPLE: 'Sample Sent',
  WON: 'Won',
  LOST: 'Lost',
}

const STAGE_COLOR: Record<string, string> = {
  NEW: 'badge-slate',
  CONTACTED: 'badge-blue',
  QUALIFICATION: 'badge-indigo',
  QUOTATION: 'badge-purple',
  NEGOTIATION: 'badge-amber',
  SAMPLE: 'badge-amber',
  WON: 'badge-green',
  LOST: 'badge-red',
}

const CALL_OUTCOME_LABELS: Record<string, string> = {
  CONNECTED: 'Connected',
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  WRONG_NUMBER: 'Wrong number',
  NOT_INTERESTED: 'Not interested',
  CALLBACK_SCHEDULED: 'Follow Up',
  QUALIFIED: 'Qualified',
  CONNECTED_INTERESTED: 'Connected - Interested',
  CONNECTED_NOT_INTERESTED: 'Connected - Not Interested',
  RINGING_NO_RESPONSE: 'Ringing - No Response',
  SWITCHED_OFF: 'Switched Off / Not Reachable',
  ORDER_CONFIRMED: 'Order Confirmed',
}

type TabKey = 'all' | 'today' | 'overdue'

function reasonFor(lead: FollowUpLead): string | null {
  if (lead.last_call_notes && lead.last_call_notes.trim()) return lead.last_call_notes.trim()
  if (lead.notes && lead.notes.trim()) return lead.notes.trim()
  if (lead.last_call_outcome) return CALL_OUTCOME_LABELS[lead.last_call_outcome] ?? lead.last_call_outcome
  return null
}

function statusLabel(bucket: FollowUpBucket) {
  if (bucket === 'overdue' || bucket === 'due_now') return { label: bucket === 'overdue' ? 'Overdue' : 'Due now', cls: 'badge-red' }
  if (bucket === 'later_today') return { label: 'Due today', cls: 'badge-green' }
  if (bucket === 'upcoming') return { label: 'Scheduled', cls: 'badge-blue' }
  return { label: 'Unscheduled', cls: 'badge-slate' }
}

function FollowUpRow({ lead }: { lead: FollowUpLead }) {
  const navigate = useNavigate()
  const reason = reasonFor(lead)
  const bucket = followUpBucket(lead.next_follow_up_at)
  const overdue = bucket === 'overdue' || bucket === 'due_now'
  const status = statusLabel(bucket)

  return (
    <tr
      onClick={() => navigate(`/app/telecaller?lead=${encodeURIComponent(lead.id)}`)}
      title="Open in Telecaller"
    >
      <td>
        <div style={{ fontWeight: 600 }}>{lead.title}</div>
        {lead.phone && <div className="muted small">{lead.phone}</div>}
        {lead.company && <div className="muted small">{lead.company}</div>}
      </td>
      <td>
        <span className={`badge ${STAGE_COLOR[lead.stage] ?? 'badge-slate'}`}>
          {STAGE_LABELS[lead.stage] ?? lead.stage}
        </span>
      </td>
      <td>
        <span className="badge badge-purple">Follow Up</span>
      </td>
      <td>
        <div className={overdue ? 'error' : ''}>{fmtDateTime(lead.next_follow_up_at)}</div>
        {lead.next_follow_up_at && (
          <div className={`small ${overdue ? 'error' : 'muted'}`}>{fmtFollowUpRelative(lead.next_follow_up_at)}</div>
        )}
      </td>
      <td>
        <span className={`badge ${status.cls}`}>{status.label}</span>
      </td>
      <td className="muted small" style={{ maxWidth: 220 }}>
        {reason ?? '—'}
      </td>
      <td className="muted small">{lead.last_call_logged_by ?? '—'}</td>
      <td className="muted small">
        {lead.last_call_at ? fmtDateTime(lead.last_call_at) : '—'}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: '0.35rem' }}>
          <Link
            to={`/app/telecaller?lead=${encodeURIComponent(lead.id)}`}
            className="btn btn-ghost btn-sm"
            title="Open in Telecaller"
          >
            <Phone size={14} /> Call
          </Link>
          {lead.phone && (
            <a className="btn btn-ghost btn-sm" href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
              <MessageCircle size={14} />
            </a>
          )}
        </div>
      </td>
    </tr>
  )
}

export function FollowUpsPage() {
  const { orgId } = useAuth()
  const [tab, setTab] = useState<TabKey>('all')
  const [search, setSearch] = useState('')

  const qs = new URLSearchParams({ last_call_outcome: 'CALLBACK_SCHEDULED', day: 'all' }).toString()

  const q = useQuery({
    queryKey: ['follow-ups', orgId, qs],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: FollowUpLead[] }>(`/v1/orgs/${orgId}/leads?${qs}`),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (q.error) toast.error((q.error as Error).message)
  }, [q.error])

  const leads = q.data?.items ?? []
  const grouped = useMemo(() => {
    const buckets: Record<FollowUpBucket, FollowUpLead[]> = {
      overdue: [],
      due_now: [],
      later_today: [],
      upcoming: [],
      unscheduled: [],
    }
    for (const lead of leads) {
      buckets[followUpBucket(lead.next_follow_up_at)].push(lead)
    }
    return buckets
  }, [leads])

  const dueToday = grouped.due_now.length + grouped.later_today.length
  const overdue = grouped.overdue.length
  const quoted = leads.filter((l) => ['QUOTATION', 'NEGOTIATION', 'SAMPLE', 'WON'].includes(l.stage)).length
  const won = leads.filter((l) => l.stage === 'WON').length

  const visible = useMemo(() => {
    const qtext = search.trim().toLowerCase()
    return leads.filter((lead) => {
      const bucket = followUpBucket(lead.next_follow_up_at)
      if (tab === 'today' && bucket !== 'due_now' && bucket !== 'later_today') return false
      if (tab === 'overdue' && bucket !== 'overdue' && bucket !== 'due_now') return false
      if (!qtext) return true
      return [lead.title, lead.phone, lead.company, lead.notes].some((v) =>
        (v ?? '').toLowerCase().includes(qtext),
      )
    })
  }, [leads, tab, search])

  if (!orgId) {
    return (
      <PageHeader title="Follow ups" description="Select an organization to view follow ups." />
    )
  }

  return (
    <div className="leads-page">
      <PageHeader
        title="Follow ups"
        badge={`${leads.length} scheduled`}
        description="Stay on top of every follow-up and never miss one."
        actions={
          <Link to="/app/telecaller" className="btn">
            <Plus size={15} /> Schedule follow-up
          </Link>
        }
        toolbar={
          <>
            <div className="panel-tabs" style={{ padding: 0, background: 'transparent' }}>
              {([
                ['all', `All follow ups (${leads.length})`],
                ['today', `Due today (${dueToday})`],
                ['overdue', `Overdue (${overdue})`],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`panel-tab${tab === id ? ' active' : ''}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <FilterToolbar collapsible={false}>
              <input
                className="input"
                placeholder="Search leads, phone, notes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: 220 }}
              />
            </FilterToolbar>
          </>
        }
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        <div className="metrics-grid">
          <MetricCard icon={Calendar} tone="purple" label="Total follow ups" value={leads.length} hint="Scheduled" />
          <MetricCard icon={Calendar} tone="green" label="Due today" value={dueToday} hint="High priority" />
          <MetricCard icon={Calendar} tone="amber" label="Overdue" value={overdue} hint="Requires action" />
          <MetricCard icon={Calendar} tone="blue" label="Upcoming" value={grouped.upcoming.length} hint="Later dates" />
          <MetricCard
            icon={Calendar}
            tone="purple"
            label="Conversion from follow ups"
            value={fmtPct(quoted, leads.length)}
            hint={`${quoted} to quotes · ${won} orders`}
          />
        </div>

        {q.isLoading && <TableSkeleton rows={5} />}
        {!q.isLoading && leads.length === 0 && (
          <EmptyState
            icon={Calendar}
            description="No follow-ups scheduled. Leads appear here when a telecaller logs a call with the “Follow Up” outcome."
          />
        )}

        {visible.length > 0 && (
          <div className="table-wrap follow-ups-table">
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Stage</th>
                  <th>Type</th>
                  <th>Next follow-up</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Owner</th>
                  <th>Last contact</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((lead) => (
                  <FollowUpRow key={lead.id} lead={lead} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!q.isLoading && leads.length > 0 && visible.length === 0 && (
          <EmptyState description="No follow-ups match this filter." />
        )}

        <InsightGrid>
          <InsightCard title="Follow-up insights">
            <div className="stack" style={{ gap: '0.45rem', fontSize: '0.85rem' }}>
              <div className="row spread"><span className="muted">Due today</span><strong>{dueToday}</strong></div>
              <div className="row spread"><span className="muted">Overdue</span><strong>{overdue}</strong></div>
              <div className="row spread"><span className="muted">Unscheduled</span><strong>{grouped.unscheduled.length}</strong></div>
            </div>
          </InsightCard>
          <InsightCard title="Conversion impact">
            <div className="stack" style={{ gap: '0.45rem', fontSize: '0.85rem' }}>
              <div className="row spread"><span>Quoted / negotiation</span><strong>{quoted}</strong></div>
              <div className="row spread"><span>Orders (won)</span><strong>{won}</strong></div>
            </div>
          </InsightCard>
          <InsightCard title="Quick actions">
            <div className="quick-action-list">
              <Link to="/app/telecaller"><Phone size={14} /> Make a call</Link>
              <Link to={routes.settings('whatsapp')}><MessageCircle size={14} /> WhatsApp follow-up</Link>
            </div>
          </InsightCard>
        </InsightGrid>
      </div>
    </div>
  )
}
