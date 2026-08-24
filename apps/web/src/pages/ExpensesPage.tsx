import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LeadSearchSelect } from '../components/LeadSearchSelect'
import { RowActions } from '../components/RowActions'
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
  incurred_at: string
  lead_title: string | null
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
    setLines([
      {
        key: expense.id,
        subcategory: expense.subcategory ?? '',
        amount: centsToRupeesInput(expense.amount_cents),
        incurredAt: dateInputFromIso(expense.incurred_at),
      },
    ])
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
      <>
        <div className="page-header"><h1>Expenses</h1><p>Select an organization.</p></div>
      </>
    )
  }

  const items = q.data?.items ?? []
  const summary = q.data?.summary
  const saving = create.isPending || update.isPending
  const formError = (isEditing ? update.error : create.error) as Error | null

  function updateLine(key: string, patch: Partial<ExpenseLineDraft>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  return (
    <>
      <div className="page-header">
        <h1>Expenses</h1>
        <p>
          {summary ? `${summary.count} expense${summary.count !== 1 ? 's' : ''}` : 'Job costs and overhead'}
          {isAll ? '' : ` · ${dayParam}`}
        </p>
      </div>

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <div className="card">
              <div className="muted small" style={{ marginBottom: '0.35rem' }}>Job costs</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{fmtINR(summary.job_cost_total_cents)}</div>
            </div>
            <div className="card">
              <div className="muted small" style={{ marginBottom: '0.35rem' }}>Overhead</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{fmtINR(summary.overhead_total_cents)}</div>
            </div>
            <div className="card">
              <div className="muted small" style={{ marginBottom: '0.35rem' }}>Total</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{fmtINR(summary.total_cents)}</div>
            </div>
          </div>
        )}

        <div className="row spread" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
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
          </div>
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
        </div>

        {showForm && (
          <div className="card" style={{ maxWidth: 720 }}>
            <div style={{ fontWeight: 700, marginBottom: '1rem' }}>
              {isEditing ? 'Edit expense' : 'New expense'}
            </div>
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
            <div className="empty-state card">
              <Receipt size={28} />
              <p>No expenses yet. Add a job cost or org overhead expense.</p>
            </div>
          )
        )}
      </div>
    </>
  )
}
