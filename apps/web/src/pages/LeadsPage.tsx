import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  Check,
  Columns,
  MessageCircle,
  Phone,
  Plus,
  Send,
  Table2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

// ── Types ────────────────────────────────────────────────────────────────────

type Lead = {
  id: string
  title: string
  stage: string
  source: string
  lead_status: string
  company: string | null
  phone: string | null
  email: string | null
  city: string | null
  product_interest: string | null
  quantity_estimate: string | null
  lead_score: number
  tags: string[]
  notes: string | null
  assignee_id: string | null
  next_follow_up_at: string | null
  last_activity_at: string | null
  estimated_value: number | null
  created_at: string
  updated_at: string
  activities?: Activity[]
  assignee?: { id: string; name: string | null; email: string } | null
}

type Activity = {
  id: string
  type: string
  body: string
  user_id: string | null
  created_at: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGES = ['NEW', 'CONTACTED', 'QUALIFICATION', 'QUOTATION', 'NEGOTIATION', 'SAMPLE', 'WON', 'LOST']

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

const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  TELECALLER: 'Telecaller',
  INSTAGRAM: 'Instagram',
  WEB: 'Website',
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  META_ADS: 'Meta Ads',
  GOOGLE_ADS: 'Google Ads',
  INDIAMART: 'IndiaMART',
  MANUAL: 'Manual',
  OTHER: 'Other',
}

const SOURCES = ['META_ADS', 'GOOGLE_ADS', 'INDIAMART', 'WHATSAPP', 'INSTAGRAM', 'WEBSITE', 'REFERRAL', 'TELECALLER', 'MANUAL', 'OTHER']

const ACTIVITY_ICONS: Record<string, string> = {
  CALL: '📞',
  WHATSAPP: '💬',
  EMAIL: '✉️',
  NOTE: '📝',
  STAGE_CHANGE: '🔄',
  ASSIGNMENT: '👤',
  SYSTEM: '⚙️',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreClass(score: number) {
  if (score >= 70) return 'green'
  if (score >= 30) return 'amber'
  return 'red'
}

function isOverdue(dt: string | null) {
  if (!dt) return false
  return new Date(dt) < new Date()
}

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function fmtDateTime(dt: string) {
  return new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 20
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  const color = score >= 70 ? '#10b981' : score >= 30 ? '#f59e0b' : '#ef4444'
  return (
    <div className="score-ring">
      <svg width="52" height="52" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r={r} fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
        <circle
          cx="26" cy="26" r={r}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 26 26)"
        />
      </svg>
      <div className="score-ring-value">{score}</div>
    </div>
  )
}

// ── Lead Detail Drawer ────────────────────────────────────────────────────────

function LeadDetailDrawer({ lead, orgId, onClose, onStageChange }: {
  lead: Lead
  orgId: string
  onClose: () => void
  onStageChange: (stage: string) => void
}) {
  const qc = useQueryClient()
  const [activityType, setActivityType] = useState('NOTE')
  const [activityBody, setActivityBody] = useState('')
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<Lead>>({})

  const detailQ = useQuery({
    queryKey: ['lead-detail', orgId, lead.id],
    queryFn: () => apiFetch<Lead>(`/v1/orgs/${orgId}/leads/${lead.id}`),
    initialData: lead,
  })

  const detail = detailQ.data ?? lead

  const addActivity = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/leads/${lead.id}/activities`, {
        method: 'POST',
        json: { type: activityType, body: activityBody },
      }),
    onSuccess: () => {
      setActivityBody('')
      void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, lead.id] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
    },
  })

  const updateLead = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch(`/v1/orgs/${orgId}/leads/${lead.id}`, { method: 'PATCH', json: data }),
    onSuccess: () => {
      setEditingField(null)
      setEditValues({})
      void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, lead.id] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
    },
  })

  const sc = scoreClass(detail.lead_score)

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        {/* Header */}
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flex: 1, minWidth: 0 }}>
            <ScoreRing score={detail.lead_score} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a', marginBottom: '0.25rem' }}>
                {detail.title}
              </div>
              <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                <span className={`badge ${STAGE_COLOR[detail.stage] ?? 'badge-slate'}`}>
                  {STAGE_LABELS[detail.stage] ?? detail.stage}
                </span>
                <span className="badge badge-slate">
                  {SOURCE_LABELS[detail.source] ?? detail.source}
                </span>
                <span className={`score-badge ${sc}`}>{detail.lead_score} pts</span>
              </div>
            </div>
          </div>
          <button type="button" className="btn-logout" onClick={onClose} style={{ marginTop: '0.1rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="drawer-body">
          {/* Quick Actions */}
          <div className="quick-actions">
            {detail.phone && (
              <a href={`tel:${detail.phone}`} className="quick-action-btn">
                <Phone size={13} /> Call
              </a>
            )}
            {detail.phone && (
              <a href={`https://wa.me/${detail.phone?.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="quick-action-btn">
                <MessageCircle size={13} /> WhatsApp
              </a>
            )}
            <button type="button" className="quick-action-btn primary">
              <Send size={13} /> Send Quote
            </button>
            <div style={{ position: 'relative' }}>
              <select
                className="select"
                value={detail.stage}
                style={{ fontSize: '0.8rem', paddingRight: '1.8rem' }}
                onChange={(e) => {
                  onStageChange(e.target.value)
                  updateLead.mutate({ stage: e.target.value })
                }}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Lead Info */}
          <div className="drawer-section">
            <div className="drawer-section-title">Lead Info</div>
            <div className="info-grid">
              <InfoField label="Phone" value={detail.phone} onEdit={(v) => updateLead.mutate({ phone: v })} />
              <InfoField label="Email" value={detail.email} onEdit={(v) => updateLead.mutate({ email: v })} />
              <InfoField label="City" value={detail.city} onEdit={(v) => updateLead.mutate({ city: v })} />
              <InfoField label="Company" value={detail.company} onEdit={(v) => updateLead.mutate({ company: v })} />
              <InfoField label="Product Interest" value={detail.product_interest} onEdit={(v) => updateLead.mutate({ product_interest: v })} />
              <InfoField label="Quantity" value={detail.quantity_estimate} onEdit={(v) => updateLead.mutate({ quantity_estimate: v })} />
              <InfoField
                label="Follow-up"
                value={detail.next_follow_up_at ? fmtDate(detail.next_follow_up_at) : null}
                onEdit={(v) => updateLead.mutate({ next_follow_up_at: v ? new Date(v).toISOString() : null })}
                inputType="date"
              />
              <InfoField
                label="Est. Value (₹)"
                value={detail.estimated_value != null ? String(detail.estimated_value) : null}
                onEdit={(v) => updateLead.mutate({ estimated_value: v ? Number(v) : null })}
                inputType="number"
              />
            </div>
            {(detail.notes !== null || editingField === 'notes') && (
              <div style={{ marginTop: '0.75rem' }}>
                <InfoField
                  label="Notes"
                  value={detail.notes}
                  multiline
                  onEdit={(v) => updateLead.mutate({ notes: v })}
                />
              </div>
            )}
            {!detail.notes && editingField !== 'notes' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}
                onClick={() => setEditingField('notes')}
              >
                <Plus size={12} /> Add note
              </button>
            )}
          </div>

          {/* Add Activity */}
          <div className="drawer-section">
            <div className="drawer-section-title">Log Activity</div>
            <div className="stack" style={{ gap: '0.5rem' }}>
              <div className="row" style={{ gap: '0.5rem' }}>
                <select className="select" value={activityType} onChange={(e) => setActivityType(e.target.value)} style={{ flex: '0 0 auto' }}>
                  <option value="CALL">📞 Call</option>
                  <option value="WHATSAPP">💬 WhatsApp</option>
                  <option value="EMAIL">✉️ Email</option>
                  <option value="NOTE">📝 Note</option>
                </select>
                <input
                  className="input"
                  placeholder="What happened…"
                  value={activityBody}
                  onChange={(e) => setActivityBody(e.target.value)}
                  style={{ flex: 1 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && activityBody.trim()) void addActivity.mutateAsync()
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!activityBody.trim() || addActivity.isPending}
                  onClick={() => { if (activityBody.trim()) void addActivity.mutateAsync() }}
                >
                  <Check size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="drawer-section">
            <div className="drawer-section-title">Activity Timeline</div>
            {detailQ.isLoading && <p className="muted small">Loading…</p>}
            {detail.activities && detail.activities.length > 0 ? (
              <div className="timeline">
                {detail.activities.map((act) => (
                  <div className="timeline-item" key={act.id}>
                    <div className="timeline-dot" style={{ fontSize: '0.7rem' }}>
                      {ACTIVITY_ICONS[act.type] ?? '•'}
                    </div>
                    <div className="timeline-content">
                      <p>{act.body}</p>
                      <time>{fmtDateTime(act.created_at)}</time>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">No activity yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function InfoField({ label, value, onEdit, inputType = 'text', multiline = false }: {
  label: string
  value: string | null | undefined
  onEdit: (v: string) => void
  inputType?: string
  multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(value ?? '')
    setEditing(true)
  }
  function commit() {
    setEditing(false)
    if (draft !== (value ?? '')) onEdit(draft)
  }

  return (
    <div className="info-field">
      <label>{label}</label>
      {editing ? (
        <div className="row" style={{ gap: '0.25rem' }}>
          {multiline ? (
            <textarea
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              style={{ width: '100%', resize: 'vertical' }}
              onBlur={commit}
            />
          ) : (
            <input
              className="input"
              type={inputType}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              style={{ flex: 1, fontSize: '0.875rem' }}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
            />
          )}
        </div>
      ) : (
        <div
          className="value"
          onClick={startEdit}
          style={{ cursor: 'pointer', padding: '0.2rem 0', minHeight: '1.4rem', borderRadius: '4px' }}
          title="Click to edit"
        >
          {value ?? <span className="muted small">—</span>}
        </div>
      )}
    </div>
  )
}

// ── Add Lead Modal ────────────────────────────────────────────────────────────

function AddLeadModal({ orgId, onClose, onCreated }: {
  orgId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [source, setSource] = useState('MANUAL')
  const [productInterest, setProductInterest] = useState('')
  const [quantityEstimate, setQuantityEstimate] = useState('')
  const [notes, setNotes] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/leads`, {
        method: 'POST',
        json: {
          title,
          source,
          stage: 'NEW',
          phone: phone || undefined,
          email: email || undefined,
          city: city || undefined,
          product_interest: productInterest || undefined,
          quantity_estimate: quantityEstimate || undefined,
          notes: notes || undefined,
          estimated_value: value ? Number(value) : undefined,
        },
      }),
    onSuccess: () => {
      onCreated()
      onClose()
    },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <div className="modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-header">
          <h2>Add Lead</h2>
          <button type="button" className="btn-logout" onClick={onClose}><X size={18} /></button>
        </div>
        <form
          onSubmit={(e: FormEvent) => { e.preventDefault(); if (title.trim()) void create.mutateAsync() }}
        >
          <div className="modal-body stack" style={{ gap: '0.75rem' }}>
            <div className="row" style={{ gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 2 }}>
                <label className="input-label">Name / Title *</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rahul Sharma — 500 pcs" required style={{ width: '100%' }} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label className="input-label">Source</label>
                <select className="select" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: '100%' }}>
                  {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
                </select>
              </div>
            </div>
            <div className="row" style={{ gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label className="input-label">Phone</label>
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 9000000000" style={{ width: '100%' }} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label className="input-label">Email</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" style={{ width: '100%' }} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label className="input-label">City</label>
                <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mumbai" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="row" style={{ gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 2 }}>
                <label className="input-label">Product Interest</label>
                <input className="input" value={productInterest} onChange={(e) => setProductInterest(e.target.value)} placeholder="e.g. Corporate T-shirts" style={{ width: '100%' }} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label className="input-label">Quantity</label>
                <input className="input" value={quantityEstimate} onChange={(e) => setQuantityEstimate(e.target.value)} placeholder="e.g. 500 pcs" style={{ width: '100%' }} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label className="input-label">Est. Value (₹)</label>
                <input className="input" type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="form-field">
              <label className="input-label">Notes</label>
              <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any relevant details…" rows={2} style={{ width: '100%', resize: 'vertical' }} />
            </div>
            {error && <p className="error">{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Kanban Card ───────────────────────────────────────────────────────────────

function KanbanCard({ lead, onDragStart, onDragEnd, onClick }: {
  lead: Lead
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onClick: () => void
}) {
  const sc = scoreClass(lead.lead_score)
  return (
    <div
      className={`kanban-card score-${sc}`}
      draggable
      onDragStart={(e: DragEvent) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(lead.id) }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
    >
      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0f172a', marginBottom: '0.4rem', lineHeight: 1.3 }}>
        {lead.title}
      </div>
      <div className="row" style={{ gap: '0.35rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
        <span className="badge badge-slate" style={{ fontSize: '0.65rem' }}>
          {SOURCE_LABELS[lead.source] ?? lead.source}
        </span>
        <span className={`score-badge ${sc}`} style={{ fontSize: '0.65rem' }}>{lead.lead_score}</span>
      </div>
      {lead.product_interest && (
        <div className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.35rem' }}>{lead.product_interest}</div>
      )}
      <div className="row" style={{ gap: '0.5rem', justifyContent: 'space-between', marginTop: '0.25rem' }}>
        {lead.next_follow_up_at ? (
          <span className={`row small ${isOverdue(lead.next_follow_up_at) ? 'error' : 'muted'}`} style={{ gap: '0.2rem', fontSize: '0.7rem' }}>
            <Calendar size={10} />
            {fmtDate(lead.next_follow_up_at)}
            {isOverdue(lead.next_follow_up_at) && ' · overdue'}
          </span>
        ) : <span />}
        {lead.assignee_id && (
          <div className="user-avatar" style={{ width: 20, height: 20, fontSize: '0.55rem' }}>
            {lead.assignee_id.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Board View ────────────────────────────────────────────────────────────────

function BoardView({ leads, orgId, onSelectLead, onStageChange }: {
  leads: Lead[]
  orgId: string
  onSelectLead: (lead: Lead) => void
  onStageChange: (id: string, stage: string) => void
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)

  function handleDrop(stage: string) {
    if (draggedId && draggedId !== stage) {
      const lead = leads.find((l) => l.id === draggedId)
      if (lead && lead.stage !== stage) onStageChange(draggedId, stage)
    }
    setDraggedId(null)
    setDragOverStage(null)
  }

  return (
    <div className="kanban-board">
      {STAGES.map((stage) => {
        const colLeads = leads.filter((l) => l.stage === stage)
        return (
          <div className="kanban-col" key={stage}>
            <div className="kanban-col-header">
              <span className="kanban-col-title">{STAGE_LABELS[stage]}</span>
              <span className="kanban-col-count">{colLeads.length}</span>
            </div>
            <div
              className={`kanban-col-body${dragOverStage === stage ? ' drag-over' : ''}`}
              onDragOver={(e: DragEvent) => { e.preventDefault(); setDragOverStage(stage) }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={() => handleDrop(stage)}
            >
              {colLeads.map((lead) => (
                <KanbanCard
                  key={lead.id}
                  lead={lead}
                  onDragStart={setDraggedId}
                  onDragEnd={() => { setDraggedId(null); setDragOverStage(null) }}
                  onClick={() => onSelectLead(lead)}
                />
              ))}
              {colLeads.length === 0 && (
                <div className="muted" style={{ fontSize: '0.75rem', textAlign: 'center', padding: '1.5rem 0', opacity: 0.5 }}>
                  Drop here
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Table View ────────────────────────────────────────────────────────────────

function TableView({ leads, orgId, onSelectLead, onStageChange }: {
  leads: Lead[]
  orgId: string
  onSelectLead: (lead: Lead) => void
  onStageChange: (id: string, stage: string) => void
}) {
  const [sortKey, setSortKey] = useState<keyof Lead>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: keyof Lead) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = [...leads].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })

  function SortTh({ label, k }: { label: string; k: keyof Lead }) {
    return (
      <th onClick={() => toggleSort(k)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    )
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortTh label="Name" k="title" />
            <SortTh label="Phone" k="phone" />
            <SortTh label="Source" k="source" />
            <SortTh label="Product" k="product_interest" />
            <SortTh label="Score" k="lead_score" />
            <th>Stage</th>
            <SortTh label="Follow-up" k="next_follow_up_at" />
            <SortTh label="Last Activity" k="last_activity_at" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const sc = scoreClass(l.lead_score)
            return (
              <tr key={l.id} onClick={() => onSelectLead(l)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.title}</div>
                  {l.company && <div className="muted small">{l.company}</div>}
                </td>
                <td>
                  <span className="muted small">{l.phone ?? '—'}</span>
                </td>
                <td>
                  <span className="badge badge-slate">{SOURCE_LABELS[l.source] ?? l.source}</span>
                </td>
                <td>
                  <span className="muted small">{l.product_interest ?? '—'}</span>
                </td>
                <td>
                  <span className={`score-badge ${sc}`}>{l.lead_score}</span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    className="select"
                    value={l.stage}
                    style={{ fontSize: '0.78rem', padding: '0.2rem 0.5rem' }}
                    onChange={(e) => onStageChange(l.id, e.target.value)}
                  >
                    {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </select>
                </td>
                <td>
                  <span className={`small ${isOverdue(l.next_follow_up_at) ? 'error' : 'muted'}`}>
                    {fmtDate(l.next_follow_up_at)}
                    {isOverdue(l.next_follow_up_at) && ' · overdue'}
                  </span>
                </td>
                <td>
                  <span className="muted small">{l.last_activity_at ? fmtDate(l.last_activity_at) : '—'}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function LeadsPage() {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const [view, setView] = useState<'board' | 'table'>('board')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [filters, setFilters] = useState({
    source: '',
    stage: '',
    search: '',
    score_min: '',
    score_max: '',
  })

  const params = new URLSearchParams()
  if (filters.source) params.set('source', filters.source)
  if (filters.stage) params.set('stage', filters.stage)
  if (filters.search) params.set('search', filters.search)
  if (filters.score_min) params.set('score_min', filters.score_min)
  if (filters.score_max) params.set('score_max', filters.score_max)
  const qs = params.toString()

  const q = useQuery({
    queryKey: ['leads', orgId, qs],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads${qs ? `?${qs}` : ''}`),
  })

  const updateStage = useMutation({
    mutationFn: (p: { id: string; stage: string }) =>
      apiFetch(`/v1/orgs/${orgId}/leads/${p.id}`, { method: 'PATCH', json: { stage: p.stage } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['leads', orgId] }),
  })

  function handleStageChange(id: string, stage: string) {
    updateStage.mutate({ id, stage })
    if (selectedLead?.id === id) {
      setSelectedLead((prev) => prev ? { ...prev, stage } : null)
    }
  }

  if (!orgId) return (
    <><div className="page-header"><h1>Leads</h1><p className="muted">Select an organization to view leads.</p></div></>
  )

  const leads = q.data?.items ?? []

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="row spread" style={{ paddingBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1>Leads</h1>
            <p style={{ marginTop: '0.15rem', marginBottom: 0 }}>
              {leads.length} lead{leads.length !== 1 ? 's' : ''} · Manage your sales pipeline
            </p>
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <NavLink to="/app/leads/connections" className="btn btn-ghost btn-sm">
              Integrations
            </NavLink>
            <button type="button" className="btn" onClick={() => setShowAddModal(true)}>
              <Plus size={15} /> Add Lead
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="row" style={{ gap: '0.5rem', paddingBottom: '0.875rem', flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Search name, phone…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            style={{ minWidth: 180, flex: '1 1 180px' }}
          />
          <select
            className="select"
            value={filters.source}
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
            style={{ minWidth: 130 }}
          >
            <option value="">All Sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
          </select>
          <select
            className="select"
            value={filters.stage}
            onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}
            style={{ minWidth: 160 }}
          >
            <option value="">All Stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
          <input
            className="input"
            type="number"
            placeholder="Score min"
            value={filters.score_min}
            onChange={(e) => setFilters((f) => ({ ...f, score_min: e.target.value }))}
            style={{ width: 100 }}
          />
          <input
            className="input"
            type="number"
            placeholder="Score max"
            value={filters.score_max}
            onChange={(e) => setFilters((f) => ({ ...f, score_max: e.target.value }))}
            style={{ width: 100 }}
          />
          {Object.values(filters).some(Boolean) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFilters({ source: '', stage: '', search: '', score_min: '', score_max: '' })}
            >
              Clear
            </button>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <div className="view-toggle">
              <button
                type="button"
                className={`view-toggle-btn${view === 'board' ? ' active' : ''}`}
                onClick={() => setView('board')}
              >
                <Columns size={14} /> Board
              </button>
              <button
                type="button"
                className={`view-toggle-btn${view === 'table' ? ' active' : ''}`}
                onClick={() => setView('table')}
              >
                <Table2 size={14} /> Table
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="page-body" style={{ padding: view === 'board' ? '1.25rem 1.5rem' : '1.5rem 2rem' }}>
        {q.isLoading && <p className="muted">Loading leads…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {!q.isLoading && leads.length === 0 && (
          <div className="empty-state card">
            <p>No leads found. Add your first lead or connect an integration.</p>
          </div>
        )}

        {leads.length > 0 && view === 'board' && (
          <BoardView
            leads={leads}
            orgId={orgId}
            onSelectLead={setSelectedLead}
            onStageChange={handleStageChange}
          />
        )}

        {leads.length > 0 && view === 'table' && (
          <TableView
            leads={leads}
            orgId={orgId}
            onSelectLead={setSelectedLead}
            onStageChange={handleStageChange}
          />
        )}
      </div>

      {/* Add Lead Modal */}
      {showAddModal && (
        <AddLeadModal
          orgId={orgId}
          onClose={() => setShowAddModal(false)}
          onCreated={() => void qc.invalidateQueries({ queryKey: ['leads', orgId] })}
        />
      )}

      {/* Lead Detail Drawer */}
      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          orgId={orgId}
          onClose={() => setSelectedLead(null)}
          onStageChange={(stage) => handleStageChange(selectedLead.id, stage)}
        />
      )}
    </>
  )
}
