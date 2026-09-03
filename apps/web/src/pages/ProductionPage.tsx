import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  Pencil,
  Plus,
  QrCode,
  Trash2,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { LeadSearchSelect } from '../components/LeadSearchSelect'
import { RowActions } from '../components/RowActions'
import { EmptyState } from '../components/ui/EmptyState'
import { FilterToolbar } from '../components/ui/FilterToolbar'
import { PageHeader } from '../components/ui/PageHeader'
import { BarList, DonutChart, DonutLegend, InsightCard, InsightGrid, MetricCard } from '../components/ui/dashboard'
import { TableSkeleton } from '../components/ui/Skeleton'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'
import { isOwnerRole, membershipForOrg } from '../lib/membership'

type Expense = {
  id: string
  category: string
  amount_cents: number
  description: string | null
  vendor: string | null
  incurred_at: string
}
type Payment = {
  id: string
  amount_cents: number
  status: string
  note: string | null
  recorded_at: string | null
}
type Pnl = {
  revenue_cents: number | null
  revenue_source: string | null
  budget_cents: number | null
  actual_cost_cents: number
  collected_cents: number
  margin_cents: number | null
  budget_variance_cents: number | null
  collection_gap_cents: number | null
  over_budget: boolean
}
type Activity = {
  id: string
  type: string
  body: string
  user_name: string | null
  created_at: string
  metadata?: {
    internal_note?: string | null
    customer_note?: string | null
    from_stage?: string
    to_stage?: string
  } | null
}
type ActivityGroup = {
  lead_id: string
  lead_title: string | null
  production_order_id: string
  activities: Activity[]
}
type Row = {
  id: string
  lead_id: string
  quotation_id: string | null
  order_number: string
  name: string | null
  display_name: string | null
  stage: string
  order_status: string
  delay_flag: boolean
  budget_cents: number | null
  expected_completion_at: string | null
  expected_dispatch_at: string | null
  actual_dispatch_at: string | null
  courier_name: string | null
  courier_tracking_no: string | null
  shipping_notes: string | null
  on_hold_reason: string | null
  days_until_dispatch: number | null
  tracking_token: string | null
  tracking_enabled: boolean
  stage_entered_at: string
  lead_title: string | null
  lead_phone: string | null
  payments: Payment[]
  expenses: Expense[]
  pnl: Pnl
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
  PACKING:        'var(--primary)',
  PAYMENT_HOLD:   '#ef4444',
  READY_DISPATCH: '#10b981',
  SHIPPED:        '#3b82f6',
  DELIVERED:      '#059669',
}

const EXPENSE_CATEGORIES = [
  'FABRIC', 'LABOR', 'OUTSOURCING', 'FREIGHT', 'CONSUMABLES', 'RENT', 'UTILITIES', 'OTHER',
]

const CATEGORY_LABELS: Record<string, string> = {
  FABRIC: 'Fabric',
  LABOR: 'Labor',
  OUTSOURCING: 'Outsourcing',
  FREIGHT: 'Freight',
  CONSUMABLES: 'Consumables',
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  OTHER: 'Other',
}

const ACTIVITY_ICONS: Record<string, string> = {
  ORDER_CREATED: '🏭',
  STAGE_CHANGED: '→',
  DELAY_TOGGLED: '⚠',
  PAYMENT_RECORDED: '₹',
  EXPENSE_RECORDED: '🧾',
  BUDGET_SET: '📊',
  NAME_CHANGED: '✎',
  NOTE_ADDED: '📝',
  STATUS_CHANGED: '⚑',
  ETA_UPDATED: '📅',
  SHIPMENT_UPDATED: '🚚',
}

const ORDER_STATUSES = ['ON_TRACK', 'AT_RISK', 'DELAYED', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const

const STATUS_LABELS: Record<string, string> = {
  ON_TRACK: 'On Track',
  AT_RISK: 'At Risk',
  DELAYED: 'Delayed',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

const STATUS_BADGE: Record<string, string> = {
  ON_TRACK: 'badge-green',
  AT_RISK: 'badge-amber',
  DELAYED: 'badge-red',
  ON_HOLD: 'badge-slate',
  COMPLETED: 'badge-green',
  CANCELLED: 'badge-red',
}

function daysAgo(dt: string) {
  const diff = Date.now() - new Date(dt).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day'
  return `${days} days`
}

function fmtDate(dt: string | null | undefined) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function toDateInput(dt: string | null | undefined) {
  if (!dt) return ''
  const d = new Date(dt)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function etaLabel(days: number | null) {
  if (days == null) return null
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (days === 0) return 'Due today'
  return `${days} day${days === 1 ? '' : 's'} remaining`
}

function fmtDateTime(dt: string) {
  return new Date(dt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function fmtINR(cents: number | null | undefined) {
  if (cents == null) return '—'
  return `₹${(cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function rupeesToCents(value: string): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function ProductionPage() {
  const { me, orgId } = useAuth()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership) || !!me?.is_super_admin
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [leadId, setLeadId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [trackingId, setTrackingId] = useState<string | null>(null)
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [budgetDraft, setBudgetDraft] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('FABRIC')
  const [expenseVendor, setExpenseVendor] = useState('')
  const [expenseDesc, setExpenseDesc] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('PAID')
  const [paymentNote, setPaymentNote] = useState('')
  const [stageModal, setStageModal] = useState<{ id: string; stage: string; label: string } | null>(null)
  const [internalNote, setInternalNote] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [etaCompletion, setEtaCompletion] = useState('')
  const [etaDispatch, setEtaDispatch] = useState('')
  const [courierName, setCourierName] = useState('')
  const [courierTracking, setCourierTracking] = useState('')
  const [shippingNotes, setShippingNotes] = useState('')
  const [filterPreset, setFilterPreset] = useState<string>('active')
  const [filterStage, setFilterStage] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [searchText, setSearchText] = useState('')
  const deferredSearch = useDeferredValue(searchText)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }))

  const q = useQuery({
    queryKey: ['production', orgId, dayParam, filterPreset, filterStage, filterStatus, deferredSearch],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      if (filterPreset) params.set('filter', filterPreset)
      if (filterStage) params.set('stage', filterStage)
      if (filterStatus) params.set('order_status', filterStatus)
      if (deferredSearch.trim()) params.set('search', deferredSearch.trim())
      return apiFetch<{ items: Row[] }>(`/v1/orgs/${orgId}/production?${params}`)
    },
  })

  const activityQ = useQuery({
    queryKey: ['production-activity-log', orgId, dayParam],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      return apiFetch<{ groups: ActivityGroup[] }>(`/v1/orgs/${orgId}/production/activity-log?${params}`)
    },
  })

  function invalidateProduction() {
    void qc.invalidateQueries({ queryKey: ['production', orgId] })
    void qc.invalidateQueries({ queryKey: ['production-activity-log', orgId] })
    void qc.invalidateQueries({ queryKey: ['expenses', orgId] })
    void qc.invalidateQueries({ queryKey: ['ceo', orgId] })
  }

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/production`, { method: 'POST', json: { lead_id: leadId } }),
    onSuccess: () => {
      setLeadId(''); setShowForm(false)
      invalidateProduction()
    },
  })

  const advance = useMutation({
    mutationFn: (p: {
      id: string
      stage: string
      internal_note?: string
      customer_note?: string
    }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}`, {
        method: 'PATCH',
        json: {
          stage: p.stage,
          internal_note: p.internal_note || null,
          customer_note: p.customer_note || null,
        },
      }),
    onSuccess: () => {
      setStageModal(null)
      setInternalNote('')
      setCustomerNote('')
      invalidateProduction()
      toast.success('Stage updated')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update stage'),
  })

  const patchOrder = useMutation({
    mutationFn: (p: { id: string; json: Record<string, unknown> }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}`, { method: 'PATCH', json: p.json }),
    onSuccess: () => {
      invalidateProduction()
      toast.success('Order updated')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update order'),
  })

  const regenTracking = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/production/${id}/tracking/regenerate`, { method: 'POST' }),
    onSuccess: () => {
      invalidateProduction()
      toast.success('Tracking link regenerated')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to regenerate link'),
  })

  const toggleTracking = useMutation({
    mutationFn: (p: { id: string; enabled: boolean }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}/tracking`, {
        method: 'PATCH',
        json: { enabled: p.enabled },
      }),
    onSuccess: (_d, vars) => {
      invalidateProduction()
      toast.success(vars.enabled ? 'Tracking enabled' : 'Tracking disabled')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update tracking'),
  })

  const shareWhatsApp = useMutation({
    mutationFn: (p: { lead_id: string; order_number: string; token: string }) => {
      const link = `${window.location.origin}/track/${p.token}`
      const message =
        `Hi! You can track your order ${p.order_number} here:\n${link}\n\n— Loomrun`
      return apiFetch<{ sent?: boolean; status?: string }>(
        `/v1/orgs/${orgId}/integrations/whatsapp/outbound`,
        {
          method: 'POST',
          json: { lead_id: p.lead_id, message },
        },
      )
    },
    onSuccess: (data) => {
      if (data?.sent === false) {
        toast.error('WhatsApp did not deliver the message. Check Integrations → WhatsApp.')
        return
      }
      toast.success('Tracking link sent on WhatsApp')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to send on WhatsApp'),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/production/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Order removed')
      invalidateProduction()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to remove order'),
  })

  const setBudget = useMutation({
    mutationFn: (p: { id: string; budget_cents: number }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}`, {
        method: 'PATCH',
        json: { budget_cents: p.budget_cents },
      }),
    onSuccess: () => {
      toast.success('Budget updated')
      setBudgetDraft('')
      invalidateProduction()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to set budget'),
  })

  const renameOrder = useMutation({
    mutationFn: (p: { id: string; name: string }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}`, {
        method: 'PATCH',
        json: { name: p.name },
      }),
    onSuccess: () => {
      toast.success('Order renamed')
      setEditingNameId(null)
      setNameDraft('')
      invalidateProduction()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to rename order'),
  })

  function startRename(row: Row) {
    setEditingNameId(row.id)
    setNameDraft(row.name ?? row.display_name ?? row.lead_title ?? '')
  }

  function saveRename(id: string) {
    const trimmed = nameDraft.trim()
    if (!trimmed) {
      toast.error('Name cannot be empty')
      return
    }
    renameOrder.mutate({ id, name: trimmed })
  }

  const addExpense = useMutation({
    mutationFn: (p: { id: string }) => {
      const cents = rupeesToCents(expenseAmount)
      if (cents == null || cents <= 0) throw new Error('Enter a valid amount')
      return apiFetch(`/v1/orgs/${orgId}/production/${p.id}/expenses`, {
        method: 'POST',
        json: {
          category: expenseCategory,
          amount_cents: cents,
          vendor: expenseVendor || null,
          description: expenseDesc || null,
        },
      })
    },
    onSuccess: () => {
      toast.success('Expense recorded')
      setExpenseAmount('')
      setExpenseVendor('')
      setExpenseDesc('')
      invalidateProduction()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to add expense'),
  })

  const addPayment = useMutation({
    mutationFn: (p: { id: string }) => {
      const cents = rupeesToCents(paymentAmount)
      if (cents == null || cents <= 0) throw new Error('Enter a valid amount')
      return apiFetch(`/v1/orgs/${orgId}/production/${p.id}/payments`, {
        method: 'POST',
        json: {
          amount_cents: cents,
          status: paymentStatus,
          note: paymentNote || null,
        },
      })
    },
    onSuccess: () => {
      toast.success('Payment recorded')
      setPaymentAmount('')
      setPaymentNote('')
      invalidateProduction()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to add payment'),
  })

  function openFinance(row: Row, opts?: { force?: boolean }) {
    if (!opts?.force && expandedId === row.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(row.id)
    setTrackingId(null)
    setBudgetDraft(row.budget_cents != null ? String(row.budget_cents / 100) : '')
    setEtaCompletion(toDateInput(row.expected_completion_at))
    setEtaDispatch(toDateInput(row.expected_dispatch_at))
    setCourierName(row.courier_name ?? '')
    setCourierTracking(row.courier_tracking_no ?? '')
    setShippingNotes(row.shipping_notes ?? '')
    setExpenseAmount('')
    setExpenseCategory('FABRIC')
    setExpenseVendor('')
    setExpenseDesc('')
    setPaymentAmount('')
    setPaymentStatus('PAID')
    setPaymentNote('')
  }

  function openTracking(row: Row, opts?: { force?: boolean }) {
    if (!opts?.force && trackingId === row.id) {
      setTrackingId(null)
      return
    }
    setTrackingId(row.id)
    setExpandedId(null)
  }

  function requestStageChange(id: string, stage: string) {
    setStageModal({ id, stage, label: STAGE_LABELS[stage] ?? stage })
    setInternalNote('')
    setCustomerNote('')
  }

  if (!orgId) return (
    <>
      <div className="page-header"><h1>Production</h1><p>Select an organization.</p></div>
    </>
  )

  const orders = q.data?.items ?? []
  const delayedCount = orders.filter((r) => r.order_status === 'DELAYED' || r.delay_flag).length
  const overrunCount = isOwner ? orders.filter((r) => r.pnl?.over_budget).length : 0
  const completedCount = orders.filter((r) => r.stage === 'DELIVERED' || r.order_status === 'COMPLETED').length
  const inProgressCount = orders.filter((r) => r.stage !== 'DELIVERED' && r.order_status !== 'COMPLETED' && r.order_status !== 'CANCELLED').length
  const statusOptions = isOwner ? ORDER_STATUSES : ORDER_STATUSES.filter((s) => s !== 'CANCELLED')

  return (
    <>
      <PageHeader
        title="Production"
        badge={`${orders.length} orders`}
        description="Track all production orders from start to finish."
        actions={
          isOwner ? (
            <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
              <Plus size={15} />
              Start order
            </button>
          ) : undefined
        }
        toolbar={
          <FilterToolbar
            defaultOpen={!!(filterPreset !== 'active' || filterStage || filterStatus || searchText)}
            trailing={
              (filterPreset !== 'active' || filterStage || filterStatus || searchText) ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setFilterPreset('active')
                    setFilterStage('')
                    setFilterStatus('')
                    setSearchText('')
                  }}
                >
                  Reset
                </button>
              ) : null
            }
          >
            <div className="form-field" style={{ margin: 0, minWidth: 160 }}>
              <label className="input-label">Search</label>
              <input
                className="input"
                placeholder="Order # or customer…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
            <div className="form-field" style={{ margin: 0 }}>
              <label className="input-label">Show</label>
              <select className="select" value={filterPreset} onChange={(e) => setFilterPreset(e.target.value)}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="delayed">Delayed</option>
                <option value="on_hold">On Hold</option>
                <option value="shipped">Shipped</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div className="form-field" style={{ margin: 0 }}>
              <label className="input-label">Stage</label>
              <select className="select" value={filterStage} onChange={(e) => setFilterStage(e.target.value)}>
                <option value="">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ margin: 0 }}>
              <label className="input-label">Status</label>
              <select className="select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
          </FilterToolbar>
        }
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        <div className="metrics-grid">
          <MetricCard icon={Zap} tone="purple" label="Total orders" value={orders.length} hint={isAll ? 'This period' : dayParam} />
          <MetricCard icon={Zap} tone="green" label="In progress" value={inProgressCount} hint={orders.length ? `${((inProgressCount / orders.length) * 100).toFixed(1)}%` : '0%'} />
          <MetricCard icon={Zap} tone="green" label="Completed" value={completedCount} hint={orders.length ? `${((completedCount / orders.length) * 100).toFixed(1)}%` : '0%'} />
          <MetricCard icon={Zap} tone="red" label="Delayed" value={delayedCount} />
          {isOwner && <MetricCard icon={Wallet} tone="amber" label="Over budget" value={overrunCount} />}
        </div>
        {isOwner && showForm && (
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
                <LeadSearchSelect
                  orgId={orgId}
                  value={leadId}
                  required
                  onChange={(id) => setLeadId(id)}
                />
              </div>
              {create.error && <p className="error">{(create.error as Error).message}</p>}
              <div className="row">
                <button type="submit" className="btn" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Start order'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {q.isLoading && <TableSkeleton rows={5} />}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {!q.isLoading && orders.length === 0 && (
          <EmptyState
            title="No orders in pipeline"
            description="Start an order from a won lead to track production."
            action={
              isOwner ? (
                <button type="button" className="btn" onClick={() => setShowForm(true)}>
                  <Plus size={15} /> Start order
                </button>
              ) : undefined
            }
          />
        )}

        {orders.length > 0 ? (
          <div className="stack" style={{ gap: '0.75rem' }}>
            {orders.map((r) => {
              const stageIdx = STAGES.indexOf(r.stage)
              const progress = ((stageIdx + 1) / STAGES.length) * 100
              const nextStage = STAGES[stageIdx + 1]
              const pnl = r.pnl
              const open = expandedId === r.id
              const trackingOpen = trackingId === r.id
              const panelOpen = open || trackingOpen

              return (
                <div
                  key={r.id}
                  className="card"
                  style={{ borderLeft: `3px solid ${r.order_status === 'DELAYED' || r.delay_flag || (isOwner && pnl?.over_budget) ? '#ef4444' : (STAGE_COLOR[r.stage] ?? '#6366f1')}` }}
                >
                  <div className="row spread" style={{ marginBottom: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editingNameId === r.id ? (
                        <form
                          className="row"
                          style={{ gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}
                          onSubmit={(e: FormEvent) => {
                            e.preventDefault()
                            saveRename(r.id)
                          }}
                        >
                          <input
                            className="input"
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            autoFocus
                            maxLength={200}
                            aria-label="Production order name"
                            style={{ maxWidth: 320, fontWeight: 700 }}
                          />
                          <button
                            type="submit"
                            className="btn btn-sm"
                            disabled={renameOrder.isPending}
                            title="Save name"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              setEditingNameId(null)
                              setNameDraft('')
                            }}
                            title="Cancel"
                          >
                            <X size={14} />
                          </button>
                        </form>
                      ) : (
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }} className="row" >
                          <span style={{ marginRight: '0.35rem', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem', color: 'var(--muted-fg)' }}>
                            {r.order_number}
                          </span>
                          <span style={{ marginRight: '0.35rem' }}>
                            {r.display_name ?? r.lead_title ?? 'Unnamed lead'}
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            style={{ padding: '0.15rem 0.35rem' }}
                            title="Rename order"
                            onClick={() => startRename(r)}
                          >
                            <Pencil size={13} />
                          </button>
                          <span className="badge badge-slate" style={{ marginLeft: '0.35rem' }}>
                            {STAGE_LABELS[r.stage] ?? r.stage}
                          </span>
                          {r.order_status && (
                            <span className={`badge ${STATUS_BADGE[r.order_status] ?? 'badge-slate'}`} style={{ marginLeft: '0.35rem' }}>
                              {STATUS_LABELS[r.order_status] ?? r.order_status}
                            </span>
                          )}
                          {isOwner && pnl?.over_budget && (
                            <span style={{ marginLeft: '0.5rem', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}>
                              Over budget
                            </span>
                          )}
                        </div>
                      )}
                      <div className="muted small">
                        {r.name && r.lead_title && r.name !== r.lead_title
                          ? `Lead: ${r.lead_title} · `
                          : ''}
                        In {STAGE_LABELS[r.stage] ?? r.stage} for {daysAgo(r.stage_entered_at)}
                        {r.expected_dispatch_at && (
                          <> · Dispatch {fmtDate(r.expected_dispatch_at)}
                            {etaLabel(r.days_until_dispatch) && (
                              <span style={{
                                color: (r.days_until_dispatch ?? 0) < 0 ? '#ef4444' : undefined,
                                fontWeight: (r.days_until_dispatch ?? 0) < 0 ? 600 : undefined,
                              }}>
                                {' '}({etaLabel(r.days_until_dispatch)})
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      {nextStage && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={advance.isPending}
                          onClick={() => requestStageChange(r.id, nextStage)}
                        >
                          <ChevronRight size={14} />
                          Next: {STAGE_LABELS[nextStage]}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn btn-sm ${open ? 'btn-secondary' : 'btn-ghost'}`}
                        onClick={() => openFinance(r)}
                      >
                        {isOwner ? <Wallet size={14} /> : <Zap size={14} />}
                        {isOwner ? 'Details' : 'Details'}
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${trackingOpen ? 'btn-secondary' : 'btn-ghost'}`}
                        onClick={() => openTracking(r)}
                      >
                        <QrCode size={14} />
                        Tracking
                      </button>
                      <RowActions label="More">
                        {(close) => (
                          <>
                            <div className="row-actions-menu-item" style={{ display: 'block', padding: '0.5rem 0.75rem' }}>
                              <label className="input-label" style={{ marginBottom: '0.25rem' }}>Stage</label>
                              <select
                                className="select"
                                value={r.stage}
                                style={{ fontSize: '0.78rem', width: '100%' }}
                                onChange={(e) => {
                                  if (e.target.value !== r.stage) requestStageChange(r.id, e.target.value)
                                  close()
                                }}
                              >
                                {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                              </select>
                            </div>
                            <div className="row-actions-menu-item" style={{ display: 'block', padding: '0.5rem 0.75rem' }}>
                              <label className="input-label" style={{ marginBottom: '0.25rem' }}>Status</label>
                              <select
                                className="select"
                                value={r.order_status}
                                style={{ fontSize: '0.78rem', width: '100%' }}
                                onChange={(e) => {
                                  if (e.target.value !== r.order_status) {
                                    patchOrder.mutate({ id: r.id, json: { order_status: e.target.value } })
                                  }
                                  close()
                                }}
                              >
                                {statusOptions.map((s) => (
                                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                                ))}
                              </select>
                            </div>
                            {isOwner && (
                              <button
                                type="button"
                                className="row-actions-menu-item"
                                style={{ color: 'var(--destructive)', width: '100%', textAlign: 'left' }}
                                disabled={remove.isPending}
                                onClick={() => {
                                  close()
                                  if (
                                    window.confirm(
                                      `Remove production order for "${r.display_name ?? r.lead_title ?? 'this lead'}"? This deletes the order and its payment/expense/activity history and cannot be undone.`,
                                    )
                                  ) {
                                    remove.mutate(r.id)
                                  }
                                }}
                              >
                                <Trash2 size={14} /> Remove order
                              </button>
                            )}
                          </>
                        )}
                      </RowActions>
                    </div>
                  </div>

                  {isOwner && open && (
                  <div
                    className="row"
                    style={{
                      gap: '1rem',
                      flexWrap: 'wrap',
                      marginBottom: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      background: 'var(--secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '0.8rem',
                    }}
                  >
                    <span><span className="muted">Revenue</span> <strong>{fmtINR(pnl?.revenue_cents)}</strong></span>
                    <span><span className="muted">Spend</span> <strong>{fmtINR(pnl?.actual_cost_cents)}</strong></span>
                    <span>
                      <span className="muted">Margin</span>{' '}
                      <strong style={{ color: (pnl?.margin_cents ?? 0) < 0 ? '#ef4444' : undefined }}>
                        {fmtINR(pnl?.margin_cents)}
                      </strong>
                    </span>
                    <span><span className="muted">Collected</span> <strong>{fmtINR(pnl?.collected_cents)}</strong></span>
                    <span><span className="muted">Budget</span> <strong>{fmtINR(pnl?.budget_cents)}</strong></span>
                  </div>
                  )}

                  <div style={{ height: 6, borderRadius: 999, background: 'var(--secondary)', marginBottom: '0.5rem' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 999,
                        background: (r.order_status === 'DELAYED' || r.delay_flag) ? '#ef4444' : (STAGE_COLOR[r.stage] ?? '#6366f1'),
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
                          checked={r.order_status === 'DELAYED' || r.delay_flag}
                          onChange={() =>
                            patchOrder.mutate({
                              id: r.id,
                              json: {
                                order_status:
                                  r.order_status === 'DELAYED' || r.delay_flag ? 'ON_TRACK' : 'DELAYED',
                              },
                            })
                          }
                        />
                        <span className="toggle-slider" />
                      </label>
                    </label>
                  </div>

                  {panelOpen && (
                    <div className="panel-tabs" style={{ marginTop: '0.85rem', marginLeft: '-1.25rem', marginRight: '-1.25rem', paddingLeft: '1.25rem', paddingRight: '1.25rem' }}>
                      <button
                        type="button"
                        className={`panel-tab${open ? ' active' : ''}`}
                        onClick={() => openFinance(r, { force: true })}
                      >
                        {isOwner ? 'Progress & finance' : 'Progress'}
                      </button>
                      <button
                        type="button"
                        className={`panel-tab${trackingOpen ? ' active' : ''}`}
                        onClick={() => openTracking(r, { force: true })}
                      >
                        Tracking
                      </button>
                    </div>
                  )}

                  {open && (
                    <div className="stack" style={{ gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                      {isOwner && (
                      <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div className="form-field" style={{ margin: 0, minWidth: 140 }}>
                          <label className="input-label">Budget (₹)</label>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={budgetDraft}
                            onChange={(e) => setBudgetDraft(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={setBudget.isPending}
                          onClick={() => {
                            const cents = rupeesToCents(budgetDraft)
                            if (cents == null) {
                              toast.error('Enter a valid budget')
                              return
                            }
                            setBudget.mutate({ id: r.id, budget_cents: cents })
                          }}
                        >
                          Save budget
                        </button>
                      </div>
                      )}

                      <div
                        className="card"
                        style={{ padding: '0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.65rem', alignItems: 'end' }}
                      >
                        <div style={{ gridColumn: '1 / -1', fontWeight: 600, fontSize: '0.85rem' }}>ETA</div>
                        <div className="form-field" style={{ margin: 0 }}>
                          <label className="input-label">Expected completion</label>
                          <input className="input" type="date" value={etaCompletion} onChange={(e) => setEtaCompletion(e.target.value)} />
                        </div>
                        <div className="form-field" style={{ margin: 0 }}>
                          <label className="input-label">Expected dispatch</label>
                          <input className="input" type="date" value={etaDispatch} onChange={(e) => setEtaDispatch(e.target.value)} />
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={patchOrder.isPending}
                          onClick={() =>
                            patchOrder.mutate({
                              id: r.id,
                              json: {
                                expected_completion_at: etaCompletion ? new Date(etaCompletion).toISOString() : null,
                                expected_dispatch_at: etaDispatch ? new Date(etaDispatch).toISOString() : null,
                                clear_expected_completion: !etaCompletion,
                                clear_expected_dispatch: !etaDispatch,
                              },
                            })
                          }
                        >
                          Save ETA
                        </button>
                        {r.actual_dispatch_at && (
                          <div className="muted small" style={{ gridColumn: '1 / -1' }}>
                            Actual dispatch: {fmtDate(r.actual_dispatch_at)}
                          </div>
                        )}
                      </div>

                      {(r.stage === 'READY_DISPATCH' || r.stage === 'SHIPPED' || r.stage === 'DELIVERED' || r.courier_name || r.courier_tracking_no) && (
                        <div
                          className="card"
                          style={{ padding: '0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.65rem', alignItems: 'end' }}
                        >
                          <div style={{ gridColumn: '1 / -1', fontWeight: 600, fontSize: '0.85rem' }}>Shipping</div>
                          <div className="form-field" style={{ margin: 0 }}>
                            <label className="input-label">Courier</label>
                            <input className="input" value={courierName} onChange={(e) => setCourierName(e.target.value)} placeholder="e.g. Delhivery" />
                          </div>
                          <div className="form-field" style={{ margin: 0 }}>
                            <label className="input-label">Tracking number</label>
                            <input className="input" value={courierTracking} onChange={(e) => setCourierTracking(e.target.value)} placeholder="Optional" />
                          </div>
                          <div className="form-field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                            <label className="input-label">Shipping notes</label>
                            <input className="input" value={shippingNotes} onChange={(e) => setShippingNotes(e.target.value)} placeholder="Optional" />
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={patchOrder.isPending}
                            onClick={() =>
                              patchOrder.mutate({
                                id: r.id,
                                json: {
                                  courier_name: courierName,
                                  courier_tracking_no: courierTracking,
                                  shipping_notes: shippingNotes,
                                },
                              })
                            }
                          >
                            Save shipping
                          </button>
                        </div>
                      )}

                      {isOwner && (
                      <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                        <form
                          className="stack card"
                          style={{ padding: '0.85rem', gap: '0.65rem' }}
                          onSubmit={(e: FormEvent) => {
                            e.preventDefault()
                            addExpense.mutate({ id: r.id })
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Add expense</div>
                          <div className="form-field" style={{ margin: 0 }}>
                            <label className="input-label">Category</label>
                            <select className="select" value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} style={{ width: '100%' }}>
                              {EXPENSE_CATEGORIES.map((c) => (
                                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                              ))}
                            </select>
                          </div>
                          <div className="form-field" style={{ margin: 0 }}>
                            <label className="input-label">Amount (₹)</label>
                            <input className="input" type="number" min="0.01" step="0.01" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} required />
                          </div>
                          <div className="form-field" style={{ margin: 0 }}>
                            <label className="input-label">Vendor</label>
                            <input className="input" value={expenseVendor} onChange={(e) => setExpenseVendor(e.target.value)} placeholder="Optional" />
                          </div>
                          <div className="form-field" style={{ margin: 0 }}>
                            <label className="input-label">Note</label>
                            <input className="input" value={expenseDesc} onChange={(e) => setExpenseDesc(e.target.value)} placeholder="Optional" />
                          </div>
                          <button type="submit" className="btn btn-sm" disabled={addExpense.isPending}>
                            {addExpense.isPending ? 'Saving…' : 'Record expense'}
                          </button>
                        </form>

                        <form
                          className="stack card"
                          style={{ padding: '0.85rem', gap: '0.65rem' }}
                          onSubmit={(e: FormEvent) => {
                            e.preventDefault()
                            addPayment.mutate({ id: r.id })
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Record payment</div>
                          <div className="form-field" style={{ margin: 0 }}>
                            <label className="input-label">Amount (₹)</label>
                            <input className="input" type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} required />
                          </div>
                          <div className="form-field" style={{ margin: 0 }}>
                            <label className="input-label">Status</label>
                            <select className="select" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} style={{ width: '100%' }}>
                              <option value="PAID">Paid</option>
                              <option value="PARTIAL">Partial</option>
                              <option value="PENDING">Pending</option>
                            </select>
                          </div>
                          <div className="form-field" style={{ margin: 0 }}>
                            <label className="input-label">Note</label>
                            <input className="input" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="Optional" />
                          </div>
                          <button type="submit" className="btn btn-sm" disabled={addPayment.isPending}>
                            {addPayment.isPending ? 'Saving…' : 'Record payment'}
                          </button>
                        </form>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                            Expenses ({r.expenses?.length ?? 0})
                          </div>
                          {(r.expenses?.length ?? 0) === 0 ? (
                            <p className="muted small">No job costs yet.</p>
                          ) : (
                            <div className="stack" style={{ gap: '0.35rem' }}>
                              {r.expenses.map((e) => (
                                <div key={e.id} className="row spread small" style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                                  <span>
                                    {CATEGORY_LABELS[e.category] ?? e.category}
                                    {e.vendor ? ` · ${e.vendor}` : ''}
                                  </span>
                                  <strong>{fmtINR(e.amount_cents)}</strong>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                            Payments ({r.payments?.length ?? 0})
                          </div>
                          {(r.payments?.length ?? 0) === 0 ? (
                            <p className="muted small">No collections yet.</p>
                          ) : (
                            <div className="stack" style={{ gap: '0.35rem' }}>
                              {r.payments.map((p) => (
                                <div key={p.id} className="row spread small" style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                                  <span>{p.status}{p.note ? ` · ${p.note}` : ''}</span>
                                  <strong>{fmtINR(p.amount_cents)}</strong>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      </>
                      )}
                    </div>
                  )}

                  {trackingOpen && (
                    <div className="stack" style={{ gap: '0.85rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                      {r.tracking_token ? (
                        <>
                          {!r.tracking_enabled && (
                            <p className="muted small">
                              Tracking is disabled — customers cannot open this link.
                            </p>
                          )}
                          <div className="row" style={{ gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <img
                              className="track-qr"
                              alt="Tracking QR"
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(`${window.location.origin}/track/${r.tracking_token}`)}`}
                            />
                            <div className="stack" style={{ gap: '0.5rem', flex: 1, minWidth: 220 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Customer tracking link</div>
                              <input
                                className="input"
                                readOnly
                                value={`${window.location.origin}/track/${r.tracking_token}`}
                                onFocus={(e) => e.target.select()}
                              />
                              <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(
                                      `${window.location.origin}/track/${r.tracking_token}`,
                                    )
                                    toast.success('Link copied')
                                  }}
                                >
                                  Copy link
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={
                                    shareWhatsApp.isPending ||
                                    !r.tracking_enabled ||
                                    !r.lead_phone
                                  }
                                  title={
                                    !r.lead_phone
                                      ? 'This lead has no phone number'
                                      : !r.tracking_enabled
                                        ? 'Enable tracking first'
                                        : 'Send tracking link on WhatsApp'
                                  }
                                  onClick={() =>
                                    shareWhatsApp.mutate({
                                      lead_id: r.lead_id,
                                      order_number: r.order_number,
                                      token: r.tracking_token!,
                                    })
                                  }
                                >
                                  <MessageCircle size={14} />
                                  {shareWhatsApp.isPending ? 'Sending…' : 'Share on WhatsApp'}
                                </button>
                                {isOwner && (
                                  <>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-ghost"
                                  disabled={toggleTracking.isPending}
                                  onClick={() =>
                                    toggleTracking.mutate({
                                      id: r.id,
                                      enabled: !r.tracking_enabled,
                                    })
                                  }
                                >
                                  {r.tracking_enabled ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-ghost"
                                  disabled={regenTracking.isPending}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        'Regenerate tracking link? The old link will stop working.',
                                      )
                                    ) {
                                      regenTracking.mutate(r.id)
                                    }
                                  }}
                                >
                                  Regenerate
                                </button>
                                  </>
                                )}
                                <a
                                  className="btn btn-sm btn-ghost"
                                  href={`/track/${r.tracking_token}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open
                                </a>
                              </div>
                              {!r.lead_phone && (
                                <p className="muted small">Add a phone number on the lead to share via WhatsApp.</p>
                              )}
                            </div>
                          </div>
                        </>
                      ) : isOwner ? (
                        <div>
                          <p className="muted small" style={{ marginBottom: '0.5rem' }}>
                            No tracking link yet.
                          </p>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={regenTracking.isPending}
                            onClick={() => regenTracking.mutate(r.id)}
                          >
                            Generate tracking link
                          </button>
                        </div>
                      ) : (
                        <p className="muted small">No tracking link yet. Ask an owner to enable tracking.</p>
                      )}
                    </div>
                  )}
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

        {(activityQ.data?.groups ?? []).length > 0 && (
          <div className="card">
            <div className="row spread" style={{ marginBottom: '1rem', alignItems: 'center' }}>
              <div style={{ fontWeight: 700 }}>
                Pipeline activity
                {isAll ? '' : ` · ${dayParam}`}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const groups = activityQ.data?.groups ?? []
                  const anyExpanded = groups.some((g) => !collapsedGroups[g.lead_id])
                  setCollapsedGroups(
                    anyExpanded
                      ? Object.fromEntries(groups.map((g) => [g.lead_id, true]))
                      : {},
                  )
                }}
              >
                {activityQ.data!.groups.some((g) => !collapsedGroups[g.lead_id])
                  ? 'Collapse all'
                  : 'Expand all'}
              </button>
            </div>
            <div className="stack" style={{ gap: '1.25rem' }}>
              {activityQ.data!.groups.map((group) => {
                const collapsed = collapsedGroups[group.lead_id]
                return (
                  <div key={group.lead_id}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.lead_id)}
                      aria-expanded={!collapsed}
                      className="row"
                      style={{
                        gap: '0.4rem',
                        alignItems: 'center',
                        width: '100%',
                        padding: 0,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '0.9rem',
                        textAlign: 'left',
                        marginBottom: collapsed ? 0 : '0.5rem',
                      }}
                    >
                      <ChevronRight
                        size={14}
                        style={{
                          flexShrink: 0,
                          transition: 'transform 0.15s',
                          transform: collapsed ? 'none' : 'rotate(90deg)',
                        }}
                      />
                      {group.lead_title ?? 'Unnamed lead'}
                      <span className="muted small" style={{ fontWeight: 400 }}>
                        · {group.activities.length} update{group.activities.length !== 1 ? 's' : ''}
                      </span>
                    </button>
                    {!collapsed && (
                      <div className="timeline">
                        {group.activities.map((act) => (
                          <div className="timeline-item" key={act.id}>
                            <div className="timeline-dot" style={{ fontSize: '0.7rem' }}>
                              {ACTIVITY_ICONS[act.type] ?? '•'}
                            </div>
                            <div className="timeline-content">
                              <p>{act.body}{act.user_name ? ` · ${act.user_name}` : ''}</p>
                              <time>{fmtDateTime(act.created_at)}</time>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {orders.length > 0 && (
          <InsightGrid>
            <InsightCard title="Production overview">
              <DonutChart
                segments={[
                  { label: 'In progress', value: inProgressCount, color: '#3D7A5A' },
                  { label: 'Completed', value: completedCount, color: '#2563eb' },
                  { label: 'Delayed', value: delayedCount, color: '#B42318' },
                ]}
                center={{ value: orders.length, label: 'Orders' }}
              />
              <DonutLegend
                segments={[
                  { label: 'In progress', value: inProgressCount, color: '#3D7A5A' },
                  { label: 'Completed', value: completedCount, color: '#2563eb' },
                  { label: 'Delayed', value: delayedCount, color: '#B42318' },
                ]}
                total={orders.length}
              />
            </InsightCard>
            <InsightCard title="Department progress">
              <BarList
                items={STAGES.map((stage) => ({
                  label: STAGE_LABELS[stage],
                  value: orders.filter((o) => o.stage === stage).length,
                  color: STAGE_COLOR[stage],
                })).filter((i) => i.value > 0)}
              />
            </InsightCard>
            <InsightCard title="Upcoming deadlines">
              {orders
                .filter((o) => o.expected_dispatch_at && o.stage !== 'DELIVERED')
                .sort((a, b) => +new Date(a.expected_dispatch_at!) - +new Date(b.expected_dispatch_at!))
                .slice(0, 5).length === 0 ? (
                <p className="muted small">No upcoming dispatch dates.</p>
              ) : (
                <div className="stack" style={{ gap: '0.45rem', fontSize: '0.82rem' }}>
                  {orders
                    .filter((o) => o.expected_dispatch_at && o.stage !== 'DELIVERED')
                    .sort((a, b) => +new Date(a.expected_dispatch_at!) - +new Date(b.expected_dispatch_at!))
                    .slice(0, 5)
                    .map((o) => (
                      <div key={o.id} className="row spread">
                        <span>{o.display_name ?? o.lead_title ?? o.order_number}</span>
                        <span className={o.days_until_dispatch != null && o.days_until_dispatch < 0 ? 'error' : 'muted'}>
                          {o.days_until_dispatch == null
                            ? new Date(o.expected_dispatch_at!).toLocaleDateString('en-IN')
                            : o.days_until_dispatch < 0
                              ? `${Math.abs(o.days_until_dispatch)}d overdue`
                              : o.days_until_dispatch === 0
                                ? 'Today'
                                : `${o.days_until_dispatch}d left`}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </InsightCard>
            <InsightCard title="Quick actions">
              <div className="quick-action-list">
                {isOwner && (
                  <button type="button" onClick={() => setShowForm(true)}>
                    <Plus size={14} /> New production order
                  </button>
                )}
                <Link to="/app/expenses">
                  <Wallet size={14} /> Expenses
                </Link>
              </div>
            </InsightCard>
          </InsightGrid>
        )}
      </div>

      {stageModal && (
        <div className="drawer-overlay" onClick={() => setStageModal(null)}>
          <div
            className="card"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(420px, 92vw)',
              zIndex: 60,
              padding: '1.25rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
              Move to {stageModal.label}
            </div>
            <div className="stack" style={{ gap: '0.65rem' }}>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">Internal note (team only)</label>
                <input
                  className="input"
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Optional — not shown to customer"
                />
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">Customer-visible update</label>
                <input
                  className="input"
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                  placeholder="Optional — shown on tracking page later"
                />
              </div>
              <div className="row" style={{ gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={advance.isPending}
                  onClick={() =>
                    advance.mutate({
                      id: stageModal.id,
                      stage: stageModal.stage,
                      internal_note: internalNote,
                      customer_note: customerNote,
                    })
                  }
                >
                  {advance.isPending ? 'Updating…' : 'Confirm'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStageModal(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
