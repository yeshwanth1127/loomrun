import { MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Order } from '../../lib/orders'
import { fmtOrderDate } from '../../lib/orders'
import type { OrderMutations } from './useOrders'

/**
 * Courier details plus the customer's tracking link. Same tracking token, QR and
 * WhatsApp share the Production page had — the link is just easier to find now.
 */
export function OrderShippingTab({
  order,
  isOwner,
  mutations,
}: {
  order: Order
  isOwner: boolean
  mutations: OrderMutations
}) {
  const [courier, setCourier] = useState(order.courier_name ?? '')
  const [trackingNo, setTrackingNo] = useState(order.courier_tracking_no ?? '')
  const [notes, setNotes] = useState(order.shipping_notes ?? '')

  const trackUrl = order.tracking_token
    ? `${window.location.origin}/track/${order.tracking_token}`
    : null

  return (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="card">
        <div className="card-title-row">
          <strong>Courier</strong>
          {order.actual_dispatch_at && (
            <span className="muted small">Dispatched {fmtOrderDate(order.actual_dispatch_at)}</span>
          )}
        </div>
        <div className="order-date-grid">
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Courier</label>
            <input
              className="input"
              value={courier}
              onChange={(e) => setCourier(e.target.value)}
              placeholder="e.g. Delhivery"
            />
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Tracking number</label>
            <input
              className="input"
              value={trackingNo}
              onChange={(e) => setTrackingNo(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="form-field" style={{ margin: 0, gridColumn: '1 / -1' }}>
            <label className="input-label">Shipping notes</label>
            <input
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
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
                  courier_name: courier,
                  courier_tracking_no: trackingNo,
                  shipping_notes: notes,
                },
              })
            }
          >
            Save shipping
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <strong>Customer tracking</strong>
          {order.tracking_token && !order.tracking_enabled && (
            <span className="badge badge-slate">Off</span>
          )}
        </div>

        {trackUrl ? (
          <>
            {!order.tracking_enabled && (
              <p className="muted small">Tracking is off — customers cannot open this link.</p>
            )}
            <div
              className="row"
              style={{ gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}
            >
              <img
                className="track-qr"
                alt="Tracking QR"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(trackUrl)}`}
              />
              <div className="stack" style={{ gap: '0.5rem', flex: 1, minWidth: 220 }}>
                <input
                  className="input"
                  readOnly
                  value={trackUrl}
                  onFocus={(e) => e.target.select()}
                  aria-label="Customer tracking link"
                />
                <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(trackUrl)
                      toast.success('Link copied')
                    }}
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={
                      mutations.shareTracking.isPending ||
                      !order.tracking_enabled ||
                      !order.lead_phone
                    }
                    title={
                      !order.lead_phone
                        ? 'This customer has no phone number'
                        : !order.tracking_enabled
                          ? 'Turn tracking on first'
                          : 'Send tracking link on WhatsApp'
                    }
                    onClick={() =>
                      mutations.shareTracking.mutate({
                        lead_id: order.lead_id,
                        order_number: order.order_number,
                        token: order.tracking_token!,
                      })
                    }
                  >
                    <MessageCircle size={14} />
                    {mutations.shareTracking.isPending ? 'Sending…' : 'Send on WhatsApp'}
                  </button>
                  {isOwner && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={mutations.toggleTracking.isPending}
                        onClick={() =>
                          mutations.toggleTracking.mutate({
                            id: order.id,
                            enabled: !order.tracking_enabled,
                          })
                        }
                      >
                        {order.tracking_enabled ? 'Turn off' : 'Turn on'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={mutations.regenTracking.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Regenerate tracking link? The old link will stop working.',
                            )
                          ) {
                            mutations.regenTracking.mutate(order.id)
                          }
                        }}
                      >
                        Regenerate
                      </button>
                    </>
                  )}
                  <a
                    className="btn btn-sm btn-ghost"
                    href={`/track/${order.tracking_token}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                </div>
                {!order.lead_phone && (
                  <p className="muted small">
                    Add a phone number on the customer to share on WhatsApp.
                  </p>
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
              disabled={mutations.regenTracking.isPending}
              onClick={() => mutations.regenTracking.mutate(order.id)}
            >
              Create tracking link
            </button>
          </div>
        ) : (
          <p className="muted small">No tracking link yet. Ask an owner to turn tracking on.</p>
        )}
      </div>
    </div>
  )
}
