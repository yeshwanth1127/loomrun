import { ArrowLeft, Bot, Check, MessageCircle, Pencil, Trash2, User, X } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ProductionDesignPanel } from '../../components/ProductionDesignPanel'
import { PageHeader } from '../../components/ui/PageHeader'
import { useAuth } from '../../context/AuthContext'
import { routes } from '../../lib/appRoutes'
import { isOwnerRole, membershipForOrg } from '../../lib/membership'
import { STAGE_LABELS, STATUS_BADGE, STATUS_LABELS, orderTitle } from '../../lib/orders'
import { OrderMoneyTab } from './OrderMoneyTab'
import { OrderOverviewTab } from './OrderOverviewTab'
import { OrderProductionTab } from './OrderProductionTab'
import { OrderShippingTab } from './OrderShippingTab'
import { useAllOrders, useOrderMutations } from './useOrders'

type TabKey = 'overview' | 'design' | 'production' | 'shipping' | 'money'

const TAB_KEYS: TabKey[] = ['overview', 'design', 'production', 'shipping', 'money']

/**
 * One order, five tabs: what it is, what it looks like, where it is on the floor,
 * how it ships, and what it costs.
 */
export function OrderWorkspacePage() {
  const { orderId = '' } = useParams()
  const { me, orgId } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership) || !!me?.is_super_admin
  const canEditDesign =
    isOwner || membership?.role === 'PRODUCTION' || membership?.role === 'PRODUCTION_MANAGER'

  const ordersQ = useAllOrders(orgId ?? '')
  const mutations = useOrderMutations(orgId ?? '')
  const order = ordersQ.data?.items.find((o) => o.id === orderId)

  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const tabParam = searchParams.get('tab')
  const requested = TAB_KEYS.includes(tabParam as TabKey) ? (tabParam as TabKey) : 'overview'
  // Money is Owner-only; anyone deep-linking into it lands on Overview.
  const tab: TabKey = requested === 'money' && !isOwner ? 'overview' : requested

  function setTab(next: TabKey) {
    const params = new URLSearchParams(searchParams)
    if (next === 'overview') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  if (!orgId) {
    return (
      <div className="page">
        <PageHeader title="Order" description="Select an organization." />
      </div>
    )
  }

  if (ordersQ.isLoading) {
    return (
      <div className="page">
        <PageHeader title="Loading order…" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="page">
        <PageHeader
          title="Order not found"
          description="It may have been removed."
          actions={
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => navigate(routes.orders())}
            >
              <ArrowLeft size={14} />
              Back to Orders
            </button>
          }
        />
      </div>
    )
  }

  function saveName(e: FormEvent) {
    e.preventDefault()
    const trimmed = nameDraft.trim()
    if (!trimmed) return
    mutations.patchOrder.mutate(
      { id: order!.id, json: { name: trimmed } },
      { onSuccess: () => setRenaming(false) },
    )
  }

  function confirmRemove() {
    const label = orderTitle(order!)
    if (
      !window.confirm(
        `Remove order ${order!.order_number} for "${label}"? This deletes the order and its payment/expense/activity history and cannot be undone.`,
      )
    ) {
      return
    }
    mutations.removeOrder.mutate(order!.id, { onSuccess: () => navigate(routes.orders()) })
  }

  const tabs: Array<{ key: TabKey; label: string; show: boolean }> = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'design', label: 'Design', show: true },
    { key: 'production', label: 'Production', show: true },
    { key: 'shipping', label: 'Shipping', show: true },
    { key: 'money', label: 'Money', show: isOwner },
  ]

  return (
    <div className="page order-workspace">
      <PageHeader
        title={
          renaming ? (
            <form className="row" style={{ gap: '0.4rem' }} onSubmit={saveName}>
              <input
                className="input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
                maxLength={200}
                aria-label="Order name"
                style={{ maxWidth: 320, fontWeight: 700 }}
              />
              <button
                type="submit"
                className="btn btn-sm"
                disabled={mutations.patchOrder.isPending}
                title="Save name"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setRenaming(false)}
                title="Cancel"
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <span className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
              {orderTitle(order)}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ padding: '0.15rem 0.35rem' }}
                title="Rename order"
                onClick={() => {
                  setNameDraft(order.name ?? order.display_name ?? order.lead_title ?? '')
                  setRenaming(true)
                }}
              >
                <Pencil size={13} />
              </button>
            </span>
          )
        }
        description={
          <span className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
            <span className="order-number">{order.order_number}</span>
            <span className="badge badge-slate">{STAGE_LABELS[order.stage] ?? order.stage}</span>
            <span className={`badge ${STATUS_BADGE[order.order_status] ?? 'badge-slate'}`}>
              {STATUS_LABELS[order.order_status] ?? order.order_status}
            </span>
            {order.name && order.lead_title && order.name !== order.lead_title && (
              <span className="muted small">Customer: {order.lead_title}</span>
            )}
          </span>
        }
        actions={
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => navigate(routes.orders())}
            >
              <ArrowLeft size={14} />
              Orders
            </button>
            {isOwner && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={confirmRemove}
                disabled={mutations.removeOrder.isPending}
                title="Remove order"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        }
        toolbar={
          <div className="quick-actions lead-quick-actions">
            <Link className="quick-action-btn" to={routes.lead(order.lead_id)}>
              <User size={14} />
              Customer
            </Link>
            {order.lead_phone && (
              <a
                className="quick-action-btn"
                href={`https://wa.me/${order.lead_phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={14} />
                WhatsApp
              </a>
            )}
            <Link
              className="quick-action-btn"
              to={routes.askAi(
                `About order ${order.order_number} for ${orderTitle(order)} (stage ${STAGE_LABELS[order.stage] ?? order.stage}): what needs attention?`,
              )}
            >
              <Bot size={14} />
              Ask AI
            </Link>
          </div>
        }
      >
        <div className="panel-tabs lead-tabs">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.key}
                type="button"
                className={`panel-tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
        </div>
      </PageHeader>

      <div className="page-body">
        {tab === 'overview' && (
          <OrderOverviewTab
            key={`${order.id}:${order.expected_dispatch_at ?? ''}:${order.expected_completion_at ?? ''}`}
            order={order}
            orgId={orgId}
            isOwner={isOwner}
            mutations={mutations}
            onOpenTab={setTab}
          />
        )}
        {tab === 'design' && (
          <ProductionDesignPanel
            key={order.id}
            orgId={orgId}
            orderId={order.id}
            orderNumber={order.order_number}
            leadPhone={order.lead_phone}
            canEdit={canEditDesign}
            order={order}
          />
        )}
        {tab === 'production' && (
          <OrderProductionTab order={order} isOwner={isOwner} mutations={mutations} />
        )}
        {tab === 'shipping' && (
          <OrderShippingTab
            key={`${order.id}:${order.courier_name ?? ''}:${order.courier_tracking_no ?? ''}`}
            order={order}
            isOwner={isOwner}
            mutations={mutations}
          />
        )}
        {tab === 'money' && isOwner && (
          <OrderMoneyTab
            key={`${order.id}:${order.budget_cents ?? ''}`}
            order={order}
            mutations={mutations}
          />
        )}
      </div>
    </div>
  )
}
