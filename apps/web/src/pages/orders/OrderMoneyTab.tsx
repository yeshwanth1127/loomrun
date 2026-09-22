import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtINR } from '../../lib/format'
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  PAYMENT_LABEL_SUGGESTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABELS,
  type ExpectedPayment,
  type Order,
  type PaymentTimelineEvent,
  dateInputToIso,
  fmtOrderDate,
  rupeesToCents,
  toDateInput,
} from '../../lib/orders'
import type { OrderMutations } from './useOrders'

type DialogMode =
  | null
  | { type: 'record'; expected?: ExpectedPayment }
  | { type: 'expected'; edit?: ExpectedPayment }
  | { type: 'reschedule'; expected: ExpectedPayment }
  | { type: 'edit-payment'; paymentId: string }
  | { type: 'delete-payment'; paymentId: string; amountCents: number }

function todayInput(): string {
  return new Date().toISOString().slice(0, 10)
}

function TimelineMarker({ marker }: { marker: string }) {
  if (marker === 'overdue') {
    return (
      <span className="payment-timeline-dot payment-timeline-dot--overdue" aria-label="Overdue">
        !
      </span>
    )
  }
  if (marker === 'open') {
    return (
      <span className="payment-timeline-dot payment-timeline-dot--open" aria-label="Expected">
        ○
      </span>
    )
  }
  return (
    <span className="payment-timeline-dot payment-timeline-dot--filled" aria-label="Completed">
      ●
    </span>
  )
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'ACTUAL_PAYMENT':
      return 'Received'
    case 'EXPECTED_PAYMENT':
      return 'Expected'
    case 'OVERDUE_PAYMENT':
      return 'Overdue'
    case 'ORDER_EVENT':
      return 'Order'
    case 'PAYMENT_NOTE':
      return 'Noted'
    default:
      return kind
  }
}

/** Budget, collections and costs for one order. */
export function OrderMoneyTab({
  order,
  mutations,
  canWrite = true,
}: {
  order: Order
  mutations: OrderMutations
  /** Owners can write; production managers view collections only. */
  canWrite?: boolean
}) {
  const [budget, setBudget] = useState(
    order.budget_cents != null ? String(order.budget_cents / 100) : '',
  )
  const [expenseCategory, setExpenseCategory] = useState('FABRIC')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseVendor, setExpenseVendor] = useState('')
  const [expenseNote, setExpenseNote] = useState('')
  const [dialog, setDialog] = useState<DialogMode>(null)

  // Record payment form
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(todayInput())
  const [payMethod, setPayMethod] = useState('')
  const [payReference, setPayReference] = useState('')
  const [payLabel, setPayLabel] = useState('')
  const [payNote, setPayNote] = useState('')

  // Expected payment form
  const [expAmount, setExpAmount] = useState('')
  const [expDate, setExpDate] = useState('')
  const [expLabel, setExpLabel] = useState('')
  const [expNote, setExpNote] = useState('')

  const pnl = order.pnl
  const paymentStatus = pnl?.payment_status ?? 'UNPAID'
  const collectionPct = pnl?.collection_percentage ?? 0
  const balanceDue = pnl?.balance_due_cents ?? pnl?.collection_gap_cents ?? null
  const overpaid = pnl?.overpaid_cents ?? 0
  const nextExpected = pnl?.next_expected_payment
  const timeline = order.payment_timeline ?? []
  const expectedPayments = (order.expected_payments ?? []).filter(
    (e) => e.status === 'OPEN' || e.status === 'PARTIALLY_FULFILLED',
  )

  function openRecord(expected?: ExpectedPayment) {
    setPayAmount(
      expected ? String((expected.remaining_cents ?? expected.amount_cents) / 100) : '',
    )
    setPayDate(todayInput())
    setPayMethod('')
    setPayReference('')
    setPayLabel(expected?.label ?? '')
    setPayNote(expected?.note ?? '')
    setDialog({ type: 'record', expected })
  }

  function openExpected(edit?: ExpectedPayment) {
    setExpAmount(edit ? String(edit.amount_cents / 100) : '')
    setExpDate(edit?.expected_at ? toDateInput(edit.expected_at) : '')
    setExpLabel(edit?.label ?? '')
    setExpNote(edit?.note ?? '')
    setDialog({ type: 'expected', edit })
  }

  function openReschedule(expected: ExpectedPayment) {
    setExpDate(expected.expected_at ? toDateInput(expected.expected_at) : '')
    setExpNote('')
    setDialog({ type: 'reschedule', expected })
  }

  function openEditPayment(paymentId: string) {
    const p = order.payments.find((x) => x.id === paymentId)
    if (!p) return
    setPayAmount(String(p.amount_cents / 100))
    setPayDate(p.recorded_at ? toDateInput(p.recorded_at) : todayInput())
    setPayMethod(p.method ?? '')
    setPayReference(p.reference ?? '')
    setPayLabel(p.label ?? '')
    setPayNote(p.note ?? '')
    setDialog({ type: 'edit-payment', paymentId })
  }

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

  function submitRecordPayment(e: FormEvent) {
    e.preventDefault()
    const cents = rupeesToCents(payAmount)
    if (cents == null || cents <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!payDate) {
      toast.error('Payment date is required')
      return
    }
    const expectedId =
      dialog && dialog.type === 'record' ? dialog.expected?.id ?? null : null
    mutations.addPayment.mutate(
      {
        id: order.id,
        amount_cents: cents,
        status: 'PAID',
        note: payNote || null,
        method: payMethod || null,
        reference: payReference || null,
        label: payLabel || null,
        recorded_at: dateInputToIso(payDate),
        expected_payment_id: expectedId,
      },
      { onSuccess: () => setDialog(null) },
    )
  }

  function submitEditPayment(e: FormEvent) {
    e.preventDefault()
    if (!dialog || dialog.type !== 'edit-payment') return
    const cents = rupeesToCents(payAmount)
    if (cents == null || cents <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    mutations.updatePayment.mutate(
      {
        orderId: order.id,
        paymentId: dialog.paymentId,
        json: {
          amount_cents: cents,
          note: payNote || null,
          method: payMethod || null,
          reference: payReference || null,
          label: payLabel || null,
          recorded_at: dateInputToIso(payDate),
        },
      },
      { onSuccess: () => setDialog(null) },
    )
  }

  function submitExpected(e: FormEvent) {
    e.preventDefault()
    const cents = rupeesToCents(expAmount)
    if (cents == null || cents <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    const edit = dialog && dialog.type === 'expected' ? dialog.edit : undefined
    if (edit) {
      mutations.updateExpectedPayment.mutate(
        {
          orderId: order.id,
          expectedId: edit.id,
          json: {
            amount_cents: cents,
            expected_at: dateInputToIso(expDate),
            clear_expected_at: !expDate,
            note: expNote || null,
            label: expLabel || null,
          },
        },
        { onSuccess: () => setDialog(null) },
      )
      return
    }
    mutations.addExpectedPayment.mutate(
      {
        id: order.id,
        amount_cents: cents,
        expected_at: dateInputToIso(expDate),
        note: expNote || null,
        label: expLabel || null,
      },
      { onSuccess: () => setDialog(null) },
    )
  }

  function submitReschedule(e: FormEvent) {
    e.preventDefault()
    if (!dialog || dialog.type !== 'reschedule') return
    mutations.rescheduleExpectedPayment.mutate(
      {
        orderId: order.id,
        expectedId: dialog.expected.id,
        expected_at: dateInputToIso(expDate),
        clear_expected_at: !expDate,
        note: expNote || null,
      },
      { onSuccess: () => setDialog(null) },
    )
  }

  return (
    <div className="stack" style={{ gap: '1rem' }}>
      {/* ── Collections summary ───────────────────────────────────── */}
      <div className="card">
        <div className="card-title-row">
          <strong>Collections</strong>
          <span className={`badge ${PAYMENT_STATUS_BADGE[paymentStatus] ?? 'badge-slate'}`}>
            {PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus}
          </span>
        </div>

        <div className="order-collections-summary">
          <div>
            <span className="muted small">Order value</span>
            <strong>{fmtINR(pnl?.revenue_cents, { cents: true })}</strong>
          </div>
          <div>
            <span className="muted small">Collected</span>
            <strong>{fmtINR(pnl?.collected_cents, { cents: true })}</strong>
          </div>
          <div>
            <span className="muted small">Balance due</span>
            <strong>{fmtINR(balanceDue, { cents: true })}</strong>
          </div>
        </div>

        {pnl?.revenue_cents != null && pnl.revenue_cents > 0 && (
          <div className="order-collection-bar-wrap">
            <div className="row spread small" style={{ marginBottom: '0.25rem' }}>
              <span className="muted">{collectionPct}% collected</span>
              {overpaid > 0 && (
                <span className="badge badge-blue">
                  Overpaid / credit {fmtINR(overpaid, { cents: true })}
                </span>
              )}
            </div>
            <div className="order-collection-bar" role="progressbar" aria-valuenow={collectionPct}>
              <div
                className="order-collection-bar-fill"
                style={{ width: `${Math.min(collectionPct, 100)}%` }}
              />
            </div>
          </div>
        )}

        {(pnl?.overdue_expected_count ?? 0) > 0 && (
          <p className="error small" style={{ marginTop: '0.65rem', marginBottom: 0 }}>
            {pnl!.overdue_expected_count} overdue expected payment
            {pnl!.overdue_expected_count === 1 ? '' : 's'} ·{' '}
            {fmtINR(pnl!.overdue_expected_cents, { cents: true })}
          </p>
        )}

        {nextExpected && (pnl?.overdue_expected_count ?? 0) === 0 && (
          <p className="muted small" style={{ marginTop: '0.65rem', marginBottom: 0 }}>
            Next expected payment:{' '}
            <strong>{fmtINR(nextExpected.remaining_cents, { cents: true })}</strong>
            {' · '}
            {nextExpected.expected_at
              ? fmtOrderDate(nextExpected.expected_at)
              : 'Unscheduled'}
          </p>
        )}

        {canWrite && (
          <div className="row" style={{ gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => openRecord()}>
              + Record payment
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => openExpected()}
            >
              + Add expected payment
            </button>
          </div>
        )}
      </div>

      {/* ── Expected payments list ────────────────────────────────── */}
      {expectedPayments.length > 0 && (
        <div className="card">
          <strong style={{ fontSize: '0.88rem' }}>
            Expected payments ({expectedPayments.length})
          </strong>
          <div className="stack" style={{ gap: '0.45rem', marginTop: '0.6rem' }}>
            {expectedPayments.map((ep) => (
              <div key={ep.id} className="order-expected-row">
                <div className="stack" style={{ gap: '0.15rem', flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <strong>{fmtINR(ep.remaining_cents, { cents: true })}</strong>
                    {ep.remaining_cents !== ep.amount_cents && (
                      <span className="muted small">
                        of {fmtINR(ep.amount_cents, { cents: true })}
                      </span>
                    )}
                    {ep.is_overdue ? (
                      <span className="badge badge-red">
                        Overdue
                        {ep.days_overdue != null ? ` by ${ep.days_overdue}d` : ''}
                      </span>
                    ) : ep.is_unscheduled ? (
                      <span className="badge badge-slate">Unscheduled</span>
                    ) : (
                      <span className="badge badge-amber">Expected</span>
                    )}
                    {ep.label && <span className="muted small">{ep.label}</span>}
                  </div>
                  <span className="muted small">
                    {ep.expected_at ? fmtOrderDate(ep.expected_at) : 'Date not confirmed'}
                    {ep.note ? ` · ${ep.note}` : ''}
                  </span>
                </div>
                {canWrite && (
                  <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => openRecord(ep)}
                    >
                      Mark as paid
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => openReschedule(ep)}
                    >
                      Reschedule
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => openExpected(ep)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={mutations.cancelExpectedPayment.isPending}
                      onClick={() => {
                        if (!window.confirm('Cancel this expected payment?')) return
                        mutations.cancelExpectedPayment.mutate({
                          orderId: order.id,
                          expectedId: ep.id,
                        })
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Payment timeline ──────────────────────────────────────── */}
      <div className="card">
        <strong style={{ fontSize: '0.88rem' }}>Payment timeline</strong>
        {timeline.length === 0 ? (
          <p className="muted small" style={{ marginTop: '0.5rem' }}>
            No payment activity yet.
          </p>
        ) : (
          <div className="payment-timeline" style={{ marginTop: '0.75rem' }}>
            {timeline.map((ev: PaymentTimelineEvent) => (
              <div key={ev.id} className="payment-timeline-item">
                <TimelineMarker marker={ev.marker} />
                <div className="payment-timeline-body">
                  <div className="row spread" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span className="muted small">
                      {ev.at ? fmtOrderDate(ev.at) : 'Unscheduled'}
                    </span>
                    <span className="badge badge-slate">{kindLabel(ev.kind)}</span>
                  </div>
                  <p style={{ margin: '0.15rem 0 0' }}>
                    <strong>{ev.title}</strong>
                    {ev.amount_cents != null && (
                      <>
                        {' '}
                        <strong className={ev.kind === 'ACTUAL_PAYMENT' ? undefined : 'muted'}>
                          {ev.kind === 'ACTUAL_PAYMENT' ? '+' : ''}
                          {fmtINR(ev.amount_cents, { cents: true })}
                        </strong>
                      </>
                    )}
                  </p>
                  {typeof ev.meta?.method === 'string' && ev.meta.method && (
                    <p className="muted small" style={{ margin: '0.1rem 0 0' }}>
                      {PAYMENT_METHOD_LABELS[ev.meta.method] ?? ev.meta.method}
                      {typeof ev.meta.reference === 'string' && ev.meta.reference
                        ? ` · Ref: ${ev.meta.reference}`
                        : ''}
                    </p>
                  )}
                  {ev.subtitle && (
                    <p className="muted small" style={{ margin: '0.1rem 0 0' }}>
                      {ev.subtitle}
                    </p>
                  )}
                  {ev.kind === 'OVERDUE_PAYMENT' && typeof ev.meta?.days_overdue === 'number' && (
                    <p className="error small" style={{ margin: '0.1rem 0 0' }}>
                      Overdue by {ev.meta.days_overdue} day
                      {ev.meta.days_overdue === 1 ? '' : 's'}
                    </p>
                  )}
                  {canWrite &&
                    (ev.kind === 'ACTUAL_PAYMENT' || ev.kind === 'PAYMENT_NOTE') &&
                    typeof ev.meta?.payment_id === 'string' && (
                      <div className="row" style={{ gap: '0.5rem', marginTop: '0.25rem' }}>
                        <button
                          type="button"
                          className="link-button small"
                          onClick={() => openEditPayment(ev.meta.payment_id as string)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="link-button small"
                          onClick={() =>
                            setDialog({
                              type: 'delete-payment',
                              paymentId: ev.meta.payment_id as string,
                              amountCents: ev.amount_cents ?? 0,
                            })
                          }
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  {canWrite &&
                    (ev.kind === 'EXPECTED_PAYMENT' || ev.kind === 'OVERDUE_PAYMENT') &&
                    typeof ev.meta?.expected_payment_id === 'string' && (
                      <div className="row" style={{ gap: '0.5rem', marginTop: '0.25rem' }}>
                        <button
                          type="button"
                          className="link-button small"
                          onClick={() => {
                            const ep = expectedPayments.find(
                              (x) => x.id === ev.meta.expected_payment_id,
                            )
                            if (ep) openRecord(ep)
                          }}
                        >
                          Record payment
                        </button>
                        <button
                          type="button"
                          className="link-button small"
                          onClick={() => {
                            const ep = expectedPayments.find(
                              (x) => x.id === ev.meta.expected_payment_id,
                            )
                            if (ep) openReschedule(ep)
                          }}
                        >
                          Reschedule
                        </button>
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Order costs (separate from collections) ───────────────── */}
      {canWrite && (
        <>
          <div className="card">
            <div className="card-title-row">
              <strong>Order costs</strong>
              <span className="muted small">Company spend — separate from customer payments</span>
            </div>
            <div className="order-money-strip" style={{ marginBottom: '0.75rem' }}>
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
                <span className="muted">Budget</span>{' '}
                <strong>{fmtINR(pnl?.budget_cents, { cents: true })}</strong>
              </span>
            </div>
            {pnl?.over_budget && (
              <p className="error small" style={{ marginTop: 0 }}>
                Over budget by {fmtINR(Math.abs(pnl.budget_variance_cents ?? 0), { cents: true })}
              </p>
            )}
            <div className="row" style={{ gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-field" style={{ margin: 0, minWidth: 160 }}>
                <label className="input-label">Budget</label>
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
                <label className="input-label">Amount</label>
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
          </div>
        </>
      )}

      {/* ── Dialogs ───────────────────────────────────────────────── */}
      {dialog?.type === 'record' && (
        <div className="drawer-overlay" onClick={() => setDialog(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
              {dialog.expected ? 'Mark expected payment as paid' : 'Record payment'}
            </div>
            <form className="stack" style={{ gap: '0.65rem' }} onSubmit={submitRecordPayment}>
              <PaymentFields
                amount={payAmount}
                setAmount={setPayAmount}
                date={payDate}
                setDate={setPayDate}
                method={payMethod}
                setMethod={setPayMethod}
                reference={payReference}
                setReference={setPayReference}
                label={payLabel}
                setLabel={setPayLabel}
                note={payNote}
                setNote={setPayNote}
              />
              <div className="row" style={{ gap: '0.5rem' }}>
                <button
                  type="submit"
                  className="btn"
                  disabled={mutations.addPayment.isPending}
                >
                  {mutations.addPayment.isPending ? 'Saving…' : 'Save payment'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dialog?.type === 'edit-payment' && (
        <div className="drawer-overlay" onClick={() => setDialog(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Edit payment</div>
            <form className="stack" style={{ gap: '0.65rem' }} onSubmit={submitEditPayment}>
              <PaymentFields
                amount={payAmount}
                setAmount={setPayAmount}
                date={payDate}
                setDate={setPayDate}
                method={payMethod}
                setMethod={setPayMethod}
                reference={payReference}
                setReference={setPayReference}
                label={payLabel}
                setLabel={setPayLabel}
                note={payNote}
                setNote={setPayNote}
              />
              <div className="row" style={{ gap: '0.5rem' }}>
                <button
                  type="submit"
                  className="btn"
                  disabled={mutations.updatePayment.isPending}
                >
                  {mutations.updatePayment.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dialog?.type === 'expected' && (
        <div className="drawer-overlay" onClick={() => setDialog(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
              {dialog.edit ? 'Edit expected payment' : 'Add expected payment'}
            </div>
            <form className="stack" style={{ gap: '0.65rem' }} onSubmit={submitExpected}>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">Expected amount *</label>
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  required
                />
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">Expected date</label>
                <input
                  className="input"
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                />
                <span className="muted small">Leave blank for unscheduled</span>
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">Label</label>
                <input
                  className="input"
                  list="payment-label-suggestions"
                  value={expLabel}
                  onChange={(e) => setExpLabel(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">Notes / promise details</label>
                <input
                  className="input"
                  value={expNote}
                  onChange={(e) => setExpNote(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="row" style={{ gap: '0.5rem' }}>
                <button
                  type="submit"
                  className="btn"
                  disabled={
                    mutations.addExpectedPayment.isPending ||
                    mutations.updateExpectedPayment.isPending
                  }
                >
                  Save
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dialog?.type === 'reschedule' && (
        <div className="drawer-overlay" onClick={() => setDialog(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
              Reschedule expected payment
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              {fmtINR(dialog.expected.remaining_cents, { cents: true })}
              {dialog.expected.expected_at
                ? ` · was ${fmtOrderDate(dialog.expected.expected_at)}`
                : ' · was unscheduled'}
            </p>
            <form className="stack" style={{ gap: '0.65rem' }} onSubmit={submitReschedule}>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">New expected date</label>
                <input
                  className="input"
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                />
                <span className="muted small">Leave blank for unscheduled</span>
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">Note</label>
                <input
                  className="input"
                  value={expNote}
                  onChange={(e) => setExpNote(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="row" style={{ gap: '0.5rem' }}>
                <button
                  type="submit"
                  className="btn"
                  disabled={mutations.rescheduleExpectedPayment.isPending}
                >
                  Reschedule
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dialog?.type === 'delete-payment' && (
        <div className="drawer-overlay" onClick={() => setDialog(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Delete payment?</div>
            <p className="muted small">
              This removes the recorded payment of{' '}
              {fmtINR(dialog.amountCents, { cents: true })}. Totals will recalculate.
            </p>
            <div className="row" style={{ gap: '0.5rem' }}>
              <button
                type="button"
                className="btn"
                disabled={mutations.deletePayment.isPending}
                onClick={() =>
                  mutations.deletePayment.mutate(
                    { orderId: order.id, paymentId: dialog.paymentId },
                    { onSuccess: () => setDialog(null) },
                  )
                }
              >
                {mutations.deletePayment.isPending ? 'Deleting…' : 'Delete payment'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}

      <datalist id="payment-label-suggestions">
        {PAYMENT_LABEL_SUGGESTIONS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
    </div>
  )
}

function PaymentFields({
  amount,
  setAmount,
  date,
  setDate,
  method,
  setMethod,
  reference,
  setReference,
  label,
  setLabel,
  note,
  setNote,
}: {
  amount: string
  setAmount: (v: string) => void
  date: string
  setDate: (v: string) => void
  method: string
  setMethod: (v: string) => void
  reference: string
  setReference: (v: string) => void
  label: string
  setLabel: (v: string) => void
  note: string
  setNote: (v: string) => void
}) {
  return (
    <>
      <div className="form-field" style={{ margin: 0 }}>
        <label className="input-label">Amount *</label>
        <input
          className="input"
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <div className="form-field" style={{ margin: 0 }}>
        <label className="input-label">Payment date *</label>
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>
      <div className="form-field" style={{ margin: 0 }}>
        <label className="input-label">Payment method</label>
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">Select…</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field" style={{ margin: 0 }}>
        <label className="input-label">Reference / transaction ID</label>
        <input
          className="input"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div className="form-field" style={{ margin: 0 }}>
        <label className="input-label">Label</label>
        <input
          className="input"
          list="payment-label-suggestions"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Advance"
        />
      </div>
      <div className="form-field" style={{ margin: 0 }}>
        <label className="input-label">Notes</label>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
        />
      </div>
    </>
  )
}
