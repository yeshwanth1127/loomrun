import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Receipt, Trash2, TrendingUp } from 'lucide-react'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LeadSearchSelect } from '../components/LeadSearchSelect'
import { RowActions } from '../components/RowActions'
import { EmptyState } from '../components/ui/EmptyState'
import { FilterToolbar } from '../components/ui/FilterToolbar'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { BarList, DonutChart, DonutLegend, InsightCard, InsightGrid, MetricCard, Sparkline } from '../components/ui/dashboard'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'

type Expense = {
  id: string
  production_order_id: string | null
  lead_id: string | null
  category: string
  subcategory: string | null
  amount_cents: number
  description: string | null
  vendor: string | null
  incurred_at: string
  lead_title: string | null
  created_by_name?: string | null
}

type Summary = {
  job_cost_total_cents: number
  overhead_total_cents: number
  total_cents: number
  count: number
}

type ExpenseLineDraft = {
  key: string
  subcategory: string
  amount: string
  incurredAt: string
}

function todayInput() {
  return new Date().toISOString().slice(0, 10)
}

function dateInputFromIso(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return todayInput()
  return d.toISOString().slice(0, 10)
}

function newLine(): ExpenseLineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    subcategory: '',
    amount: '',
    incurredAt: todayInput(),
  }
}

function fmtINR(cents: number) {
  return `₹${(cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function rupeesToCents(value: string): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

function centsToRupeesInput(cents: number) {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function invalidateExpenseQueries(qc: ReturnType<typeof useQueryClient>, orgId: string) {
  void qc.invalidateQueries({ queryKey: ['expenses', orgId] })
  void qc.invalidateQueries({ queryKey: ['production', orgId] })
  void qc.invalidateQueries({ queryKey: ['ceo', orgId] })
}

export function ExpensesPage() {
  const { orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [scope, setScope] = useState<'all' | 'job' | 'overhead'>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [leadId, setLeadId] = useState('')
  const [vendor, setVendor] = useState('')
  const [lines, setLines] = useState<ExpenseLineDraft[]>([newLine()])

  const q = useQuery({
    queryKey: ['expenses', orgId, dayParam, scope, categoryFilter],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      params.set('scope', scope)
      if (categoryFilter.trim()) params.set('category', categoryFilter.trim())
      return apiFetch<{ items: Expense[]; summary: Summary }>(`/v1/orgs/${orgId}/expenses?${params}`)
    },
  })

  const formTotalCents = useMemo(() => {
    return lines.reduce((sum, line) => sum + (rupeesToCents(line.amount) ?? 0), 0)
  }, [lines])

  const isEditing = editingId !== null

  function resetForm() {
    setEditingId(null)
    setCategory('')
    setDescription('')
    setLeadId('')
    setVendor('')
    setLines([newLine()])
  }

  function closeForm() {
    setShowForm(false)
    resetForm()
  }

  function openCreateForm() {
    resetForm()
    setShowForm(true)
  }

  function startEdit(expense: Expense) {
    setEditingId(expense.id)
    setCategory(expense.category)
    setDescription(expense.description ?? '')
    setLeadId(expense.lead_id ?? '')
    setVendor(expense.vendor ?? '')
    setLines([
      {
        key: expense.id,
        subcategory: expense.subcategory ?? '',
        amount: centsToRupeesInput(expense.amount_cents),
        incurredAt: dateInputFromIso(expense.incurred_at),
      },
    ])
    setShowForm(true)
  }

  const create = useMutation({
    mutationFn: () => {
      const trimmedCategory = category.trim()
      if (!trimmedCategory) throw new Error('Enter a category')
      const prepared = lines
        .map((line) => ({
          subcategory: line.subcategory.trim(),
          amount_cents: rupeesToCents(line.amount),
          incurred_at: line.incurredAt ? new Date(line.incurredAt).toISOString() : null,
        }))
        .filter((line) => line.subcategory || line.amount_cents != null)
      if (prepared.length === 0) throw new Error('Add at least one sub-category with an amount')
      for (const line of prepared) {
        if (!line.subcategory) throw new Error('Each row needs an expense type')
        if (line.amount_cents == null) throw new Error('Each row needs a valid amount')
      }
      return apiFetch(`/v1/orgs/${orgId}/expenses`, {
        method: 'POST',
        json: {
          category: trimmedCategory,
          description: description.trim() || null,
          lead_id: leadId || null,
          vendor: vendor.trim() || null,
          lines: prepared.map((line) => ({
            ...line,
            description: description.trim() || null,
          })),
        },
      })
    },
    onSuccess: () => {
      toast.success('Expense recorded')
      closeForm()
      if (orgId) invalidateExpenseQueries(qc, orgId)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create expense'),
  })

  const update = useMutation({
    mutationFn: () => {
      if (!editingId) throw new Error('No expense selected')
      const trimmedCategory = category.trim()
      if (!trimmedCategory) throw new Error('Enter a category')
      const line = lines[0]
      if (!line) throw new Error('Expense details are required')
      const subcategory = line.subcategory.trim()
      if (!subcategory) throw new Error('Expense type is required')
      const amount_cents = rupeesToCents(line.amount)
      if (amount_cents == null) throw new Error('Enter a valid amount')
      return apiFetch(`/v1/orgs/${orgId}/expenses/${editingId}`, {
        method: 'PATCH',
        json: {
          category: trimmedCategory,
          subcategory,
          amount_cents,
          description: description.trim() || null,
          incurred_at: line.incurredAt ? new Date(line.incurredAt).toISOString() : null,
          lead_id: leadId || null,
          vendor: vendor.trim() || null,
          clear_lead: !leadId,
        },
      })
    },
    onSuccess: () => {
      toast.success('Expense updated')
      closeForm()
      if (orgId) invalidateExpenseQueries(qc, orgId)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update expense'),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Expense deleted')
      if (editingId) closeForm()
      if (orgId) invalidateExpenseQueries(qc, orgId)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete expense'),
  })

  if (!orgId) {
    return (
      <PageHeader title="Expenses" description="Select an organization." />
    )
  }

  const items = q.data?.items ?? []
  const summary = q.data?.summary
  const saving = create.isPending || update.isPending
  const formError = (isEditing ? update.error : create.error) as Error | null
  const weekAgo = Date.now() - 7 * 86400000
  const last7Cents = items.filter((e) => +new Date(e.incurred_at) >= weekAgo).reduce((s, e) => s + e.amount_cents, 0)
  const byCategory = new Map<string, number>()
  for (const e of items) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount_cents)
  const trendDays: number[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const next = new Date(d)
    next.setDate(next.getDate() + 1)
    trendDays.push(
      items
        .filter((e) => {
          const t = +new Date(e.incurred_at)
          return t >= d.getTime() && t < next.getTime()
        })
        .reduce((s, e) => s + e.amount_cents, 0),
    )
  }

  function updateLine(key: string, patch: Partial<ExpenseLineDraft>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const expenseForm = (
    <form
      className="stack"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        if (isEditing) void update.mutateAsync()
        else void create.mutateAsync()
      }}
    >
      <div className="form-field">
        <label className="input-label">Lead</label>
        <LeadSearchSelect
          orgId={orgId}
          value={leadId}
          onChange={(id) => setLeadId(id)}
          placeholder="Search by lead name, phone, or company…"
        />
        <p className="muted small" style={{ marginTop: '0.35rem' }}>
          Leave empty for org overhead.
        </p>
      </div>
      <div className="form-field">
        <label className="input-label">Category *</label>
        <input
          className="input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Production"
          required
        />
      </div>
      <div className="form-field">
        <label className="input-label">Vendor</label>
        <input
          className="input"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          placeholder="Supplier, job worker, or courier"
        />
      </div>

      <div className="stack" style={{ gap: '0.65rem' }}>
        {!isEditing && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
              <Plus size={13} />
              Add row
            </button>
          </div>
        )}
        {lines.map((line, index) => (
          <div key={line.key} className="row" style={{ gap: '0.65rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-field" style={{ flex: 2, minWidth: 160, margin: 0 }}>
              <label className="input-label">Expense type *</label>
              <input
                className="input"
                value={line.subcategory}
                onChange={(e) => updateLine(line.key, { subcategory: e.target.value })}
                placeholder="e.g. marketing, making"
                required
              />
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 140, margin: 0 }}>
              <label className="input-label">Date</label>
              <input
                className="input"
                type="date"
                value={line.incurredAt}
                onChange={(e) => updateLine(line.key, { incurredAt: e.target.value })}
              />
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 120, margin: 0 }}>
              <label className="input-label">Amount (₹) *</label>
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                value={line.amount}
                onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                required
              />
            </div>
            {!isEditing && lines.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--destructive)' }}
                onClick={() => setLines((prev) => prev.filter((row) => row.key !== line.key))}
                aria-label={`Remove row ${index + 1}`}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        {!isEditing && (
          <div className="row spread" style={{ paddingTop: '0.35rem', borderTop: '1px solid var(--border)' }}>
            <div className="muted">Total</div>
            <div style={{ fontWeight: 800 }}>{fmtINR(formTotalCents)}</div>
          </div>
        )}
      </div>

      <div className="form-field">
        <label className="input-label">Description</label>
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
        />
      </div>

      {formError && <p className="error">{formError.message}</p>}
      <div className="row">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Saving…' : isEditing ? 'Update expense' : 'Save expense'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={closeForm}>
          Cancel
        </button>
      </div>
    </form>
  )

  return (
    <>
      <PageHeader
        title="Expenses"
        badge={summary ? `${summary.count} total` : undefined}
        description="Track and manage all your business expenses."
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (showForm && !isEditing) closeForm()
              else openCreateForm()
            }}
          >
            <Plus size={15} />
            Add expense
          </button>
        }
        toolbar={
          <FilterToolbar collapsible={false}>
            <select className="select" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="all">All</option>
              <option value="job">Job costs</option>
              <option value="overhead">Overhead</option>
            </select>
            <input
              className="input"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              placeholder="Filter by category"
            />
          </FilterToolbar>
        }
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {summary && (
          <div className="metrics-grid">
            <MetricCard icon={Receipt} tone="purple" label="Total expenses" value={fmtINR(summary.total_cents)} hint={isAll ? 'This period' : dayParam} />
            <MetricCard icon={Receipt} tone="green" label="Job costs" value={fmtINR(summary.job_cost_total_cents)} hint={summary.total_cents ? `${((summary.job_cost_total_cents / summary.total_cents) * 100).toFixed(1)}% of total` : undefined} />
            <MetricCard icon={Receipt} tone="amber" label="Overhead" value={fmtINR(summary.overhead_total_cents)} hint={summary.total_cents ? `${((summary.overhead_total_cents / summary.total_cents) * 100).toFixed(1)}% of total` : undefined} />
            <MetricCard icon={Receipt} tone="blue" label="Entries" value={summary.count} />
            <MetricCard icon={TrendingUp} tone="purple" label="Last 7 days" value={fmtINR(last7Cents)} />
          </div>
        )}

        {q.isLoading && <p className="muted">Loading expenses…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {items.length > 0 ? (
          <div className="table-wrap card">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Lead / Overhead</th>
                  <th>Vendor</th>
                  <th>Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.incurred_at)}</td>
                    <td>{e.category}</td>
                    <td className="muted">{e.subcategory || '—'}</td>
                    <td>
                      {(e.production_order_id || e.lead_id)
                        ? (e.lead_title ?? 'Production order')
                        : <span className="badge-slate">Overhead</span>}
                    </td>
                    <td className="muted">{e.vendor || '—'}</td>
                    <td style={{ fontWeight: 700 }}>{fmtINR(e.amount_cents)}</td>
                    <td>
                      <RowActions>
                        {(close) => (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                close()
                                startEdit(e)
                              }}
                            >
                              <Pencil size={13} />
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--destructive)' }}
                              onClick={() => {
                                close()
                                if (window.confirm('Delete this expense?')) remove.mutate(e.id)
                              }}
                            >
                              <Trash2 size={13} />
                              Delete
                            </button>
                          </>
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !q.isLoading && (
            <EmptyState
              icon={Receipt}
              description="No expenses yet. Add a job cost or org overhead expense."
            />
          )
        )}

        <InsightGrid>
          <InsightCard title="Expense trend">
            <Sparkline points={trendDays.map((c) => c / 100)} />
            <p className="muted small" style={{ marginTop: '0.5rem' }}>Last 7 days</p>
          </InsightCard>
          <InsightCard title="Expense by category">
            {byCategory.size === 0 ? (
              <p className="muted small">No categories yet.</p>
            ) : (
              <>
                <DonutChart
                  segments={[...byCategory.entries()].map(([label, value], i) => ({
                    label,
                    value,
                    color: ['#0F766E', '#0E7490', '#f59e0b', '#3D7A5A', '#64748b'][i % 5],
                  }))}
                  center={{ value: fmtINR(summary?.total_cents ?? 0), label: 'Total' }}
                />
                <DonutLegend
                  segments={[...byCategory.entries()].map(([label, value], i) => ({
                    label,
                    value: value / 100,
                    color: ['#0F766E', '#0E7490', '#f59e0b', '#3D7A5A', '#64748b'][i % 5],
                  }))}
                />
              </>
            )}
          </InsightCard>
          <InsightCard title="Top categories">
            <BarList
              items={[...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({
                label,
                value: value / 100,
              }))}
              formatValue={(n) => `₹${n.toLocaleString('en-IN')}`}
            />
          </InsightCard>
          <InsightCard title="Recent activity">
            {items.length === 0 ? (
              <p className="muted small">No expenses recorded.</p>
            ) : (
              <div className="stack" style={{ gap: '0.45rem', fontSize: '0.82rem' }}>
                {[...items].sort((a, b) => +new Date(b.incurred_at) - +new Date(a.incurred_at)).slice(0, 5).map((e) => (
                  <div key={e.id} className="row spread">
                    <div>
                      <div style={{ fontWeight: 600 }}>{e.category}{e.subcategory ? ` · ${e.subcategory}` : ''}</div>
                      <div className="muted small">{e.lead_title ?? 'Overhead'}{e.created_by_name ? ` · ${e.created_by_name}` : ''}</div>
                    </div>
                    <strong>{fmtINR(e.amount_cents)}</strong>
                  </div>
                ))}
              </div>
            )}
          </InsightCard>
        </InsightGrid>
      </div>

      <Modal
        open={showForm}
        onClose={closeForm}
        title={isEditing ? 'Edit expense' : 'New expense'}
        size="lg"
      >
        {expenseForm}
      </Modal>
    </>
  )
}
