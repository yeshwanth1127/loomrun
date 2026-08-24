import { useQuery } from '@tanstack/react-query'
import { Calendar, MessageCircle, Phone } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { TableSkeleton } from '../components/ui/Skeleton'
import { apiFetch } from '../lib/api'

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
  CALLBACK_SCHEDULED: 'Call Back',
  QUALIFIED: 'Qualified',
  CONNECTED_INTERESTED: 'Connected - Interested',
  CONNECTED_NOT_INTERESTED: 'Connected - Not Interested',
  RINGING_NO_RESPONSE: 'Ringing - No Response',
  SWITCHED_OFF: 'Switched Off / Not Reachable',
  ORDER_CONFIRMED: 'Order Confirmed',
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function bucketFor(dt: string | null): 'overdue' | 'today' | 'upcoming' | 'unscheduled' {
  if (!dt) return 'unscheduled'
  const today = startOfDay(new Date())
  const due = startOfDay(new Date(dt))
  if (due.getTime() < today.getTime()) return 'overdue'
  if (due.getTime() === today.getTime()) return 'today'
  return 'upcoming'
}

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtRelative(dt: string) {
  const today = startOfDay(new Date())
  const due = startOfDay(new Date(dt))
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)} days overdue`
  return `in ${diff} days`
}

function reasonFor(lead: FollowUpLead): string | null {
  if (lead.last_call_notes && lead.last_call_notes.trim()) return lead.last_call_notes.trim()
  if (lead.notes && lead.notes.trim()) return lead.notes.trim()
  if (lead.last_call_outcome) return CALL_OUTCOME_LABELS[lead.last_call_outcome] ?? lead.last_call_outcome
  return null
}

function FollowUpRow({ lead }: { lead: FollowUpLead }) {
  const reason = reasonFor(lead)
  const overdue = bucketFor(lead.next_follow_up_at) === 'overdue'
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{lead.title}</div>
        {lead.company && <div className="muted small">{lead.company}</div>}
        {lead.product_interest && <div className="muted small">{lead.product_interest}</div>}
      </td>
      <td>
        <span className={`badge ${STAGE_COLOR[lead.stage] ?? 'badge-slate'}`}>
          {STAGE_LABELS[lead.stage] ?? lead.stage}
        </span>
      </td>
      <td>
        <div className={`row small ${overdue ? 'error' : ''}`} style={{ gap: '0.3rem', fontWeight: 600 }}>
          <Calendar size={12} />
          {fmtDate(lead.next_follow_up_at)}
        </div>
        {lead.next_follow_up_at && (
          <div className={`small ${overdue ? 'error' : 'muted'}`}>{fmtRelative(lead.next_follow_up_at)}</div>
        )}
      </td>
      <td>
        {reason ? (
          <span className="small" style={{ whiteSpace: 'pre-wrap' }}>{reason}</span>
        ) : (
          <span className="muted small">—</span>
        )}
      </td>
      <td>
        <span className="muted small">{lead.last_call_logged_by ?? '—'}</span>
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: '0.4rem' }}>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="quick-action-btn" title="Call">
              <Phone size={13} />
            </a>
          )}
          {lead.phone && (
            <a
              href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer"
              className="quick-action-btn"
              title="WhatsApp"
            >
              <MessageCircle size={13} />
            </a>
          )}
        </div>
      </td>
    </tr>
  )
}

const SECTIONS: { key: 'overdue' | 'today' | 'upcoming' | 'unscheduled'; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'unscheduled', label: 'No date set' },
]

export function FollowUpsPage() {
  const { orgId } = useAuth()

  const qs = new URLSearchParams({ last_call_outcome: 'CALLBACK_SCHEDULED', day: 'all' }).toString()

  const q = useQuery({
    queryKey: ['follow-ups', orgId, qs],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: FollowUpLead[] }>(`/v1/orgs/${orgId}/leads?${qs}`),
  })

  useEffect(() => {
    if (q.error) toast.error((q.error as Error).message)
  }, [q.error])

  if (!orgId) {
    return (
      <div className="page-header">
        <h1>Follow ups</h1>
        <p className="muted">Select an organization to view follow ups.</p>
      </div>
    )
  }

  const leads = q.data?.items ?? []
  const grouped: Record<string, FollowUpLead[]> = { overdue: [], today: [], upcoming: [], unscheduled: [] }
  for (const lead of leads) {
    grouped[bucketFor(lead.next_follow_up_at)].push(lead)
  }

  return (
    <div className="leads-page">
      <div className="page-header">
        <div className="row spread" style={{ paddingBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1>Follow ups</h1>
            <p style={{ marginTop: '0.15rem', marginBottom: 0 }}>
              {leads.length} lead{leads.length !== 1 ? 's' : ''} marked “Callback scheduled” by the telecaller
            </p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {q.isLoading && <TableSkeleton rows={8} />}

        {!q.isLoading && leads.length === 0 && (
          <div className="empty-state card">
            <p>No callbacks scheduled. Leads appear here when a telecaller logs a call with the “Call Back” outcome.</p>
          </div>
        )}

        {!q.isLoading &&
          leads.length > 0 &&
          SECTIONS.map(({ key, label }) => {
            const rows = grouped[key]
            if (rows.length === 0) return null
            return (
              <div key={key} style={{ marginBottom: '1.5rem' }}>
                <div className="row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h2 style={{ margin: 0, fontSize: '0.95rem' }}>{label}</h2>
                  <span className={`badge ${key === 'overdue' ? 'badge-red' : key === 'today' ? 'badge-amber' : 'badge-slate'}`}>
                    {rows.length}
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Lead</th>
                        <th>Stage</th>
                        <th>Follow-up date</th>
                        <th>Reason</th>
                        <th>Telecaller</th>
                        <th>Contact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((lead) => (
                        <FollowUpRow key={lead.id} lead={lead} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}
