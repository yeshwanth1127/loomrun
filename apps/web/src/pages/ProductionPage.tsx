import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { LeadSearchSelect } from '../components/LeadSearchSelect'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'

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
  name: string | null
  display_name: string | null
  stage: string
  delay_flag: boolean
  budget_cents: number | null
  stage_entered_at: string
  lead_title: string | null
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
}

function daysAgo(dt: string) {
  const diff = Date.now() - new Date(dt).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day'
  return `${days} days`
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
  const { orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [leadId, setLeadId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
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
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }))

  const q = useQuery({
    queryKey: ['production', orgId, dayParam],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
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
    mutationFn: (p: { id: string; stage: string }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}`, { method: 'PATCH', json: { stage: p.stage } }),
    onSuccess: () => invalidateProduction(),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/production/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Production order removed')
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

  function openFinance(row: Row) {
    if (expandedId === row.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(row.id)
    setBudgetDraft(row.budget_cents != null ? String(row.budget_cents / 100) : '')
    setExpenseAmount('')
    setExpenseCategory('FABRIC')
    setExpenseVendor('')
    setExpenseDesc('')
    setPaymentAmount('')
    setPaymentStatus('PAID')
    setPaymentNote('')
  }

  if (!orgId) return (
    <>
      <div className="page-header"><h1>Production</h1><p>Select an organization.</p></div>
    </>
  )

  const orders = q.data?.items ?? []
  const delayedCount = orders.filter((r) => r.delay_flag).length
  const overrunCount = orders.filter((r) => r.pnl?.over_budget).length

  return (
    <>
      <div className="page-header">
        <h1>Production</h1>
        <p>
          {orders.length} order{orders.length !== 1 ? 's' : ''} in pipeline
          {isAll ? '' : ` · Started ${dayParam}`}
          {delayedCount > 0 && <span className="error"> · {delayedCount} delayed</span>}
          {overrunCount > 0 && <span className="error"> · {overrunCount} over budget</span>}
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

        {q.isLoading && <p className="muted">Loading orders…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {orders.length > 0 ? (
          <div className="stack" style={{ gap: '0.75rem' }}>
            {orders.map((r) => {
              const stageIdx = STAGES.indexOf(r.stage)
              const progress = ((stageIdx + 1) / STAGES.length) * 100
              const nextStage = STAGES[stageIdx + 1]
              const pnl = r.pnl
              const open = expandedId === r.id

              return (
                <div
                  key={r.id}
                  className="card"
                  style={{ borderLeft: `3px solid ${r.delay_flag || pnl?.over_budget ? '#ef4444' : (STAGE_COLOR[r.stage] ?? '#6366f1')}` }}
                >
                  <div className="row spread" style={{ marginBottom: '0.75rem' }}>
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
                          {r.delay_flag && (
                            <span style={{ marginLeft: '0.5rem', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}>
                              <AlertTriangle size={13} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                              Delayed
                            </span>
                          )}
                          {pnl?.over_budget && (
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
                      </div>
                    </div>
                    <div className="row" style={{ gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => openFinance(r)}
                      >
                        <Wallet size={14} />
                        P&amp;L
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
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
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-danger"
                        disabled={remove.isPending}
                        title="Remove order from production"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove production order for "${r.display_name ?? r.lead_title ?? 'this lead'}"? This deletes the order and its payment/expense/activity history and cannot be undone.`,
                            )
                          ) {
                            remove.mutate(r.id)
                          }
                        }}
                      >
                        <Trash2 size={14} />
                        Remove
                      </button>
                    </div>
                  </div>

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
                          }).then(invalidateProduction)}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </label>
                  </div>

                  {open && (
                    <div className="stack" style={{ gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
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
      </div>
    </>
  )
}
