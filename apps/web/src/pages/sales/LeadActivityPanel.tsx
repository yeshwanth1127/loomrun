import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { apiFetch } from '../../lib/api'
import { fmtDateTime } from '../../lib/followUp'
import { ACTIVITY_ICONS, type Lead, type LeadActivity } from '../../lib/leads'

const ACTIVITY_TYPES = [
  { value: 'CALL', label: '📞 Call' },
  { value: 'WHATSAPP', label: '💬 WhatsApp' },
  { value: 'EMAIL', label: '✉️ Email' },
  { value: 'NOTE', label: '📝 Note' },
]

export function LeadActivityPanel({ lead, orgId }: { lead: Lead; orgId: string }) {
  const qc = useQueryClient()
  const [type, setType] = useState('NOTE')
  const [body, setBody] = useState('')

  const detailQ = useQuery({
    queryKey: ['lead-detail', orgId, lead.id],
    enabled: !!orgId,
    queryFn: () => apiFetch<Lead>(`/v1/orgs/${orgId}/leads/${lead.id}`),
    initialData: lead,
  })

  const addActivity = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/leads/${lead.id}/activities`, {
        method: 'POST',
        json: { type, body },
      }),
    onSuccess: () => {
      setBody('')
      void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, lead.id] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const activities: LeadActivity[] = detailQ.data?.activities ?? []

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <section className="card">
        <div className="drawer-section-title">Add to the history</div>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{ flex: '0 1 160px' }}
            aria-label="Activity type"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ flex: '1 1 220px' }}
            placeholder="What happened…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && body.trim()) addActivity.mutate()
            }}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!body.trim() || addActivity.isPending}
            onClick={() => addActivity.mutate()}
          >
            <Check size={14} />
            Save
          </button>
        </div>
      </section>

      <section className="card">
        <div className="drawer-section-title">Everything that happened</div>
        {detailQ.isLoading ? (
          <p className="muted small">Loading…</p>
        ) : activities.length === 0 ? (
          <p className="muted small">Nothing recorded yet.</p>
        ) : (
          <div className="timeline">
            {activities.map((act) => (
              <div key={act.id} className="timeline-item">
                <div className="timeline-dot">{ACTIVITY_ICONS[act.type] ?? '•'}</div>
                <div className="timeline-content">
                  <p>{act.body}</p>
                  <time>{fmtDateTime(act.created_at)}</time>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
