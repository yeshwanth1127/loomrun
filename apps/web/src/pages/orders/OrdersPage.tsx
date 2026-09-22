import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus, Wallet, Zap } from 'lucide-react'
import type { FormEvent } from 'react'
import { useDeferredValue, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { LeadSearchSelect } from '../../components/LeadSearchSelect'
import { EmptyState } from '../../components/ui/EmptyState'
import { FilterToolbar } from '../../components/ui/FilterToolbar'
import { PageHeader } from '../../components/ui/PageHeader'
import { TableSkeleton } from '../../components/ui/Skeleton'
import {
  BarList,
  DonutChart,
  DonutLegend,
  InsightCard,
  InsightGrid,
  MetricCard,
} from '../../components/ui/dashboard'
import { useAuth } from '../../context/AuthContext'
import { useDateFilter } from '../../context/DateFilterContext'
import { apiFetch } from '../../lib/api'
import { routes } from '../../lib/appRoutes'
import { isOwnerRole, membershipForOrg } from '../../lib/membership'
import {
  ACTIVITY_ICONS,
  type Order,
  type OrderActivityGroup,
  ORDER_STATUSES,
  STAGES,
  STAGE_COLOR,
  STAGE_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  daysIn,
  etaLabel,
  fmtOrderDate,
  fmtOrderDateTime,
  isFinished,
  isLate,
  nextStage,
  orderTitle,
  stageProgress,
} from '../../lib/orders'
import { invalidateOrders } from './useOrders'

const SHOW_PRESETS: [string, string][] = [
  ['active', 'Active'],
  ['delayed', 'Late'],
  ['on_hold', 'On hold'],
  ['shipped', 'Shipped'],
  ['completed', 'Done'],
  ['', 'All'],
]

/**
 * Orders list — every production order, with the filters the old Production page had.
 * Row click opens the order workspace; per-order work happens there.
 */
export function OrdersPage() {
  const { me, orgId } = useAuth()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership) || !!me?.is_super_admin
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const show = searchParams.get('show') ?? 'active'
  const [stage, setStage] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [showForm, setShowForm] = useState(false)
  const [leadId, setLeadId] = useState('')
  const [activityOpen, setActivityOpen] = useState(false)

  function setShow(next: string) {
    const params = new URLSearchParams(searchParams)
    if (next === 'active') params.delete('show')
    else params.set('show', next)
    setSearchParams(params, { replace: true })
  }

  const q = useQuery({
    queryKey: ['production', orgId, dayParam, show, stage, status, deferredSearch],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      if (show) params.set('filter', show)
      if (stage) params.set('stage', stage)
      if (status) params.set('order_status', status)
      if (deferredSearch.trim()) params.set('search', deferredSearch.trim())
      return apiFetch<{ items: Order[] }>(`/v1/orgs/${orgId}/production?${params}`)
    },
  })

  const activityQ = useQuery({
    queryKey: ['production-activity-log', orgId, dayParam],
    enabled: !!orgId && activityOpen,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      return apiFetch<{ groups: OrderActivityGroup[] }>(
        `/v1/orgs/${orgId}/production/activity-log?${params}`,
      )
    },
  })

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>(`/v1/orgs/${orgId}/production`, {
        method: 'POST',
        json: { lead_id: leadId },
      }),
    onSuccess: (created) => {
      setLeadId('')
      setShowForm(false)
      invalidateOrders(qc, orgId)
      if (created?.id) navigate(routes.order(created.id))
    },
  })

  if (!orgId) {
    return (
      <div className="page-header">
        <h1>Orders</h1>
        <p>Select an organization.</p>
      </div>
    )
  }

  const orders = q.data?.items ?? []
  const lateCount = orders.filter(isLate).length
  const doneCount = orders.filter(isFinished).length
  const runningCount = orders.filter((o) => !isFinished(o) && o.order_status !== 'CANCELLED').length
  const overBudget = isOwner ? orders.filter((o) => o.pnl?.over_budget).length : 0
  const statusOptions = isOwner ? ORDER_STATUSES : ORDER_STATUSES.filter((s) => s !== 'CANCELLED')
  const filtersOn = show !== 'active' || !!stage || !!status || !!search

  return (
    <>
      <PageHeader
        title="Orders"
        badge={`${orders.length} orders`}
        description="Everything you are making and shipping."
        actions={
          isOwner ? (
            <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
              <Plus size={15} />
              New order
            </button>
          ) : undefined
        }
        toolbar={
          <div className="sales-toolbar">
            <div className="sales-views">
              {SHOW_PRESETS.map(([value, label]) => (
                <button
                  key={value || 'all'}
                  type="button"
                  className={`sales-view-tab${show === value ? ' active' : ''}`}
                  onClick={() => setShow(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="sales-toolbar-right">
              <FilterToolbar
                defaultOpen={!!(stage || status || search)}
                trailing={
                  filtersOn ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setShow('active')
                        setStage('')
                        setStatus('')
                        setSearch('')
                      }}
                    >
                      Reset
                    </button>
                  ) : null
                }
              >
                <div className="form-field" style={{ margin: 0, minWidth: 160 }}>
                  <label className="input-label">Search</label>
                  <input
                    className="input"
                    placeholder="Order # or customer…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ margin: 0 }}>
                  <label className="input-label">Stage</label>
                  <select
                    className="select"
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                  >
                    <option value="">All stages</option>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field" style={{ margin: 0 }}>
                  <label className="input-label">Health</label>
                  <select
                    className="select"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">Any</option>
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </FilterToolbar>
            </div>
          </div>
        }
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        <div className="metrics-grid">
          <MetricCard
            icon={Zap}
            tone="purple"
            label="Orders"
            value={orders.length}
            hint={isAll ? 'This period' : dayParam}
          />
          <MetricCard icon={Zap} tone="green" label="Being made" value={runningCount} />
          <MetricCard icon={Zap} tone="green" label="Finished" value={doneCount} />
          <MetricCard icon={Zap} tone="red" label="Late" value={lateCount} />
          {isOwner && (
            <MetricCard icon={Wallet} tone="amber" label="Over budget" value={overBudget} />
          )}
        </div>

        {orders.length > 0 && (
          <InsightGrid>
            <InsightCard title="Where orders stand">
              <DonutChart
                segments={[
                  { label: 'Being made', value: runningCount, color: '#3D7A5A' },
                  { label: 'Finished', value: doneCount, color: '#2563eb' },
                  { label: 'Late', value: lateCount, color: '#B42318' },
                ]}
                center={{ value: orders.length, label: 'Orders' }}
              />
              <DonutLegend
                segments={[
                  { label: 'Being made', value: runningCount, color: '#3D7A5A' },
                  { label: 'Finished', value: doneCount, color: '#2563eb' },
                  { label: 'Late', value: lateCount, color: '#B42318' },
                ]}
                total={orders.length}
              />
            </InsightCard>
            <InsightCard title="Work by stage">
              <BarList
                items={STAGES.map((s) => ({
                  label: STAGE_LABELS[s],
                  value: orders.filter((o) => o.stage === s).length,
                  color: STAGE_COLOR[s],
                })).filter((i) => i.value > 0)}
              />
            </InsightCard>
            <InsightCard title="Next dispatches">
              <UpcomingDispatches orders={orders} />
            </InsightCard>
            <InsightCard title="Quick actions">
              <div className="quick-action-list">
                {isOwner && (
                  <button type="button" onClick={() => setShowForm(true)}>
                    <Plus size={14} /> New order
                  </button>
                )}
                {isOwner && (
                  <Link to={routes.money('expenses')}>
                    <Wallet size={14} /> Costs
                  </Link>
                )}
                <button type="button" onClick={() => setActivityOpen((v) => !v)}>
                  <ChevronRight size={14} /> {activityOpen ? 'Hide' : 'Show'} recent activity
                </button>
              </div>
            </InsightCard>
          </InsightGrid>
        )}

        {isOwner && showForm && (
          <div className="card" style={{ maxWidth: 480 }}>
            <div style={{ fontWeight: 700, marginBottom: '1rem' }}>Start a new order</div>
            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                if (leadId) void create.mutateAsync()
              }}
            >
              <div className="form-field">
                <label className="input-label">Customer *</label>
                <LeadSearchSelect orgId={orgId} value={leadId} required onChange={setLeadId} />
              </div>
              {create.error && <p className="error">{(create.error as Error).message}</p>}
              <div className="row">
                <button type="submit" className="btn" disabled={create.isPending}>
                  {create.isPending ? 'Creating…' : 'Start order'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {q.isLoading && <TableSkeleton rows={5} />}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {!q.isLoading && orders.length === 0 && (
          <EmptyState
            title={filtersOn ? 'No orders match' : 'No orders yet'}
            description={
              filtersOn
                ? 'Try a different filter or clear them.'
                : 'Confirm an order from a won lead and it shows up here.'
            }
            action={
              isOwner && !filtersOn ? (
                <button type="button" className="btn" onClick={() => setShowForm(true)}>
                  <Plus size={15} /> New order
                </button>
              ) : undefined
            }
          />
        )}

        {orders.length > 0 && (
          <div className="stack" style={{ gap: '0.6rem' }}>
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} isOwner={isOwner} />
            ))}
          </div>
        )}

        {activityOpen && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '0.85rem' }}>
              Recent activity{isAll ? '' : ` · ${dayParam}`}
            </div>
            {activityQ.isLoading && <p className="muted small">Loading…</p>}
            {(activityQ.data?.groups ?? []).length === 0 && !activityQ.isLoading && (
              <p className="muted small">Nothing logged in this period.</p>
            )}
            <div className="stack" style={{ gap: '1rem' }}>
              {(activityQ.data?.groups ?? []).map((group) => (
                <div key={group.lead_id}>
                  <Link
                    to={routes.order(group.production_order_id)}
                    style={{ fontWeight: 600, fontSize: '0.88rem' }}
                  >
                    {group.lead_title ?? 'Unnamed order'}
                  </Link>
                  <div className="timeline" style={{ marginTop: '0.4rem' }}>
                    {group.activities.map((act) => (
                      <div className="timeline-item" key={act.id}>
                        <div className="timeline-dot" style={{ fontSize: '0.7rem' }}>
                          {ACTIVITY_ICONS[act.type] ?? '•'}
                        </div>
                        <div className="timeline-content">
                          <p>
                            {act.body}
                            {act.user_name ? ` · ${act.user_name}` : ''}
                          </p>
                          <time>{fmtOrderDateTime(act.created_at)}</time>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function OrderCard({ order: o, isOwner }: { order: Order; isOwner: boolean }) {
  const navigate = useNavigate()
  const progress = stageProgress(o.stage)
  const late = isLate(o)
  const accent = late || (isOwner && o.pnl?.over_budget) ? '#ef4444' : STAGE_COLOR[o.stage]
  const next = nextStage(o.stage)

  return (
    <button
      type="button"
      className="card order-card"
      style={{ borderLeft: `3px solid ${accent ?? 'var(--primary)'}` }}
      onClick={() => navigate(routes.order(o.id))}
    >
      <div className="row spread" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
            <span className="order-number">{o.order_number}</span>
            <strong style={{ fontSize: '0.92rem' }}>{orderTitle(o)}</strong>
            <span className="badge badge-slate">{STAGE_LABELS[o.stage] ?? o.stage}</span>
            <span className={`badge ${STATUS_BADGE[o.order_status] ?? 'badge-slate'}`}>
              {STATUS_LABELS[o.order_status] ?? o.order_status}
            </span>
            {isOwner && o.pnl?.over_budget && <span className="badge badge-red">Over budget</span>}
          </div>
          <div className="muted small" style={{ marginTop: '0.2rem' }}>
            In {STAGE_LABELS[o.stage] ?? o.stage} for {daysIn(o.stage_entered_at)}
            {o.expected_dispatch_at && (
              <>
                {' · '}Dispatch {fmtOrderDate(o.expected_dispatch_at)}
                {etaLabel(o.days_until_dispatch) && (
                  <span className={(o.days_until_dispatch ?? 0) < 0 ? 'error' : undefined}>
                    {' '}
                    ({etaLabel(o.days_until_dispatch)})
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="muted small row" style={{ gap: '0.4rem' }}>
          {next ? `Next: ${STAGE_LABELS[next]}` : 'Final stage'}
          <ChevronRight size={15} />
        </div>
      </div>
      <div className="order-progress">
        <div
          style={{ width: `${progress}%`, background: late ? '#ef4444' : STAGE_COLOR[o.stage] }}
        />
      </div>
    </button>
  )
}

function UpcomingDispatches({ orders }: { orders: Order[] }) {
  const upcoming = orders
    .filter((o) => o.expected_dispatch_at && o.stage !== 'DELIVERED')
    .sort((a, b) => +new Date(a.expected_dispatch_at!) - +new Date(b.expected_dispatch_at!))
    .slice(0, 5)

  if (upcoming.length === 0) return <p className="muted small">No dispatch dates set.</p>

  return (
    <div className="stack" style={{ gap: '0.45rem', fontSize: '0.82rem' }}>
      {upcoming.map((o) => (
        <Link key={o.id} to={routes.order(o.id)} className="row spread">
          <span>{orderTitle(o)}</span>
          <span
            className={
              o.days_until_dispatch != null && o.days_until_dispatch < 0 ? 'error' : 'muted'
            }
          >
            {o.days_until_dispatch == null
              ? new Date(o.expected_dispatch_at!).toLocaleDateString('en-IN')
              : o.days_until_dispatch < 0
                ? `${Math.abs(o.days_until_dispatch)}d overdue`
                : o.days_until_dispatch === 0
                  ? 'Today'
                  : `${o.days_until_dispatch}d left`}
          </span>
        </Link>
      ))}
    </div>
  )
}
