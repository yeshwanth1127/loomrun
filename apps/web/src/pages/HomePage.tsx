import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  IndianRupee,
  Package,
  PhoneCall,
  Plus,
  Sparkles,
  Truck,
  UserPlus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/dashboard'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'
import { routes } from '../lib/appRoutes'
import { fmtFollowUpRelative, followUpBucket } from '../lib/followUp'
import { fmtINR, timeAgo } from '../lib/format'
import { isOwnerRole, isProductionRole, isTelecallerRole, membershipForOrg } from '../lib/membership'

type HomeLead = {
  id: string
  title: string
  company: string | null
  phone: string | null
  stage: string
  estimated_value: number | null
  next_follow_up_at: string | null
  last_call_outcome?: string | null
  updated_at: string
}

type HomeQuotation = {
  id: string
  number: string
  title: string | null
  status: string
  total: number
  lead_id: string
  lead_title: string | null
  pdf_url: string | null
  sent_at: string | null
}

type HomeOrder = {
  id: string
  order_number: string
  name: string | null
  display_name: string | null
  lead_title: string | null
  stage: string
  order_status: string
  delay_flag: boolean
  expected_dispatch_at: string | null
  days_until_dispatch: number | null
  stage_entered_at: string
  pnl?: {
    revenue_cents: number | null
    collected_cents: number
    collection_gap_cents: number | null
    balance_due_cents?: number | null
    overdue_expected_count?: number
    overdue_expected_cents?: number
    payment_status?: string
    over_budget: boolean
  } | null
}

/** Only the slice of the CEO payload Home summarises. Full detail stays on Business. */
type HomeBusiness = {
  total_leads: { count: number }
  deals_won: { count: number; value_cents: number }
  win_rate: { percent: number | null; closed_count: number }
  collections_pending: { count: number }
  pnl_overview?: {
    revenue_cents: number
    margin_cents: number
    collected_cents: number
    collection_gap_cents: number | null
  }
}

const PRODUCTION_STAGE_LABELS: Record<string, string> = {
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

function orderName(o: HomeOrder): string {
  return o.display_name ?? o.lead_title ?? o.order_number
}

function greeting(name: string | null): string {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? `${part}, ${first}` : part
}

type AttentionItem = {
  id: string
  primary: string
  secondary?: string | null
  meta?: ReactNode
  to: string
}

function AttentionCard({
  icon: Icon,
  tone,
  title,
  count,
  hint,
  items,
  emptyText,
  action,
  loading,
}: {
  icon: LucideIcon
  tone: 'red' | 'amber' | 'green' | 'blue' | 'slate'
  title: string
  count: number
  hint?: string
  items: AttentionItem[]
  emptyText: string
  action: { label: string; to: string }
  loading?: boolean
}) {
  return (
    <section className={`attention-card attention-card--${tone}`}>
      <div className="attention-card-head">
        <span className={`attention-card-icon tone-${tone}`}>
          <Icon size={16} />
        </span>
        <div className="attention-card-title">
          <h3>{title}</h3>
          {hint ? <p className="muted small">{hint}</p> : null}
        </div>
        <span className="attention-card-count">{loading ? '—' : count}</span>
      </div>

      <div className="attention-card-body">
        {loading ? (
          <p className="muted small">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted small attention-card-clear">
            <CheckCircle2 size={14} /> {emptyText}
          </p>
        ) : (
          <ul className="attention-list">
            {items.map((item) => (
              <li key={item.id}>
                <Link to={item.to}>
                  <span className="attention-list-primary">{item.primary}</span>
                  {item.secondary ? (
                    <span className="attention-list-secondary">{item.secondary}</span>
                  ) : null}
                  {item.meta ? <span className="attention-list-meta">{item.meta}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link to={action.to} className="attention-card-action">
        {action.label}
        <ArrowRight size={13} />
      </Link>
    </section>
  )
}

export function HomePage() {
  const { me, orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership) || !!me?.is_super_admin
  const role = membership?.role ?? null
  const isProduction = isProductionRole(membership)
  const isTelecaller = isTelecallerRole(membership)

  // Endpoint access mirrors the API's role guards so no card ever fires a 403.
  const showSales = isOwner || !isProduction
  const showQuotes = isOwner || role === 'SALES' || role === 'TELECALLER'
  // The full quotation list stays Owner-only, so send everyone else to the leads
  // that have a quote out.
  const quotesHome = isOwner ? routes.quotes : routes.sales('quoted')
  const showOrders = isOwner || isProduction

  // Attention lists ignore the global date filter — "what needs me now" is not a
  // period report. The Business summary below still honours it.
  const followUpsQ = useQuery({
    queryKey: ['home-follow-ups', orgId],
    enabled: !!orgId && showSales,
    refetchInterval: 60_000,
    queryFn: () =>
      apiFetch<{ items: HomeLead[] }>(
        `/v1/orgs/${orgId}/leads?last_call_outcome=FOLLOW_UP,FOLLOW_UP_DATE_SET,FOLLOW_UP_AFTER_SAMPLE,CALL_BACK_LATER,CALLBACK_SCHEDULED&day=all`,
      ),
  })

  const newLeadsQ = useQuery({
    queryKey: ['home-new-leads', orgId],
    enabled: !!orgId && showSales,
    refetchInterval: 60_000,
    queryFn: () =>
      apiFetch<{ items: HomeLead[] }>(
        `/v1/orgs/${orgId}/leads?stage=NEW&day=all&include_last_call=false`,
      ),
  })

  const quotationsQ = useQuery({
    queryKey: ['home-quotations', orgId],
    enabled: !!orgId && showQuotes,
    queryFn: () => apiFetch<{ items: HomeQuotation[] }>(`/v1/orgs/${orgId}/quotations?day=all&doc=quotation`),
  })

  const ordersQ = useQuery({
    queryKey: ['home-orders', orgId],
    enabled: !!orgId && showOrders,
    refetchInterval: 60_000,
    queryFn: () =>
      apiFetch<{ items: HomeOrder[] }>(`/v1/orgs/${orgId}/production?day=all&filter=active`),
  })

  const businessQ = useQuery({
    queryKey: ['home-business', orgId, dayParam],
    enabled: !!orgId && isOwner,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      return apiFetch<HomeBusiness>(`/v1/orgs/${orgId}/dashboard/ceo?${params}`)
    },
  })

  if (!orgId) {
    return (
      <div className="page">
        <PageHeader title="Home" description="Select an organization to get started." />
      </div>
    )
  }

  const followUps = followUpsQ.data?.items ?? []
  const dueFollowUps = followUps
    .filter((l) => {
      const bucket = followUpBucket(l.next_follow_up_at)
      return bucket === 'overdue' || bucket === 'due_now' || bucket === 'later_today'
    })
    .sort((a, b) => (a.next_follow_up_at ?? '').localeCompare(b.next_follow_up_at ?? ''))
  const overdueCount = followUps.filter(
    (l) => followUpBucket(l.next_follow_up_at) === 'overdue',
  ).length

  const newLeads = (newLeadsQ.data?.items ?? []).filter((l) => !l.last_call_outcome)

  const quotations = quotationsQ.data?.items ?? []
  const draftQuotes = quotations.filter((q) => q.status === 'DRAFT')
  const sentQuotes = quotations.filter((q) => q.status === 'SENT')
  const waitingQuotes = [...draftQuotes, ...sentQuotes]

  const orders = ordersQ.data?.items ?? []
  const delayedOrders = orders.filter((o) => o.order_status === 'DELAYED' || o.delay_flag)
  const stuckOrders = orders.filter(
    (o) =>
      o.order_status === 'ON_HOLD' ||
      o.stage === 'PAYMENT_HOLD' ||
      (o.days_until_dispatch != null && o.days_until_dispatch < 0),
  )
  const readyToShip = orders.filter((o) => o.stage === 'READY_DISPATCH')
  const ordersNeedingAttention = [
    ...stuckOrders,
    ...readyToShip.filter((o) => !stuckOrders.includes(o)),
  ]

  const collectible = orders
    .filter((o) => (o.pnl?.collection_gap_cents ?? o.pnl?.balance_due_cents ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.pnl?.collection_gap_cents ?? b.pnl?.balance_due_cents ?? 0) -
        (a.pnl?.collection_gap_cents ?? a.pnl?.balance_due_cents ?? 0),
    )
  const collectionGap = collectible.reduce(
    (sum, o) => sum + (o.pnl?.collection_gap_cents ?? o.pnl?.balance_due_cents ?? 0),
    0,
  )
  const overdueCollectible = orders
    .filter((o) => (o.pnl?.overdue_expected_count ?? 0) > 0)
    .sort(
      (a, b) => (b.pnl?.overdue_expected_cents ?? 0) - (a.pnl?.overdue_expected_cents ?? 0),
    )
  const overdueCents = overdueCollectible.reduce(
    (sum, o) => sum + (o.pnl?.overdue_expected_cents ?? 0),
    0,
  )

  const attentionTotal =
    dueFollowUps.length +
    newLeads.length +
    waitingQuotes.length +
    ordersNeedingAttention.length +
    delayedOrders.length +
    collectible.length +
    overdueCollectible.length

  const anyLoading =
    followUpsQ.isLoading || newLeadsQ.isLoading || quotationsQ.isLoading || ordersQ.isLoading

  const business = businessQ.data

  return (
    <div className="page home-page">
      <PageHeader
        title={greeting(me?.name ?? null)}
        description={
          anyLoading
            ? 'Checking what needs your attention…'
            : isTelecaller
              ? attentionTotal === 0
                ? 'No calls or follow-ups waiting — open Calls when you are ready.'
                : `${dueFollowUps.length} follow-up${dueFollowUps.length === 1 ? '' : 's'} and ${newLeads.length} new lead${newLeads.length === 1 ? '' : 's'} need you.`
              : isProduction
                ? attentionTotal === 0
                  ? 'Production is clear — no orders need action right now.'
                  : `${ordersNeedingAttention.length + delayedOrders.length} order${ordersNeedingAttention.length + delayedOrders.length === 1 ? '' : 's'} need production attention.`
                : attentionTotal === 0
                  ? 'Nothing is waiting on you right now.'
                  : `${attentionTotal} thing${attentionTotal === 1 ? '' : 's'} need your attention.`
        }
        actions={
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            {showSales && (
              <Link to={routes.sales('new')} className="btn btn-sm btn-secondary">
                <UserPlus size={14} />
                Leads
              </Link>
            )}
            {showOrders && (
              <Link to={routes.orders()} className="btn btn-sm btn-secondary">
                <Package size={14} />
                Orders
              </Link>
            )}
            <Link to={routes.ai} className="btn btn-sm">
              <Sparkles size={14} />
              Ask AI
            </Link>
          </div>
        }
      />

      {isTelecaller && (
        <div className="card row" style={{ gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <PhoneCall size={18} />
          <div style={{ flex: 1 }}>
            <strong>Your calling day</strong>
            <p className="muted small" style={{ margin: 0 }}>
              Work through follow-ups and new leads without leaving the Calls workspace.
            </p>
          </div>
          <Link to={routes.sales('calling')} className="btn">
            Open Calls workspace
          </Link>
        </div>
      )}
      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {isOwner && (
          <section className="home-business">
            <div className="section-title-row">
              <h2 className="section-title">
                <BarChart3 size={15} /> Business
              </h2>
              <span className="muted small">{isAll ? 'All time' : dayParam}</span>
              <Link
                to={routes.business}
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 'auto' }}
              >
                Full dashboard
                <ArrowRight size={13} />
              </Link>
            </div>
            {businessQ.isLoading ? (
              <p className="muted small">Loading business summary…</p>
            ) : businessQ.error ? (
              <p className="muted small">
                Business summary unavailable. <Link to={routes.business}>Open dashboard</Link>
              </p>
            ) : business ? (
              <div className="metrics-grid">
                <MetricCard
                  tone="blue"
                  label="Leads"
                  value={business.total_leads.count}
                  hint={isAll ? 'All time' : dayParam}
                />
                <MetricCard
                  tone="green"
                  label="Orders won"
                  value={business.deals_won.count}
                  hint={fmtINR(business.deals_won.value_cents, { cents: true })}
                />
                <MetricCard
                  tone="purple"
                  label="Win rate"
                  value={
                    business.win_rate.percent == null
                      ? '—'
                      : `${business.win_rate.percent.toFixed(0)}%`
                  }
                  hint={`${business.win_rate.closed_count} closed`}
                />
                <MetricCard
                  tone="green"
                  label="Revenue"
                  value={fmtINR(business.pnl_overview?.revenue_cents ?? null, {
                    cents: true,
                  })}
                  hint="Confirmed orders"
                />
                <MetricCard
                  tone="amber"
                  label="Margin"
                  value={fmtINR(business.pnl_overview?.margin_cents ?? null, {
                    cents: true,
                  })}
                  hint="Revenue less spend"
                />
                <MetricCard
                  tone="red"
                  label="Collections pending"
                  value={business.collections_pending.count}
                  hint={fmtINR(business.pnl_overview?.collection_gap_cents ?? null, {
                    cents: true,
                  })}
                />
              </div>
            ) : null}
          </section>
        )}

        <div className="attention-grid">
          {showSales && (
            <AttentionCard
              icon={CalendarClock}
              tone={overdueCount > 0 ? 'red' : 'blue'}
              title="Follow-ups due"
              count={dueFollowUps.length}
              hint={overdueCount > 0 ? `${overdueCount} overdue` : 'Scheduled for today'}
              loading={followUpsQ.isLoading}
              items={dueFollowUps.slice(0, 4).map((l) => ({
                id: l.id,
                primary: l.title,
                secondary: l.company ?? l.phone,
                meta: l.next_follow_up_at ? (
                  <span
                    className={
                      followUpBucket(l.next_follow_up_at) === 'overdue' ? 'error' : 'muted'
                    }
                  >
                    {fmtFollowUpRelative(l.next_follow_up_at)}
                  </span>
                ) : null,
                to: routes.lead(l.id),
              }))}
              emptyText="No follow-ups due"
              action={{
                label: 'Open follow-ups',
                to: routes.sales('follow-ups'),
              }}
            />
          )}

          {showSales && (
            <AttentionCard
              icon={UserPlus}
              tone={newLeads.length > 0 ? 'amber' : 'slate'}
              title="New leads"
              count={newLeads.length}
              hint="Not contacted yet"
              loading={newLeadsQ.isLoading}
              items={newLeads.slice(0, 4).map((l) => ({
                id: l.id,
                primary: l.title,
                secondary: l.company ?? l.phone,
                meta: <span className="muted">{timeAgo(l.updated_at)}</span>,
                to: routes.lead(l.id),
              }))}
              emptyText="Every lead has been contacted"
              action={{ label: 'Open new leads', to: routes.sales('new') }}
            />
          )}

          {showQuotes && (
            <AttentionCard
              icon={PhoneCall}
              tone={draftQuotes.length > 0 ? 'amber' : 'blue'}
              title="Quotations waiting"
              count={waitingQuotes.length}
              hint={
                draftQuotes.length > 0
                  ? `${draftQuotes.length} draft${draftQuotes.length === 1 ? '' : 's'} to send`
                  : 'Sent, awaiting a reply'
              }
              loading={quotationsQ.isLoading}
              items={waitingQuotes.slice(0, 4).map((q) => ({
                id: q.id,
                primary: q.lead_title ?? q.title ?? q.number,
                secondary: `${q.title?.trim() || q.number} · ${fmtINR(q.total)}`,
                meta: (
                  <span className={q.status === 'DRAFT' ? 'muted' : 'muted'}>
                    {q.status === 'DRAFT'
                      ? 'Draft'
                      : q.status === 'INVOICED'
                        ? 'Invoiced'
                        : q.status === 'ACCEPTED'
                          ? 'Accepted'
                          : 'Sent'}
                  </span>
                ),
                to: q.lead_id ? routes.lead(q.lead_id, 'quotes') : quotesHome,
              }))}
              emptyText="No quotations pending"
              action={{ label: 'Open quotations', to: quotesHome }}
            />
          )}

          {showOrders && (
            <AttentionCard
              icon={Package}
              tone={ordersNeedingAttention.length > 0 ? 'amber' : 'slate'}
              title="Orders needing attention"
              count={ordersNeedingAttention.length}
              hint="On hold, payment hold, or past dispatch date"
              loading={ordersQ.isLoading}
              items={ordersNeedingAttention.slice(0, 4).map((o) => ({
                id: o.id,
                primary: orderName(o),
                secondary: PRODUCTION_STAGE_LABELS[o.stage] ?? o.stage,
                meta:
                  o.days_until_dispatch != null && o.days_until_dispatch < 0 ? (
                    <span className="error">{Math.abs(o.days_until_dispatch)}d overdue</span>
                  ) : o.order_status === 'ON_HOLD' ? (
                    <span className="muted">On hold</span>
                  ) : o.stage === 'READY_DISPATCH' ? (
                    <span className="muted">Ready</span>
                  ) : (
                    <span className="muted">Payment hold</span>
                  ),
                to: routes.order(o.id),
              }))}
              emptyText="Every order is moving"
              action={{ label: 'Open orders', to: routes.orders() }}
            />
          )}

          {showOrders && (
            <AttentionCard
              icon={AlertTriangle}
              tone={delayedOrders.length > 0 ? 'red' : 'green'}
              title="Delayed production"
              count={delayedOrders.length}
              hint="Flagged as delayed"
              loading={ordersQ.isLoading}
              items={delayedOrders.slice(0, 4).map((o) => ({
                id: o.id,
                primary: orderName(o),
                secondary: PRODUCTION_STAGE_LABELS[o.stage] ?? o.stage,
                meta: <span className="error">Delayed</span>,
                to: routes.order(o.id),
              }))}
              emptyText="Nothing is running late"
              action={{
                label: 'Open delayed orders',
                to: routes.orders('delayed'),
              }}
            />
          )}

          {isOwner && (
            <AttentionCard
              icon={IndianRupee}
              tone={overdueCollectible.length > 0 ? 'red' : collectible.length > 0 ? 'amber' : 'green'}
              title="Money to collect"
              count={collectible.length}
              hint={
                overdueCollectible.length > 0
                  ? `${overdueCollectible.length} overdue · ${fmtINR(overdueCents, { cents: true })}`
                  : collectionGap > 0
                    ? `${fmtINR(collectionGap, { cents: true })} outstanding`
                    : 'All settled'
              }
              loading={ordersQ.isLoading}
              items={(overdueCollectible.length > 0 ? overdueCollectible : collectible)
                .slice(0, 4)
                .map((o) => ({
                  id: o.id,
                  primary: orderName(o),
                  secondary: PRODUCTION_STAGE_LABELS[o.stage] ?? o.stage,
                  meta: (
                    <span className={(o.pnl?.overdue_expected_count ?? 0) > 0 ? 'error' : 'muted'}>
                      {(o.pnl?.overdue_expected_count ?? 0) > 0
                        ? `Overdue · ${fmtINR(o.pnl?.overdue_expected_cents ?? 0, { cents: true })}`
                        : fmtINR(o.pnl?.collection_gap_cents ?? o.pnl?.balance_due_cents ?? 0, {
                            cents: true,
                          })}
                    </span>
                  ),
                  to: routes.order(o.id, 'money'),
                }))}
              emptyText="Nothing outstanding"
              action={{ label: 'Open money', to: routes.money('invoices') }}
            />
          )}
        </div>

        {!anyLoading && attentionTotal === 0 && (
          <div className="card home-all-clear">
            <CheckCircle2 size={22} />
            <div>
              <strong>You're all caught up.</strong>
              <p className="muted small">
                Nothing is overdue. {showSales ? 'Add a lead or ' : ''}Ask AI if you want a summary
                of the week.
              </p>
            </div>
            <div className="row" style={{ gap: '0.5rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
              {showSales && (
                <Link to={routes.sales()} className="btn btn-sm btn-secondary">
                  <Plus size={14} />
                  Add a lead
                </Link>
              )}
              <Link to={routes.ai} className="btn btn-sm btn-secondary">
                <Sparkles size={14} />
                Ask AI
              </Link>
            </div>
          </div>
        )}

        {isProduction && !isOwner && (
          <div className="card home-role-note">
            <Truck size={18} />
            <p className="muted small" style={{ margin: 0 }}>
              You see the orders you work on. Open an order to update its stage, design, and
              shipping.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
