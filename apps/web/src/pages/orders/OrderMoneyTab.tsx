import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtINR } from '../../lib/format'
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type Order,
  fmtOrderDate,
  rupeesToCents,
} from '../../lib/orders'
import type { OrderMutations } from './useOrders'

/** Budget, costs and collections for one order. Owner-only, same as before. */
export function OrderMoneyTab({ order, mutations }: { order: Order; mutations: OrderMutations }) {
  const [budget, setBudget] = useState(
    order.budget_cents != null ? String(order.budget_cents / 100) : '',
  )
  const [expenseCategory, setExpenseCategory] = useState('FABRIC')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseVendor, setExpenseVendor] = useState('')
  const [expenseNote, setExpenseNote] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('PAID')
  const [paymentNote, setPaymentNote] = useState('')

  const pnl = order.pnl

  function submitExpense(e: FormEvent) {
    e.preventDefault()
    const cents = rupeesToCents(expenseAmount)
    if (cents == null || cents <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    mutations.addExpense.mutate(
      {
        id: order.id,
        category: expenseCategory,
        amount_cents: cents,
        vendor: expenseVendor || null,
        description: expenseNote || null,
      },
      {
        onSuccess: () => {
          setExpenseAmount('')
          setExpenseVendor('')
          setExpenseNote('')
        },
      },
    )
  }

  function submitPayment(e: FormEvent) {
    e.preventDefault()
    const cents = rupeesToCents(paymentAmount)
    if (cents == null || cents <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    mutations.addPayment.mutate(
      {
        id: order.id,
        amount_cents: cents,
        status: paymentStatus,
        note: paymentNote || null,
      },
      {
        onSuccess: () => {
          setPaymentAmount('')
          setPaymentNote('')
        },
      },
    )
  }

  return (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="card">
        <div className="order-money-strip">
          <span>
            <span className="muted">Order value</span>{' '}
            <strong>{fmtINR(pnl?.revenue_cents, { cents: true })}</strong>
          </span>
          <span>
            <span className="muted">Spent</span>{' '}
            <strong>{fmtINR(pnl?.actual_cost_cents, { cents: true })}</strong>
          </span>
          <span>
            <span className="muted">Profit</span>{' '}
            <strong className={(pnl?.margin_cents ?? 0) < 0 ? 'error' : undefined}>
              {fmtINR(pnl?.margin_cents, { cents: true })}
            </strong>
          </span>
          <span>
            <span className="muted">Received</span>{' '}
            <strong>{fmtINR(pnl?.collected_cents, { cents: true })}</strong>
          </span>
          <span>
            <span className="muted">Still to collect</span>{' '}
            <strong>{fmtINR(pnl?.collection_gap_cents, { cents: true })}</strong>
          </span>
        </div>
        {pnl?.over_budget && (
          <p className="error small" style={{ marginTop: '0.5rem' }}>
            Over budget by {fmtINR(Math.abs(pnl.budget_variance_cents ?? 0), { cents: true })}
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-title-row">
          <strong>Budget</strong>
          <span className="muted small">What you plan to spend making this order</span>
        </div>
        <div className="row" style={{ gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-field" style={{ margin: 0, minWidth: 160 }}>
            <label className="input-label">Budget (₹)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0"
            />
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={mutations.patchOrder.isPending}
            onClick={() => {
              const cents = rupeesToCents(budget)
              if (cents == null) {
                toast.error('Enter a valid budget')
                return
              }
              mutations.patchOrder.mutate({ id: order.id, json: { budget_cents: cents } })
            }}
          >
            Save budget
          </button>
        </div>
      </div>

      <div className="order-money-grid">
        <form className="card stack" style={{ gap: '0.65rem' }} onSubmit={submitExpense}>
          <strong style={{ fontSize: '0.88rem' }}>Add a cost</strong>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">What for</label>
            <select
              className="select"
              value={expenseCategory}
              onChange={(e) => setExpenseCategory(e.target.value)}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Amount (₹)</label>
            <input
              className="input"
              type="number"
              min="0.01"
              step="0.01"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              required
            />
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Paid to</label>
            <input
              className="input"
              value={expenseVendor}
              onChange={(e) => setExpenseVendor(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Note</label>
            <input
              className="input"
              value={expenseNote}
              onChange={(e) => setExpenseNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <button type="submit" className="btn btn-sm" disabled={mutations.addExpense.isPending}>
            {mutations.addExpense.isPending ? 'Saving…' : 'Record cost'}
          </button>
        </form>

        <form className="card stack" style={{ gap: '0.65rem' }} onSubmit={submitPayment}>
          <strong style={{ fontSize: '0.88rem' }}>Money received</strong>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Amount (₹)</label>
            <input
              className="input"
              type="number"
              min="0.01"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              required
            />
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Status</label>
            <select
              className="select"
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
            >
              <option value="PAID">Paid</option>
              <option value="PARTIAL">Partial</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Note</label>
            <input
              className="input"
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <button type="submit" className="btn btn-sm" disabled={mutations.addPayment.isPending}>
            {mutations.addPayment.isPending ? 'Saving…' : 'Record payment'}
          </button>
        </form>
      </div>

      <div className="order-money-grid">
        <div className="card">
          <strong style={{ fontSize: '0.88rem' }}>Costs ({order.expenses?.length ?? 0})</strong>
          {(order.expenses?.length ?? 0) === 0 ? (
            <p className="muted small">Nothing recorded yet.</p>
          ) : (
            <div className="stack" style={{ gap: '0.3rem', marginTop: '0.5rem' }}>
              {order.expenses.map((e) => (
                <div key={e.id} className="row spread small order-money-row">
                  <span>
                    {CATEGORY_LABELS[e.category] ?? e.category}
                    {e.vendor ? ` · ${e.vendor}` : ''}
                    {e.description ? ` · ${e.description}` : ''}
                  </span>
                  <span className="row" style={{ gap: '0.5rem' }}>
                    <span className="muted">{fmtOrderDate(e.incurred_at)}</span>
                    <strong>{fmtINR(e.amount_cents, { cents: true })}</strong>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <strong style={{ fontSize: '0.88rem' }}>Payments ({order.payments?.length ?? 0})</strong>
          {(order.payments?.length ?? 0) === 0 ? (
            <p className="muted small">Nothing received yet.</p>
          ) : (
            <div className="stack" style={{ gap: '0.3rem', marginTop: '0.5rem' }}>
              {order.payments.map((p) => (
                <div key={p.id} className="row spread small order-money-row">
                  <span>
                    {p.status}
                    {p.note ? ` · ${p.note}` : ''}
                  </span>
                  <span className="row" style={{ gap: '0.5rem' }}>
                    {p.recorded_at && <span className="muted">{fmtOrderDate(p.recorded_at)}</span>}
                    <strong>{fmtINR(p.amount_cents, { cents: true })}</strong>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
