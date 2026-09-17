import { useQuery } from '@tanstack/react-query'
import { Package, Search, User } from 'lucide-react'
import { useDeferredValue, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { routes } from '../lib/appRoutes'
import { STAGE_LABELS as LEAD_STAGE_LABELS } from '../lib/leads'
import { isOwnerRole, isProductionRole, membershipForOrg } from '../lib/membership'
import { STAGE_LABELS as ORDER_STAGE_LABELS, type Order, orderTitle } from '../lib/orders'

type LeadHit = {
  id: string
  title: string
  company: string | null
  phone: string | null
  stage: string
}

/**
 * One search box for the whole app. It reuses the list endpoints' own `search`
 * param — no new backend — and only asks for the lists the role may read.
 */
export function GlobalSearch() {
  const { me, orgId } = useAuth()
  const navigate = useNavigate()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership) || !!me?.is_super_admin
  const isProduction = isProductionRole(membership)
  const canSearchLeads = !isProduction || isOwner
  const canSearchOrders = isOwner || isProduction

  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const query = useDeferredValue(term.trim())
  const active = open && query.length >= 2

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        return
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const leadsQ = useQuery({
    queryKey: ['search-leads', orgId, query],
    enabled: active && !!orgId && canSearchLeads,
    queryFn: () =>
      apiFetch<{ items: LeadHit[] }>(
        `/v1/orgs/${orgId}/leads?day=all&limit=6&include_last_call=false&search=${encodeURIComponent(query)}`,
      ),
  })

  const ordersQ = useQuery({
    queryKey: ['search-orders', orgId, query],
    enabled: active && !!orgId && canSearchOrders,
    queryFn: () =>
      apiFetch<{ items: Order[] }>(
        `/v1/orgs/${orgId}/production?day=all&search=${encodeURIComponent(query)}`,
      ),
  })

  const leads = active ? (leadsQ.data?.items ?? []) : []
  const orders = active ? (ordersQ.data?.items ?? []).slice(0, 6) : []
  const searching = active && (leadsQ.isFetching || ordersQ.isFetching)
  const nothing = active && !searching && leads.length === 0 && orders.length === 0

  function go(to: string) {
    setOpen(false)
    setTerm('')
    navigate(to)
  }

  if (!orgId) return null

  return (
    <>
      <button type="button" className="global-search-trigger" onClick={() => setOpen(true)}>
        <Search size={14} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>

      {open && (
        <div className="search-overlay" onClick={() => setOpen(false)}>
          <div
            className="search-panel"
            role="dialog"
            aria-label="Search"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="search-input-row">
              <Search size={16} />
              <input
                className="search-input"
                autoFocus
                placeholder="Search customers and orders…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  const first = leads[0]
                  if (first) go(routes.lead(first.id))
                  else if (orders[0]) go(routes.order(orders[0].id))
                }}
              />
            </div>

            <div className="search-results">
              {!active && <p className="muted small search-hint">Type at least two characters.</p>}
              {searching && <p className="muted small search-hint">Searching…</p>}
              {nothing && <p className="muted small search-hint">Nothing matched “{query}”.</p>}

              {leads.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">Customers</div>
                  {leads.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="search-hit"
                      onClick={() => go(routes.lead(l.id))}
                    >
                      <User size={14} />
                      <span className="search-hit-main">
                        <span>{l.title}</span>
                        <span className="muted small">
                          {[l.company, l.phone].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                      <span className="badge badge-slate">
                        {LEAD_STAGE_LABELS[l.stage] ?? l.stage}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {orders.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">Orders</div>
                  {orders.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="search-hit"
                      onClick={() => go(routes.order(o.id))}
                    >
                      <Package size={14} />
                      <span className="search-hit-main">
                        <span>{orderTitle(o)}</span>
                        <span className="muted small">{o.order_number}</span>
                      </span>
                      <span className="badge badge-slate">
                        {ORDER_STAGE_LABELS[o.stage] ?? o.stage}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
