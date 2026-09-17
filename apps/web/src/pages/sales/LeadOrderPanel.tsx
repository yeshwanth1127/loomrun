import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Package } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState } from '../../components/ui/EmptyState'
import { apiFetch } from '../../lib/api'
import { routes } from '../../lib/appRoutes'
import type { Lead } from '../../lib/leads'

type LeadOrder = {
  id: string
  order_number: string
  display_name: string | null
  stage: string
  order_status: string
  delay_flag: boolean
}

type LeadQuotation = {
  id: string
  lead_id: string
  number: string
  total: number
}

const STAGE_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  FABRIC_CHECK: 'Fabric Check',
  PROCUREMENT: 'Procurement',
  FABRIC_RECEIVED: 'Fabric Received',
  CUTTING: 'Cutting',
  PRINTING: 'Printing',
  STITCHING: 'Stitching',
  QC: 'Quality Check',
  PACKING: 'Packing',
  PAYMENT_HOLD: 'Payment Hold',
  READY_DISPATCH: 'Ready to Dispatch',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
}

/** Turning a won lead into a production order, and jumping to it afterwards. */
export function LeadOrderPanel({ lead, orgId }: { lead: Lead; orgId: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [quotationId, setQuotationId] = useState('')

  const ordersQ = useQuery({
    queryKey: ['lead-orders', orgId, lead.id],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ items: LeadOrder[] }>(`/v1/orgs/${orgId}/production?lead_id=${lead.id}&day=all`),
  })

  const quotesQ = useQuery({
    queryKey: ['lead-quotations', orgId, lead.id],
    enabled: !!orgId && showCreate,
    queryFn: async () => {
      const { items } = await apiFetch<{ items: LeadQuotation[] }>(
        `/v1/orgs/${orgId}/quotations?day=all&doc=quotation`,
      )
      return items.filter((q) => q.lead_id === lead.id)
    },
  })

  const createOrder = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; order_number: string }>(`/v1/orgs/${orgId}/production`, {
        method: 'POST',
        json: { lead_id: lead.id, quotation_id: quotationId || null },
      }),
    onSuccess: (data) => {
      toast.success(`Order ${data.order_number} started`)
      setShowCreate(false)
      setQuotationId('')
      void qc.invalidateQueries({ queryKey: ['lead-orders', orgId, lead.id] })
      void qc.invalidateQueries({ queryKey: ['production', orgId] })
      void qc.invalidateQueries({ queryKey: ['home-orders', orgId] })
      navigate(routes.order(data.id))
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const orders = ordersQ.data?.items ?? []

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      {ordersQ.isLoading ? (
        <p className="muted small">Loading orders…</p>
      ) : orders.length > 0 ? (
        <section className="card">
          <div className="drawer-section-title">Orders from this lead</div>
          <div className="stack" style={{ gap: '0.5rem' }}>
            {orders.map((o) => (
              <button
                key={o.id}
                type="button"
                className="lead-order-row"
                onClick={() => navigate(routes.order(o.id))}
              >
                <span className="mono">{o.order_number}</span>
                <span>{o.display_name ?? lead.title}</span>
                <span className="badge badge-blue">{STAGE_LABELS[o.stage] ?? o.stage}</span>
                {(o.delay_flag || o.order_status === 'DELAYED') && (
                  <span className="badge badge-red">Delayed</span>
                )}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          icon={Package}
          title="No order yet"
          description={
            lead.stage === 'WON'
              ? 'This lead is won — start the order to begin production.'
              : 'Once the customer confirms, start the order here.'
          }
          action={
            <button
              type="button"
              className={lead.stage === 'WON' ? 'btn btn-sm' : 'btn btn-sm btn-secondary'}
              onClick={() => setShowCreate(true)}
            >
              <Package size={14} />
              Confirm order
            </button>
          }
        />
      )}

      {orders.length > 0 && !showCreate && (
        <div>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setShowCreate(true)}
          >
            <Package size={14} />
            Start another order
          </button>
        </div>
      )}

      {showCreate && (
        <section className="card">
          <div className="drawer-section-title">Start an order</div>
          <div className="form-field" style={{ maxWidth: 380 }}>
            <label className="input-label">Link the accepted quotation (optional)</label>
            <select
              className="select"
              value={quotationId}
              onChange={(e) => setQuotationId(e.target.value)}
            >
              <option value="">No quotation linked</option>
              {(quotesQ.data ?? []).map((q) => (
                <option key={q.id} value={q.id}>
                  {q.number} — ₹{q.total.toLocaleString('en-IN')}
                </option>
              ))}
            </select>
            <span className="muted small">
              Linking a quotation carries its value across for profit tracking.
            </span>
          </div>
          <div className="row" style={{ gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => createOrder.mutate()}
              disabled={createOrder.isPending}
            >
              {createOrder.isPending ? 'Starting…' : 'Start order'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setShowCreate(false)
                setQuotationId('')
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
