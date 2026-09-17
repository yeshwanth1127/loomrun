import { Check } from 'lucide-react'
import { useState } from 'react'
import {
  ORDER_STATUSES,
  type Order,
  STAGES,
  STAGE_LABELS,
  STATUS_LABELS,
  daysIn,
  nextStage,
} from '../../lib/orders'
import type { OrderMutations } from './useOrders'

/**
 * Where the order is on the floor. Moving a stage always asks for the two notes the
 * old modal asked for — internal for the team, customer-visible for the tracking page.
 */
export function OrderProductionTab({
  order,
  isOwner,
  mutations,
}: {
  order: Order
  isOwner: boolean
  mutations: OrderMutations
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [internalNote, setInternalNote] = useState('')
  const [customerNote, setCustomerNote] = useState('')

  const currentIdx = STAGES.indexOf(order.stage as (typeof STAGES)[number])
  const next = nextStage(order.stage)
  const statusOptions = isOwner ? ORDER_STATUSES : ORDER_STATUSES.filter((s) => s !== 'CANCELLED')

  function request(stage: string) {
    setPending(stage)
    setInternalNote('')
    setCustomerNote('')
  }

  function confirm() {
    if (!pending) return
    mutations.moveStage.mutate(
      {
        id: order.id,
        stage: pending,
        internal_note: internalNote,
        customer_note: customerNote,
      },
      { onSuccess: () => setPending(null) },
    )
  }

  return (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="card">
        <div className="card-title-row">
          <strong>Stage</strong>
          {next && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={mutations.moveStage.isPending}
              onClick={() => request(next)}
            >
              Move to {STAGE_LABELS[next]}
            </button>
          )}
        </div>
        <ol className="stage-track">
          {STAGES.map((s, i) => {
            const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo'
            return (
              <li key={s} className={`stage-step ${state}`}>
                <button
                  type="button"
                  disabled={s === order.stage || mutations.moveStage.isPending}
                  onClick={() => request(s)}
                  title={s === order.stage ? 'Current stage' : `Move to ${STAGE_LABELS[s]}`}
                >
                  <span className="stage-step-dot">
                    {state === 'done' ? <Check size={11} /> : null}
                  </span>
                  <span>{STAGE_LABELS[s]}</span>
                  {s === order.stage && (
                    <span className="muted small">· {daysIn(order.stage_entered_at)}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="card">
        <div className="card-title-row">
          <strong>Health</strong>
        </div>
        <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-field" style={{ margin: 0, minWidth: 180 }}>
            <label className="input-label">Status</label>
            <select
              className="select"
              value={order.order_status}
              onChange={(e) =>
                mutations.patchOrder.mutate({
                  id: order.id,
                  json: { order_status: e.target.value },
                })
              }
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <p className="muted small" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            Status is what you tell the office; stage is where the work actually is.
          </p>
        </div>
      </div>

      {pending && (
        <div className="drawer-overlay" onClick={() => setPending(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
              Move to {STAGE_LABELS[pending] ?? pending}
            </div>
            <div className="stack" style={{ gap: '0.65rem' }}>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">Note for the team</label>
                <input
                  className="input"
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Optional — not shown to customer"
                />
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="input-label">Update for the customer</label>
                <input
                  className="input"
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                  placeholder="Optional — shows on the tracking page"
                />
              </div>
              <div className="row" style={{ gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={mutations.moveStage.isPending}
                  onClick={confirm}
                >
                  {mutations.moveStage.isPending ? 'Updating…' : 'Confirm'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
