import { AlertTriangle, ChevronRight, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { routes } from '../../lib/appRoutes'
import { fmtINR } from '../../lib/format'
import {
  ACTIVITY_ICONS,
  type Order,
  STAGE_COLOR,
  STAGE_LABELS,
  daysIn,
  etaLabel,
  fmtOrderDate,
  fmtOrderDateTime,
  isLate,
  nextStage,
  stageProgress,
  toDateInput,
} from '../../lib/orders'
import { type OrderMutations, useOrderActivities } from './useOrders'

/**
 * What this order is, how far along it is, and what happened so far.
 * Deadlines live here because that is the question people open an order to answer.
 */
export function OrderOverviewTab({
  order,
  orgId,
  isOwner,
  mutations,
  onOpenTab,
}: {
  order: Order
  orgId: string
  isOwner: boolean
  mutations: OrderMutations
  onOpenTab: (tab: 'design' | 'production' | 'shipping' | 'money') => void
}) {
  const [completion, setCompletion] = useState(toDateInput(order.expected_completion_at))
  const [dispatch, setDispatch] = useState(toDateInput(order.expected_dispatch_at))
  const activitiesQ = useOrderActivities(orgId, order.id)

  const progress = stageProgress(order.stage)
  const late = isLate(order)
  const next = nextStage(order.stage)
  const pnl = order.pnl

  return (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="card">
        <div className="row spread" style={{ marginBottom: '0.5rem' }}>
          <strong style={{ fontSize: '0.9rem' }}>{STAGE_LABELS[order.stage] ?? order.stage}</strong>
          <span className="muted small">
            {Math.round(progress)}% done · in this stage {daysIn(order.stage_entered_at)}
          </span>
        </div>
        <div className="order-progress">
          <div
            style={{
              width: `${progress}%`,
              background: late ? '#ef4444' : STAGE_COLOR[order.stage],
            }}
          />
        </div>
        <div className="row" style={{ gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
          {next && (
            <button type="button" className="btn btn-sm" onClick={() => onOpenTab('production')}>
              <ChevronRight size={14} />
              Move to {STAGE_LABELS[next]}
            </button>
          )}
          <label className="row small muted" style={{ gap: '0.35rem', cursor: 'pointer' }}>
            <span>Mark late</span>
            <span className="toggle">
              <input
                type="checkbox"
                checked={late}
                onChange={() =>
                  mutations.patchOrder.mutate({
                    id: order.id,
                    json: { order_status: late ? 'ON_TRACK' : 'DELAYED' },
                  })
                }
              />
              <span className="toggle-slider" />
            </span>
          </label>
        </div>
      </div>

      {late && (
        <div className="notice notice-warn row" style={{ gap: '0.5rem' }}>
          <AlertTriangle size={15} />
          <span>
            This order is marked late. Update the customer from Shipping, or clear the flag once it
            is back on track.
          </span>
        </div>
      )}

      <div className="card">
        <div className="card-title-row">
          <strong>Dates</strong>
          {order.days_until_dispatch != null && (
            <span className={(order.days_until_dispatch ?? 0) < 0 ? 'error small' : 'muted small'}>
              {etaLabel(order.days_until_dispatch)}
            </span>
          )}
        </div>
        <div className="order-date-grid">
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Ready by</label>
            <input
              className="input"
              type="date"
              value={completion}
              onChange={(e) => setCompletion(e.target.value)}
            />
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Dispatch by</label>
            <input
              className="input"
              type="date"
              value={dispatch}
              onChange={(e) => setDispatch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={mutations.patchOrder.isPending}
            onClick={() =>
              mutations.patchOrder.mutate({
                id: order.id,
                json: {
                  expected_completion_at: completion ? new Date(completion).toISOString() : null,
                  expected_dispatch_at: dispatch ? new Date(dispatch).toISOString() : null,
                  clear_expected_completion: !completion,
                  clear_expected_dispatch: !dispatch,
                },
              })
            }
          >
            Save dates
          </button>
        </div>
        {order.actual_dispatch_at && (
          <p className="muted small" style={{ marginTop: '0.5rem' }}>
            Actually dispatched {fmtOrderDate(order.actual_dispatch_at)}
          </p>
        )}
      </div>

      {isOwner && (
        <div className="card">
          <div className="card-title-row">
            <strong>Money</strong>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => onOpenTab('money')}
            >
              Open
            </button>
          </div>
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
              <span className="muted">Budget</span>{' '}
              <strong>{fmtINR(pnl?.budget_cents, { cents: true })}</strong>
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title-row">
          <strong>Order details</strong>
          <Link className="btn btn-sm btn-ghost" to={routes.lead(order.lead_id)}>
            Open customer
          </Link>
        </div>
        <div className="info-grid">
          <div className="info-field">
            <label>Customer</label>
            <div className="value">
              <Link to={routes.lead(order.lead_id)}>{order.lead_title ?? 'Unnamed lead'}</Link>
            </div>
          </div>
          <div className="info-field">
            <label>Phone</label>
            <div className="value">{order.lead_phone ?? '—'}</div>
          </div>
          <div className="info-field">
            <label>Quotation</label>
            <div className="value">
              {order.quotation_id ? (
                <Link to={routes.lead(order.lead_id, 'quotes')}>View quotation</Link>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div className="info-field">
            <label>Courier</label>
            <div className="value">
              {order.courier_name ? (
                <button type="button" className="link-button" onClick={() => onOpenTab('shipping')}>
                  <Truck size={13} /> {order.courier_name}
                </button>
              ) : (
                '—'
              )}
            </div>
          </div>
          {order.on_hold_reason && (
            <div className="info-field" style={{ gridColumn: '1 / -1' }}>
              <label>On hold because</label>
              <div className="value">{order.on_hold_reason}</div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <strong style={{ fontSize: '0.9rem' }}>History</strong>
        {activitiesQ.isLoading && <p className="muted small">Loading…</p>}
        {!activitiesQ.isLoading && (activitiesQ.data?.items ?? []).length === 0 && (
          <p className="muted small">Nothing logged yet.</p>
        )}
        <div className="timeline" style={{ marginTop: '0.6rem' }}>
          {(activitiesQ.data?.items ?? []).map((act) => (
            <div className="timeline-item" key={act.id}>
              <div className="timeline-dot" style={{ fontSize: '0.7rem' }}>
                {ACTIVITY_ICONS[act.type] ?? '•'}
              </div>
              <div className="timeline-content">
                <p>
                  {act.body}
                  {act.user_name ? ` · ${act.user_name}` : ''}
                </p>
                {act.metadata?.customer_note && (
                  <p className="muted small">Customer update: {act.metadata.customer_note}</p>
                )}
                <time>{fmtOrderDateTime(act.created_at)}</time>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
