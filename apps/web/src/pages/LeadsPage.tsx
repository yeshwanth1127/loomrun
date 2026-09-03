import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Calendar,
  Check,
  ChevronDown,
  Columns,
  Mail,
  MessageCircle,
  Package,
  Phone,
  Plus,
  Send,
  Table2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { CallbackScheduleFields, type CallbackPreset } from '../components/CallbackScheduleFields'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { KanbanSkeleton, TableSkeleton } from '../components/ui/Skeleton'
import { isOwnerRole, membershipForOrg } from '../lib/membership'
import { apiFetch, apiUpload } from '../lib/api'
import {
  CALL_STATUS_MAP,
  CALL_STATUS_OPTIONS,
} from '../lib/callStatus'
import {
  activeFollowUpAt,
  isFollowUpOverdue,
  localDateTimeToIso,
  toLocalDateInput,
  toLocalTimeInput,
  tomorrowAt10Local,
} from '../lib/followUp'
import { fmtINR, timeAgo } from '../lib/format'

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
  last_call_outcome?: string | null
  last_call_logged_by?: string | null
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
const OPEN_STAGES = STAGES.filter((s) => s !== 'WON' && s !== 'LOST')
const CLOSED_STAGES = ['WON', 'LOST'] as const

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

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function fmtDateTime(dt: string) {
  return new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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

function LeadDetailDrawer({ lead, orgId, onClose, onStageChange, onDeleted }: {
  lead: Lead
  orgId: string
  onClose: () => void
  onStageChange: (stage: string) => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { me } = useAuth()
  const isOwner = isOwnerRole(membershipForOrg(me, orgId))
  const [activityType, setActivityType] = useState('NOTE')
  const [activityBody, setActivityBody] = useState('')
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<Lead>>({})
  const [shareOpen, setShareOpen] = useState(false)
  const [showCreateOrder, setShowCreateOrder] = useState(false)
  const [orderQuotationId, setOrderQuotationId] = useState('')
  const [drawerTab, setDrawerTab] = useState<'overview' | 'activity' | 'production'>('overview')
  const [pendingCallOutcome, setPendingCallOutcome] = useState<string | null>(null)
  const [cbDate, setCbDate] = useState(() => toLocalDateInput(lead.next_follow_up_at))
  const [cbTime, setCbTime] = useState(() => toLocalTimeInput(lead.next_follow_up_at) || '10:00')
  const [cbPreset, setCbPreset] = useState<CallbackPreset>('custom')
  const shareRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDrawerTab('overview')
    setShowCreateOrder(false)
    setOrderQuotationId('')
    setShareOpen(false)
    setPendingCallOutcome(null)
    setCbDate(toLocalDateInput(lead.next_follow_up_at))
    setCbTime(toLocalTimeInput(lead.next_follow_up_at) || '10:00')
    setCbPreset('custom')
  }, [lead.id])

  const detailQ = useQuery({
    queryKey: ['lead-detail', orgId, lead.id],
    queryFn: () => apiFetch<Lead>(`/v1/orgs/${orgId}/leads/${lead.id}`),
    initialData: lead,
  })

  // Board/list lead is updated optimistically; merge so Call status / stage show immediately.
  const detail: Lead = {
    ...(detailQ.data ?? lead),
    stage: lead.stage,
    last_call_outcome: lead.last_call_outcome ?? detailQ.data?.last_call_outcome ?? null,
  }

  const displayedCallOutcome = pendingCallOutcome ?? detail.last_call_outcome ?? ''
  const canSetCallStatus = detail.stage !== 'WON' && detail.stage !== 'LOST'
  const callbackSchedulerVisible = canSetCallStatus && displayedCallOutcome === 'CALLBACK_SCHEDULED'

  function applyCallbackFields(next: { date: string; time: string; preset: CallbackPreset }) {
    setCbDate(next.date)
    setCbTime(next.time)
    setCbPreset(next.preset)
  }

  function seedCallbackIfEmpty() {
    if (cbDate.trim()) return
    const p = tomorrowAt10Local()
    setCbDate(p.date)
    setCbTime(p.time)
    setCbPreset('tomorrow')
  }

  function invalidateLeadSurfaces() {
    void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, lead.id] })
    void qc.invalidateQueries({ queryKey: ['leads', orgId] })
    void qc.invalidateQueries({ queryKey: ['tele-summary', orgId] })
    void qc.invalidateQueries({ queryKey: ['follow-ups', orgId] })
    void qc.invalidateQueries({ queryKey: ['follow-ups-due', orgId] })
  }

  const ordersQ = useQuery({
    queryKey: ['lead-orders', orgId, lead.id],
    enabled: !!orgId && isOwner,
    queryFn: () =>
      apiFetch<{ items: Array<{ id: string; order_number: string; stage: string; delay_flag: boolean }> }>(
        `/v1/orgs/${orgId}/production?lead_id=${lead.id}&day=all`,
      ),
  })

  const quotationsQ = useQuery({
    queryKey: ['lead-quotations', orgId, lead.id],
    enabled: !!orgId && isOwner && showCreateOrder,
    queryFn: () =>
      apiFetch<{ items: Array<{ id: string; lead_id: string; number: string; total: number }> }>(
        `/v1/orgs/${orgId}/quotations?day=all`,
      ),
  })

  const quotationsForLead = (quotationsQ.data?.items ?? []).filter((q) => q.lead_id === lead.id)

  const createOrder = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; order_number: string }>(`/v1/orgs/${orgId}/production`, {
        method: 'POST',
        json: {
          lead_id: lead.id,
          quotation_id: orderQuotationId || null,
        },
      }),
    onSuccess: (data) => {
      toast.success(`Order ${data.order_number} created`)
      setShowCreateOrder(false)
      setOrderQuotationId('')
      void qc.invalidateQueries({ queryKey: ['lead-orders', orgId, lead.id] })
      void qc.invalidateQueries({ queryKey: ['production', orgId] })
      navigate('/app/production')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create order'),
  })

  useEffect(() => {
    if (!shareOpen) return
    function onDocClick(e: MouseEvent) {
      if (!shareRef.current?.contains(e.target as Node)) setShareOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShareOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [shareOpen])

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

  const logCallStatus = useMutation({
    mutationFn: ({ outcome, nextCallAt }: { outcome: string; nextCallAt?: string | null }) =>
      apiFetch(`/v1/orgs/${orgId}/telecaller/calls`, {
        method: 'POST',
        json: {
          lead_id: lead.id,
          outcome,
          next_call_at: nextCallAt ?? null,
        },
      }),
    onMutate: async ({ outcome, nextCallAt }) => {
      await qc.cancelQueries({ queryKey: ['lead-detail', orgId, lead.id] })
      await qc.cancelQueries({ queryKey: ['leads', orgId] })
      const prevDetail = qc.getQueryData<Lead>(['lead-detail', orgId, lead.id])
      const prevLeads = qc.getQueriesData<{ items: Lead[] }>({ queryKey: ['leads', orgId] })
      const nextFollowUp = outcome === 'CALLBACK_SCHEDULED' ? (nextCallAt ?? null) : null
      qc.setQueryData<Lead>(['lead-detail', orgId, lead.id], (old) =>
        old
          ? {
              ...old,
              last_call_outcome: outcome,
              next_follow_up_at: nextFollowUp,
            }
          : old,
      )
      qc.setQueriesData<{ items: Lead[] }>({ queryKey: ['leads', orgId] }, (old) => {
        if (!old?.items) return old
        return {
          ...old,
          items: old.items.map((l) =>
            l.id === lead.id
              ? {
                  ...l,
                  last_call_outcome: outcome,
                  next_follow_up_at: nextFollowUp,
                }
              : l,
          ),
        }
      })
      return { prevDetail, prevLeads }
    },
    onSuccess: (_data, vars) => {
      setPendingCallOutcome(null)
      toast.success(vars.outcome === 'CALLBACK_SCHEDULED' ? 'Follow-up scheduled' : 'Call status updated')
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(['lead-detail', orgId, lead.id], ctx.prevDetail)
      ctx?.prevLeads?.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error(err.message || 'Failed to update call status')
    },
    onSettled: () => {
      invalidateLeadSurfaces()
    },
  })

  function saveCallback() {
    if (!cbDate.trim()) {
      toast.error('Pick a follow-up date for Follow Up')
      return
    }
    const nextCallAt = localDateTimeToIso(cbDate, cbTime)
    if (!nextCallAt) {
      toast.error('Pick a follow-up date for Follow Up')
      return
    }
    logCallStatus.mutate({ outcome: 'CALLBACK_SCHEDULED', nextCallAt })
  }

  const updateLead = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch(`/v1/orgs/${orgId}/leads/${lead.id}`, { method: 'PATCH', json: data }),
    onSuccess: (_data, vars) => {
      setEditingField(null)
      setEditValues({})
      void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, lead.id] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      if ('next_follow_up_at' in vars) {
        void qc.invalidateQueries({ queryKey: ['follow-ups', orgId] })
        void qc.invalidateQueries({ queryKey: ['follow-ups-due', orgId] })
      }
    },
  })

  const sendQuote = useMutation({
    mutationFn: async (channel: 'whatsapp' | 'email') => {
      if (channel === 'whatsapp' && !detail.phone) {
        throw new Error('This lead has no phone number')
      }
      if (channel === 'email' && !detail.email) {
        throw new Error('This lead has no email address')
      }

      const { items } = await apiFetch<{
        items: Array<{
          id: string
          lead_id: string
          pdf_url: string | null
          number: string
          status: string
        }>
      }>(`/v1/orgs/${orgId}/quotations?day=all`)

      const forLead = items.filter((q) => q.lead_id === lead.id)
      const ready = forLead.find((q) => !!q.pdf_url)
      if (!ready) {
        const draft = forLead.find((q) => !q.pdf_url)
        navigate('/app/quotations')
        if (draft) {
          throw new Error(
            `Quotation ${draft.number} is still a draft — open Actions → Generate PDF before sending`,
          )
        }
        throw new Error('No quotation for this lead yet — create one on Quotations')
      }

      return apiFetch<{ message?: string; channel: string }>(
        `/v1/orgs/${orgId}/quotations/${ready.id}/send`,
        {
          method: 'POST',
          json: { channel, doc_type: 'quotation' },
        },
      )
    },
    onSuccess: (data) => {
      setShareOpen(false)
      const via = data.channel === 'whatsapp' ? 'WhatsApp' : 'Email'
      toast.success(data.message ?? `Quotation sent via ${via}`)
      void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, lead.id] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to send quotation')
    },
  })

  const deleteLead = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/leads/${lead.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Lead deleted')
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      void qc.removeQueries({ queryKey: ['lead-detail', orgId, lead.id] })
      onDeleted()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete lead'),
  })

  function confirmDelete() {
    const name = detail.title || 'this lead'
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return
    deleteLead.mutate()
  }

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
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--foreground)', marginBottom: '0.25rem' }}>
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
                {detail.last_call_outcome && (
                  <span className={`badge ${CALL_STATUS_MAP[detail.last_call_outcome]?.color ?? 'badge-slate'}`}>
                    {CALL_STATUS_MAP[detail.last_call_outcome]?.label ?? detail.last_call_outcome}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button type="button" className="btn-logout" onClick={onClose} style={{ marginTop: '0.1rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="drawer-body" style={{ paddingTop: 0, gap: 0 }}>
          {/* Quick Actions — sticky above tabs */}
          <div className="quick-actions" style={{ paddingTop: '1.1rem', marginBottom: '0.25rem' }}>
            {detail.phone && (
              <a href={`tel:${detail.phone}`} className="quick-action-btn">
                <Phone size={13} /> Call
              </a>
            )}
            {detail.phone && (
              <a href={`https://wa.me/${detail.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="quick-action-btn">
                <MessageCircle size={13} /> WhatsApp
              </a>
            )}
            {detail.email && (
              <a href={`mailto:${detail.email}`} className="quick-action-btn">
                <Mail size={13} /> Gmail
              </a>
            )}
            <div className="quick-action-dropdown" ref={shareRef}>
              <button
                type="button"
                className="quick-action-btn primary"
                aria-haspopup="menu"
                aria-expanded={shareOpen}
                disabled={sendQuote.isPending}
                onClick={() => setShareOpen((v) => !v)}
              >
                <Send size={13} />
                {sendQuote.isPending ? 'Sending…' : 'Send Quote'}
                <ChevronDown size={13} />
              </button>
              {shareOpen && (
                <div className="quick-action-menu" role="menu">
                  <button
                    type="button"
                    className="quick-action-menu-item"
                    role="menuitem"
                    disabled={sendQuote.isPending || !detail.phone}
                    title={
                      detail.phone
                        ? `Send quotation on WhatsApp to ${detail.phone}`
                        : 'This lead has no phone number'
                    }
                    onClick={() => sendQuote.mutate('whatsapp')}
                  >
                    <MessageCircle size={13} /> WhatsApp
                  </button>
                  <button
                    type="button"
                    className="quick-action-menu-item"
                    role="menuitem"
                    disabled={sendQuote.isPending || !detail.email}
                    title={
                      detail.email
                        ? `Email quotation to ${detail.email}`
                        : 'This lead has no email address'
                    }
                    onClick={() => sendQuote.mutate('email')}
                  >
                    <Mail size={13} /> Gmail
                  </button>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <select
                className="select"
                value={detail.stage}
                style={{ fontSize: '0.8rem', paddingRight: '1.8rem' }}
                onChange={(e) => {
                  onStageChange(e.target.value)
                  updateLead.mutate({ stage: e.target.value })
                  if (e.target.value === 'WON' || e.target.value === 'LOST') setPendingCallOutcome(null)
                }}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            {canSetCallStatus && (
              <div style={{ position: 'relative' }}>
                <select
                  className="select"
                  value={displayedCallOutcome}
                  disabled={logCallStatus.isPending}
                  style={{ fontSize: '0.8rem', paddingRight: '1.8rem', minWidth: '11rem' }}
                  onChange={(e) => {
                    const next = e.target.value
                    if (!next) return
                    if (next === 'CALLBACK_SCHEDULED') {
                      setPendingCallOutcome(next)
                      seedCallbackIfEmpty()
                      return
                    }
                    setPendingCallOutcome(null)
                    logCallStatus.mutate({ outcome: next })
                  }}
                >
                  <option value="" disabled>Call status…</option>
                  {CALL_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              className="quick-action-btn danger"
              disabled={deleteLead.isPending}
              onClick={confirmDelete}
            >
              <Trash2 size={13} />
              {deleteLead.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>

          {callbackSchedulerVisible && (
            <div style={{ margin: '0.75rem 0 0.25rem' }}>
              <CallbackScheduleFields
                date={cbDate}
                time={cbTime}
                preset={cbPreset}
                onChange={applyCallbackFields}
              />
              <div className="row" style={{ gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={logCallStatus.isPending}
                  onClick={saveCallback}
                >
                  <Calendar size={13} />
                  {logCallStatus.isPending
                    ? 'Saving…'
                    : pendingCallOutcome === 'CALLBACK_SCHEDULED' || detail.last_call_outcome !== 'CALLBACK_SCHEDULED'
                      ? 'Save follow-up'
                      : 'Update follow-up'}
                </button>
                {pendingCallOutcome === 'CALLBACK_SCHEDULED' && (
                  <span className="muted small">Pick a date and time, then save to add this lead to Follow ups.</span>
                )}
              </div>
            </div>
          )}

          <div className="panel-tabs" style={{ margin: '0.75rem -1.5rem 0', paddingLeft: '1.5rem', paddingRight: '1.5rem' }}>
            <button
              type="button"
              className={`panel-tab${drawerTab === 'overview' ? ' active' : ''}`}
              onClick={() => setDrawerTab('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              className={`panel-tab${drawerTab === 'activity' ? ' active' : ''}`}
              onClick={() => setDrawerTab('activity')}
            >
              Activity
            </button>
            {isOwner && (
              <button
                type="button"
                className={`panel-tab${drawerTab === 'production' ? ' active' : ''}`}
                onClick={() => setDrawerTab('production')}
              >
                Production
              </button>
            )}
          </div>

          <div style={{ paddingTop: '1.1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {drawerTab === 'overview' && (
              <div className="drawer-section" style={{ borderTop: 'none', paddingTop: 0 }}>
                <div className="drawer-section-title">Lead Info</div>
                <div className="info-grid">
                  <InfoField label="Phone" value={detail.phone} onEdit={(v) => updateLead.mutate({ phone: v })} />
                  <InfoField label="Email" value={detail.email} onEdit={(v) => updateLead.mutate({ email: v })} />
                  <InfoField label="City" value={detail.city} onEdit={(v) => updateLead.mutate({ city: v })} />
                  <InfoField label="Company" value={detail.company} onEdit={(v) => updateLead.mutate({ company: v })} />
                  <InfoField label="Product Interest" value={detail.product_interest} onEdit={(v) => updateLead.mutate({ product_interest: v })} />
                  <InfoField label="Quantity" value={detail.quantity_estimate} onEdit={(v) => updateLead.mutate({ quantity_estimate: v })} />
                  {callbackSchedulerVisible ? (
                    <div className="info-field">
                      <label>Follow-up</label>
                      <div className="value">
                        {localDateTimeToIso(cbDate, cbTime) || detail.next_follow_up_at
                          ? fmtDateTime(localDateTimeToIso(cbDate, cbTime) ?? detail.next_follow_up_at!)
                          : <span className="muted small">Set date/time above</span>}
                      </div>
                    </div>
                  ) : (
                    <InfoField
                      label="Follow-up"
                      value={
                        activeFollowUpAt(detail.next_follow_up_at, detail.last_call_outcome)
                          ? fmtDateTime(detail.next_follow_up_at!)
                          : null
                      }
                      editValue={
                        detail.last_call_outcome === 'CALLBACK_SCHEDULED'
                          ? toDatetimeLocalValue(detail.next_follow_up_at)
                          : undefined
                      }
                      onEdit={(v) => {
                        if (detail.last_call_outcome !== 'CALLBACK_SCHEDULED') {
                          toast.error('Set Call status to Follow Up to schedule a follow-up')
                          return
                        }
                        if (!v.trim()) {
                          toast.error('Follow-up date/time is required for Follow Up')
                          return
                        }
                        const iso = v.includes('T')
                          ? localDateTimeToIso(v.slice(0, 10), v.slice(11, 16))
                          : new Date(v).toISOString()
                        updateLead.mutate({ next_follow_up_at: iso })
                      }}
                      inputType="datetime-local"
                    />
                  )}
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
            )}

            {drawerTab === 'activity' && (
              <>
                <div className="drawer-section" style={{ borderTop: 'none', paddingTop: 0 }}>
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
              </>
            )}

            {drawerTab === 'production' && isOwner && (
              <div className="drawer-section" style={{ borderTop: 'none', paddingTop: 0 }}>
                <div className="drawer-section-title">Production</div>
                {detail.stage === 'WON' && (ordersQ.data?.items.length ?? 0) === 0 && (
                  <p className="muted small" style={{ marginBottom: '0.5rem' }}>
                    Lead won — create an order to start tracking production.
                  </p>
                )}
                {(ordersQ.data?.items ?? []).length > 0 && (
                  <div className="stack" style={{ gap: '0.4rem', marginBottom: '0.75rem' }}>
                    {ordersQ.data!.items.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className="quick-action-btn"
                        style={{ justifyContent: 'space-between' }}
                        onClick={() => navigate('/app/production')}
                      >
                        <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{o.order_number}</span>
                        <span className="badge badge-slate">{o.stage.replace(/_/g, ' ')}</span>
                      </button>
                    ))}
                  </div>
                )}
                {showCreateOrder ? (
                  <div className="stack" style={{ gap: '0.5rem' }}>
                    <select
                      className="select"
                      value={orderQuotationId}
                      onChange={(e) => setOrderQuotationId(e.target.value)}
                    >
                      <option value="">No quotation linked</option>
                      {quotationsForLead.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.number} — ₹{q.total.toLocaleString('en-IN')}
                        </option>
                      ))}
                    </select>
                    <div className="row" style={{ gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={createOrder.isPending}
                        onClick={() => createOrder.mutate()}
                      >
                        {createOrder.isPending ? 'Creating…' : 'Create order'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          setShowCreateOrder(false)
                          setOrderQuotationId('')
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`quick-action-btn ${detail.stage === 'WON' ? 'primary' : ''}`}
                    onClick={() => setShowCreateOrder(true)}
                  >
                    <Package size={13} /> Create order
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function InfoField({ label, value, onEdit, inputType = 'text', multiline = false, editValue }: {
  label: string
  value: string | null | undefined
  onEdit: (v: string) => void
  inputType?: string
  multiline?: boolean
  editValue?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(editValue ?? value ?? '')
    setEditing(true)
  }
  function commit() {
    setEditing(false)
    const baseline = editValue ?? value ?? ''
    if (draft !== baseline) onEdit(draft)
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
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [source, setSource] = useState('MANUAL')
  const [productInterest, setProductInterest] = useState('')
  const [quantityEstimate, setQuantityEstimate] = useState('')
  const [notes, setNotes] = useState('')
  const [value, setValue] = useState('')

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/leads`, {
        method: 'POST',
        json: {
          title,
          source,
          stage: 'NEW',
          company: company || undefined,
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
      toast.success('Lead created')
      onCreated()
      onClose()
    },
    onError: (e) => toast.error((e as Error).message),
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
              <div className="form-field" style={{ flex: 1.5 }}>
                <label className="input-label">Company Name</label>
                <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme Textiles" style={{ width: '100%' }} />
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

const SAMPLE_LEADS_CSV = `name,phone,email,company,city,source,stage,product,quantity,notes,value,date
Rahul Sharma,9876543210,rahul@acme.com,Acme Textiles,Surat,IndiaMART,Quoted,Polo t-shirts,500,Repeat buyer,25000,2024-08-15
Priya Patel,9123456789,priya@example.com,Patel Exports,Mumbai,WhatsApp,New,Uniforms,200,,12000,2024-09-01
`

type CsvImportResult = {
  created: number
  skipped: number
  errors: string[]
  warnings: string[]
  column_mapping: Record<string, string>
}

function ImportCsvModal({ orgId, onClose, onImported }: {
  orgId: string
  onClose: () => void
  onImported: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<CsvImportResult | null>(null)

  const upload = useMutation({
    mutationFn: (f: File) =>
      apiUpload<CsvImportResult>(`/v1/orgs/${orgId}/leads/upload-csv`, f),
    onSuccess: (data) => {
      setResult(data)
      if (data.created > 0) {
        toast.success(`${data.created} lead${data.created === 1 ? '' : 's'} imported`)
        onImported()
      } else if (data.skipped > 0) {
        toast.message('No new leads — existing matches were skipped')
      }
    },
    onError: (e) => toast.error((e as Error).message),
  })

  function downloadSample() {
    const blob = new Blob([SAMPLE_LEADS_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'loomrun-leads-sample.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2>Import leads from CSV</h2>
          <button type="button" className="btn-logout" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body stack" style={{ gap: '0.75rem' }}>
          <p className="muted small" style={{ margin: 0 }}>
            Upload an old spreadsheet export. Columns are detected automatically
            (name, phone, email, company, city, source, stage, product, notes, value, date).
            Existing leads with the same phone or email are skipped. Historical imports
            do not send WhatsApp greetings.
          </p>
          <p className="muted small" style={{ margin: 0 }}>
            If the file includes a date column, those dates are kept — switch the date
            filter to All to see older leads.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={downloadSample} style={{ alignSelf: 'flex-start' }}>
            Download sample CSV
          </button>
          <label className="btn btn-sm" style={{ cursor: upload.isPending ? 'wait' : 'pointer', alignSelf: 'flex-start' }}>
            <Upload size={14} />
            {file ? file.name : 'Choose CSV file'}
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              disabled={upload.isPending}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                e.target.value = ''
                setFile(f)
                setResult(null)
              }}
            />
          </label>
          {result && (
            <div className="small" style={{ marginTop: '0.25rem' }}>
              <p style={{ margin: 0 }}>
                Imported {result.created}
                {result.skipped ? ` · skipped ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'}` : ''}
              </p>
              {result.column_mapping && Object.keys(result.column_mapping).length > 0 && (
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
                  {Object.entries(result.column_mapping).map(([k, v]) => (
                    <li key={k}>{k} → {v}</li>
                  ))}
                </ul>
              )}
              {result.warnings?.length ? (
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem', color: 'var(--warning)' }}>
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              ) : null}
              {result.errors?.length ? (
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }} className="error">
                  {result.errors.slice(0, 12).map((err, i) => <li key={i}>{err}</li>)}
                </ul>
              ) : null}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          <button
            type="button"
            className="btn"
            disabled={!file || upload.isPending}
            onClick={() => file && upload.mutate(file)}
          >
            {upload.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
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
  const meta = lead.company || lead.product_interest || null
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
      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)', marginBottom: '0.35rem', lineHeight: 1.3 }}>
        {lead.title}
      </div>
      {meta && <div className="kanban-card-meta">{meta}</div>}
      <div className="row" style={{ gap: '0.35rem', marginBottom: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="source-pill">{SOURCE_LABELS[lead.source] ?? lead.source}</span>
        <span className={`score-badge ${sc}`} style={{ fontSize: '0.65rem' }}>{lead.lead_score}</span>
        {lead.last_call_outcome && (
          <span className={`badge ${CALL_STATUS_MAP[lead.last_call_outcome]?.color ?? 'badge-slate'}`} style={{ fontSize: '0.65rem' }}>
            {CALL_STATUS_MAP[lead.last_call_outcome]?.label ?? lead.last_call_outcome}
          </span>
        )}
      </div>
      <div className="muted small" style={{ fontSize: '0.7rem' }}>
        {[lead.city, timeAgo(lead.updated_at)].filter(Boolean).join(' · ')}
      </div>
      {(() => {
        const followUp = activeFollowUpAt(lead.next_follow_up_at, lead.last_call_outcome)
        if (!followUp) return null
        const overdue = isFollowUpOverdue(lead.next_follow_up_at, lead.last_call_outcome)
        return (
          <span className={`row small ${overdue ? 'error' : 'muted'}`} style={{ gap: '0.2rem', fontSize: '0.7rem' }}>
            <Calendar size={10} />
            {fmtDate(followUp)}
            {overdue && ' · overdue'}
          </span>
        )
      })()}
    </div>
  )
}

// ── Board View ────────────────────────────────────────────────────────────────

function BoardView({ leads, onSelectLead, onStageChange }: {
  leads: Lead[]
  onSelectLead: (lead: Lead) => void
  onStageChange: (id: string, stage: string) => void
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const closedCount = leads.filter((l) => l.stage === 'WON' || l.stage === 'LOST').length
  const visibleStages = showClosed ? STAGES : OPEN_STAGES

  function handleDrop(stage: string) {
    if (draggedId && draggedId !== stage) {
      const lead = leads.find((l) => l.id === draggedId)
      if (lead && lead.stage !== stage) onStageChange(draggedId, stage)
    }
    setDraggedId(null)
    setDragOverStage(null)
  }

  return (
    <div className="kanban-wrap">
      <div className="kanban-closed-toggle">
        <button
          type="button"
          className={`btn btn-sm ${showClosed ? 'btn-secondary' : 'btn-ghost'}`}
          onClick={() => setShowClosed((v) => !v)}
        >
          {showClosed ? 'Hide closed' : `Show closed (${closedCount})`}
        </button>
        {!showClosed && closedCount > 0 && (
          <span className="muted small">
            {CLOSED_STAGES.map((s) => `${STAGE_LABELS[s]} ${leads.filter((l) => l.stage === s).length}`).join(' · ')}
          </span>
        )}
      </div>
      <div className="kanban-board">
        {visibleStages.map((stage) => {
          const colLeads = leads.filter((l) => l.stage === stage)
          const est = colLeads.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0)
          return (
            <div className="kanban-col" key={stage}>
              <div className="kanban-col-header">
                <span className="kanban-col-title">{STAGE_LABELS[stage]}</span>
                <span className="kanban-col-count">{colLeads.length}</span>
                {est > 0 && <span className="kanban-col-est">{fmtINR(est)}</span>}
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
                  <div className="muted" style={{ fontSize: '0.75rem', textAlign: 'center', padding: '1.5rem 0.5rem', opacity: 0.55 }}>
                    Drop leads here
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Table View ────────────────────────────────────────────────────────────────

function TableView({ leads, onSelectLead }: {
  leads: Lead[]
  onSelectLead: (lead: Lead) => void
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
            <SortTh label="Company" k="company" />
            <SortTh label="Stage" k="stage" />
            <SortTh label="Score" k="lead_score" />
            <SortTh label="Follow-up" k="next_follow_up_at" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const sc = scoreClass(l.lead_score)
            return (
              <tr key={l.id} onClick={() => onSelectLead(l)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.title}</div>
                  {l.phone && <div className="muted small">{l.phone}</div>}
                </td>
                <td>
                  <span className="muted small">{l.company ?? '—'}</span>
                </td>
                <td>
                  <span className={`badge ${STAGE_COLOR[l.stage] ?? 'badge-slate'}`}>
                    {STAGE_LABELS[l.stage] ?? l.stage}
                  </span>
                </td>
                <td>
                  <span className={`score-badge ${sc}`}>{l.lead_score}</span>
                </td>
                <td>
                  <span className={`small ${isFollowUpOverdue(l.next_follow_up_at, l.last_call_outcome) ? 'error' : 'muted'}`}>
                    {activeFollowUpAt(l.next_follow_up_at, l.last_call_outcome)
                      ? fmtDateTime(activeFollowUpAt(l.next_follow_up_at, l.last_call_outcome)!)
                      : '—'}
                    {isFollowUpOverdue(l.next_follow_up_at, l.last_call_outcome) && ' · overdue'}
                  </span>
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
  const { orgId, me } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const isOwner = isOwnerRole(membershipForOrg(me, orgId))
  const qc = useQueryClient()
  const [view, setView] = useState<'board' | 'table'>('board')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
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
  appendDay(params)
  const qs = params.toString()

  const q = useQuery({
    queryKey: ['leads', orgId, qs, dayParam],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads?${qs}`),
    refetchInterval: 10_000,
  })

  useEffect(() => {
    if (q.error) {
      toast.error((q.error as Error).message)
    }
  }, [q.error])

  const updateStage = useMutation({
    mutationFn: (p: { id: string; stage: string }) =>
      apiFetch(`/v1/orgs/${orgId}/leads/${p.id}`, { method: 'PATCH', json: { stage: p.stage } }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ['leads', orgId] })
      const previous = qc.getQueriesData<{ items: Lead[] }>({ queryKey: ['leads', orgId] })
      qc.setQueriesData<{ items: Lead[] }>({ queryKey: ['leads', orgId] }, (old) => {
        if (!old?.items) return old
        return {
          ...old,
          items: old.items.map((l) => (l.id === id ? { ...l, stage } : l)),
        }
      })
      void qc.setQueryData<Lead>(['lead-detail', orgId, id], (old) =>
        old ? { ...old, stage } : old,
      )
      return { previous }
    },
    onError: (err: Error, _vars, ctx) => {
      ctx?.previous?.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error(err.message || 'Failed to update stage')
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      if (vars?.id) void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, vars.id] })
    },
  })

  function handleStageChange(id: string, stage: string) {
    updateStage.mutate({ id, stage })
    if (selectedLead?.id === id) {
      setSelectedLead((prev) => (prev ? { ...prev, stage } : null))
    }
  }

  if (!orgId) return (
    <PageHeader title="Leads" description="Select an organization to view leads." />
  )

  const leads = q.data?.items ?? []
  const filtersActive = Object.values(filters).some(Boolean)

  return (
    <div className={view === 'board' ? 'leads-page leads-page--board' : 'leads-page'}>
      <PageHeader
        title="Leads"
        description={
          <>
            {leads.length} lead{leads.length !== 1 ? 's' : ''}
            {isAll ? '' : ` · Created ${dayParam}`}
          </>
        }
        actions={
          <>
            {isOwner && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowImportModal(true)}>
                <Upload size={15} /> Import CSV
              </button>
            )}
            <button type="button" className="btn" onClick={() => setShowAddModal(true)}>
              <Plus size={15} /> Add Lead
            </button>
          </>
        }
        toolbar={
          <>
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
            <div className="filter-toolbar filter-toolbar-inline">
              <input
                className="input"
                type="search"
                placeholder="Search name, phone…"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              />
              <select
                className="select"
                value={filters.source}
                onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
              >
                <option value="">All Sources</option>
                {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
              </select>
              <select
                className="select"
                value={filters.stage}
                onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}
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
              />
              <input
                className="input"
                type="number"
                placeholder="Score max"
                value={filters.score_max}
                onChange={(e) => setFilters((f) => ({ ...f, score_max: e.target.value }))}
              />
              {filtersActive ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFilters({ source: '', stage: '', search: '', score_min: '', score_max: '' })}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </>
        }
      />

      <div className={view === 'board' ? 'page-body page-body--board' : 'page-body'}>
        {q.isLoading && (view === 'board' ? <KanbanSkeleton /> : <TableSkeleton rows={8} />)}

        {!q.isLoading && leads.length === 0 && (
          <EmptyState
            title="No leads found"
            description="Add your first lead or connect an integration."
            action={
              <div className="row" style={{ gap: '0.5rem', justifyContent: 'center' }}>
                <button type="button" className="btn" onClick={() => setShowAddModal(true)}>
                  <Plus size={15} /> Add Lead
                </button>
                {isOwner && (
                  <NavLink to="/app/leads/connections" className="btn btn-secondary">
                    Integrations
                  </NavLink>
                )}
              </div>
            }
          />
        )}

        {leads.length > 0 && view === 'board' && (
          <BoardView
            leads={leads}
            onSelectLead={setSelectedLead}
            onStageChange={handleStageChange}
          />
        )}

        {leads.length > 0 && view === 'table' && (
          <TableView
            leads={leads}
            onSelectLead={setSelectedLead}
          />
        )}
      </div>

      {/* Add Lead Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <AddLeadModal
              orgId={orgId}
              onClose={() => setShowAddModal(false)}
              onCreated={() => void qc.invalidateQueries({ queryKey: ['leads', orgId] })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImportModal && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <ImportCsvModal
              orgId={orgId}
              onClose={() => setShowImportModal(false)}
              onImported={() => void qc.invalidateQueries({ queryKey: ['leads', orgId] })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lead Detail Drawer */}
      <AnimatePresence>
        {selectedLead && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <LeadDetailDrawer
              lead={leads.find((l) => l.id === selectedLead.id) ?? selectedLead}
              orgId={orgId}
              onClose={() => setSelectedLead(null)}
              onStageChange={(stage) => handleStageChange(selectedLead.id, stage)}
              onDeleted={() => setSelectedLead(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
