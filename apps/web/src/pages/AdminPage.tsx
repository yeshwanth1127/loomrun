import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  BarChart2,
  Building2,
  CalendarDays,
  CreditCard,
  FileText,
  MessageCircle,
  Phone,
  Plug,
  TrendingUp,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type AdminOrg = {
  id: string
  name: string
  slug: string
  plan: string
  extra_seats: number
  suspended: boolean
  created_at: string
  member_count: number
  lead_count: number
}

type AdminUser = {
  id: string
  email: string
  name: string | null
  is_super_admin: boolean
  created_at: string
}

type PlatformAnalytics = {
  generated_at: string
  totals: {
    users: number
    super_admins: number
    organizations: number
    suspended_organizations: number
    memberships: number
    leads: number
    quotations: number
    production_orders: number
    expenses: number
    payments: number
    calls: number
    whatsapp_threads: number
    outbound_messages: number
    catalog_items: number
    lead_connections: number
    automation_connections: number
    telephony_configs: number
    active_subscriptions: number
  }
  growth: {
    users_last_7d: number
    users_last_30d: number
    orgs_last_7d: number
    orgs_last_30d: number
    leads_last_7d: number
    leads_last_24h: number
  }
  plans: {
    counts: Record<string, number>
    estimated_mrr_inr: number
  }
  series: {
    daily: Array<{ date: string; users: number; organizations: number; leads: number }>
  }
  top_organizations: Array<{
    id: string
    name: string
    slug: string
    plan: string
    suspended: boolean
    created_at: string
    members: number
    leads: number
    quotations: number
    production_orders: number
    calls: number
  }>
}

const MEMBERSHIP_ROLES = ['VIEWER', 'SALES', 'TELECALLER', 'PRODUCTION', 'OWNER'] as const
const PLAN_OPTIONS = ['free', 'growth', 'scale'] as const

const PLAN_COLOR: Record<string, string> = {
  free: 'badge-slate',
  growth: 'badge-blue',
  scale: 'badge-indigo',
}

function formatInr(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function MiniBars({
  series,
  field,
}: {
  series: PlatformAnalytics['series']['daily']
  field: 'users' | 'organizations' | 'leads'
}) {
  const max = Math.max(1, ...series.map((d) => d[field]))
  return (
    <div className="row" style={{ gap: 3, alignItems: 'flex-end', height: 56 }}>
      {series.map((d) => {
        const h = Math.max(2, Math.round((d[field] / max) * 52))
        return (
          <div
            key={d.date}
            title={`${d.date}: ${d[field]}`}
            style={{
              width: 10,
              height: h,
              borderRadius: 3,
              background: 'var(--primary)',
              opacity: 0.55 + (d[field] / max) * 0.45,
            }}
          />
        )
      })}
    </div>
  )
}

function OrgCard({
  org,
  onSuspendChange,
  onPlanChange,
  onExtraSeatsChange,
  onJoin,
  joinPending,
  patchPending,
}: {
  org: AdminOrg
  onSuspendChange: (id: string, val: boolean) => void
  onPlanChange: (id: string, plan: string) => void
  onExtraSeatsChange: (id: string, extraSeats: number) => void
  onJoin: (id: string) => void
  joinPending: boolean
  patchPending: boolean
}) {
  const initials = org.name.slice(0, 2).toUpperCase()
  const date = new Date(org.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const planKey = (org.plan || 'free').toLowerCase()

  return (
    <div className="org-card">
      <div className="org-card-header">
        <div className="row" style={{ gap: '0.75rem', alignItems: 'flex-start' }}>
          <div className="org-avatar">{initials}</div>
          <div>
            <div className="org-name">{org.name}</div>
            <div className="org-slug">{org.slug}</div>
          </div>
        </div>
        <span className={`badge ${PLAN_COLOR[planKey] ?? 'badge-slate'}`}>{planKey}</span>
      </div>

      <div className="org-stats">
        <div className="org-stat">
          <div className="org-stat-val">{org.member_count}</div>
          <div className="org-stat-label">Members</div>
        </div>
        <div className="org-stat">
          <div className="org-stat-val">{org.lead_count}</div>
          <div className="org-stat-label">Leads</div>
        </div>
        <div className="org-stat">
          <div className="org-stat-val">{date.split(' ')[2]}</div>
          <div className="org-stat-label">Since {date.split(' ')[1]}</div>
        </div>
      </div>

      <div className="stack" style={{ gap: '0.65rem', marginTop: '0.75rem' }}>
        <div className="form-field">
          <label className="input-label">Plan</label>
          <select
            className="select"
            value={PLAN_OPTIONS.includes(planKey as (typeof PLAN_OPTIONS)[number]) ? planKey : 'free'}
            disabled={patchPending}
            onChange={(e) => onPlanChange(org.id, e.target.value)}
            style={{ width: '100%' }}
          >
            {PLAN_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label className="input-label">Extra seats</label>
          <input
            className="input"
            type="number"
            min={0}
            max={500}
            value={org.extra_seats ?? 0}
            disabled={patchPending}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n) && n >= 0 && n !== (org.extra_seats ?? 0)) {
                onExtraSeatsChange(org.id, n)
              }
            }}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div className="org-card-footer">
        <div className="row" style={{ gap: '0.5rem' }}>
          {org.suspended && <span className="badge badge-red">Suspended</span>}
          <label className="row small muted" style={{ gap: '0.4rem', cursor: 'pointer' }}>
            <span>Suspend</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={org.suspended}
                disabled={patchPending}
                onChange={(e) => onSuspendChange(org.id, e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </label>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={joinPending}
          onClick={() => onJoin(org.id)}
        >
          <UserPlus size={13} />
          Join as owner
        </button>
      </div>
    </div>
  )
}

export function AdminPage() {
  const { me, reloadMe } = useAuth()
  const qc = useQueryClient()
  const [addOrgId, setAddOrgId] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState<string>('VIEWER')

  const analyticsQ = useQuery({
    queryKey: ['admin', 'analytics'],
    queryFn: () => apiFetch<PlatformAnalytics>('/v1/admin/analytics'),
    enabled: !!me?.is_super_admin,
    refetchInterval: 60_000,
  })

  const orgsQ = useQuery({
    queryKey: ['admin', 'organizations'],
    queryFn: () => apiFetch<{ items: AdminOrg[] }>('/v1/admin/organizations'),
    enabled: !!me?.is_super_admin,
  })

  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ items: AdminUser[]; total: number }>('/v1/admin/users?take=200'),
    enabled: !!me?.is_super_admin,
  })

  const patchOrg = useMutation({
    mutationFn: (p: { id: string; suspended?: boolean; plan?: string; extra_seats?: number }) =>
      apiFetch(`/v1/admin/organizations/${p.id}`, {
        method: 'PATCH',
        json: {
          ...(p.suspended !== undefined ? { suspended: p.suspended } : {}),
          ...(p.plan !== undefined ? { plan: p.plan } : {}),
          ...(p.extra_seats !== undefined ? { extra_seats: p.extra_seats } : {}),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
      void reloadMe()
    },
  })

  const patchUser = useMutation({
    mutationFn: (p: { id: string; is_super_admin: boolean }) =>
      apiFetch(`/v1/admin/users/${p.id}`, { method: 'PATCH', json: { is_super_admin: p.is_super_admin } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
      void reloadMe()
    },
  })

  const addMembership = useMutation({
    mutationFn: () =>
      apiFetch('/v1/admin/memberships', {
        method: 'POST',
        json: { organization_id: addOrgId, user_email: addEmail, role: addRole },
      }),
    onSuccess: () => {
      setAddEmail('')
      void qc.invalidateQueries({ queryKey: ['admin'] })
      void reloadMe()
    },
  })

  const joinSupport = useMutation({
    mutationFn: (orgId: string) =>
      apiFetch(`/v1/admin/organizations/${orgId}/join-as-support`, { method: 'POST' }),
    onSuccess: () => void reloadMe(),
  })

  if (!me) return null
  if (!me.is_super_admin) return <Navigate to="/app" replace />

  const orgs = orgsQ.data?.items ?? []
  const users = usersQ.data?.items ?? []
  const a = analyticsQ.data
  const t = a?.totals
  const g = a?.growth
  const planCounts = a?.plans.counts ?? {}

  return (
    <>
      <div className="page-header">
        <h1>Platform Admin</h1>
        <p>SaaS analytics across all organizations, users, and product activity</p>
      </div>

      <div className="page-body stack" style={{ gap: '2rem' }}>
        {analyticsQ.error && <p className="error">{(analyticsQ.error as Error).message}</p>}

        {/* Primary KPIs */}
        <div className="metrics-grid">
          <div className="metric-card indigo">
            <div className="metric-icon indigo"><Building2 size={18} /></div>
            <div className="metric-label">Organizations</div>
            <div className="metric-value">{t?.organizations ?? '—'}</div>
            <div className="metric-sub">
              {(t?.suspended_organizations ?? 0) > 0 ? `${t?.suspended_organizations} suspended · ` : ''}
              +{g?.orgs_last_7d ?? 0} this week
            </div>
          </div>
          <div className="metric-card blue">
            <div className="metric-icon blue"><Users size={18} /></div>
            <div className="metric-label">Platform users</div>
            <div className="metric-value">{t?.users ?? '—'}</div>
            <div className="metric-sub">
              {t?.super_admins ?? 0} super admins · +{g?.users_last_7d ?? 0} this week
            </div>
          </div>
          <div className="metric-card green">
            <div className="metric-icon green"><Activity size={18} /></div>
            <div className="metric-label">Total leads</div>
            <div className="metric-value">{t?.leads ?? '—'}</div>
            <div className="metric-sub">
              {g?.leads_last_24h ?? 0} last 24h · +{g?.leads_last_7d ?? 0} this week
            </div>
          </div>
          <div className="metric-card purple">
            <div className="metric-icon purple"><CreditCard size={18} /></div>
            <div className="metric-label">Est. MRR</div>
            <div className="metric-value" style={{ fontSize: '1.35rem' }}>
              {a ? formatInr(a.plans.estimated_mrr_inr) : '—'}
            </div>
            <div className="metric-sub">{t?.active_subscriptions ?? 0} active subscriptions</div>
          </div>
        </div>

        {/* Product volume */}
        <section>
          <div className="section-title" style={{ marginBottom: '1rem' }}>
            <BarChart2 size={16} style={{ marginRight: 6 }} />
            Platform volume
          </div>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label"><Users size={14} /> Memberships</div>
              <div className="metric-value">{t?.memberships ?? '—'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label"><FileText size={14} /> Quotations</div>
              <div className="metric-value">{t?.quotations ?? '—'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label"><Zap size={14} /> Production orders</div>
              <div className="metric-value">{t?.production_orders ?? '—'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label"><Phone size={14} /> Calls</div>
              <div className="metric-value">{t?.calls ?? '—'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label"><MessageCircle size={14} /> WhatsApp threads</div>
              <div className="metric-value">{t?.whatsapp_threads ?? '—'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label"><Plug size={14} /> Integrations</div>
              <div className="metric-value">
                {(t?.lead_connections ?? 0) + (t?.automation_connections ?? 0) + (t?.telephony_configs ?? 0)}
              </div>
              <div className="metric-sub">
                leads {t?.lead_connections ?? 0} · automation {t?.automation_connections ?? 0} · telephony {t?.telephony_configs ?? 0}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Payments / expenses</div>
              <div className="metric-value">{(t?.payments ?? 0) + (t?.expenses ?? 0)}</div>
              <div className="metric-sub">{t?.payments ?? 0} payments · {t?.expenses ?? 0} expenses</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Catalog items</div>
              <div className="metric-value">{t?.catalog_items ?? '—'}</div>
              <div className="metric-sub">{t?.outbound_messages ?? 0} outbound messages</div>
            </div>
          </div>
        </section>

        {/* Plans + growth charts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          <div className="card">
            <div className="section-title" style={{ marginBottom: '0.85rem' }}>
              <CreditCard size={15} style={{ marginRight: 6 }} />
              Plans
            </div>
            <div className="stack" style={{ gap: '0.55rem' }}>
              {(['free', 'growth', 'scale'] as const).map((p) => (
                <div key={p} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className={`badge ${PLAN_COLOR[p]}`}>{p}</span>
                  <strong>{planCounts[p] ?? 0}</strong>
                </div>
              ))}
              {Object.entries(planCounts)
                .filter(([k]) => !['free', 'growth', 'scale'].includes(k))
                .map(([k, v]) => (
                  <div key={k} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="badge badge-slate">{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
            </div>
          </div>

          <div className="card">
            <div className="section-title" style={{ marginBottom: '0.85rem' }}>
              <TrendingUp size={15} style={{ marginRight: 6 }} />
              New users (14d)
            </div>
            {a ? <MiniBars series={a.series.daily} field="users" /> : <p className="muted small">Loading…</p>}
            <p className="muted small" style={{ marginTop: '0.65rem' }}>+{g?.users_last_30d ?? 0} in last 30 days</p>
          </div>

          <div className="card">
            <div className="section-title" style={{ marginBottom: '0.85rem' }}>
              <Building2 size={15} style={{ marginRight: 6 }} />
              New orgs (14d)
            </div>
            {a ? <MiniBars series={a.series.daily} field="organizations" /> : <p className="muted small">Loading…</p>}
            <p className="muted small" style={{ marginTop: '0.65rem' }}>+{g?.orgs_last_30d ?? 0} in last 30 days</p>
          </div>

          <div className="card">
            <div className="section-title" style={{ marginBottom: '0.85rem' }}>
              <Activity size={15} style={{ marginRight: 6 }} />
              New leads (14d)
            </div>
            {a ? <MiniBars series={a.series.daily} field="leads" /> : <p className="muted small">Loading…</p>}
            <p className="muted small" style={{ marginTop: '0.65rem' }}>+{g?.leads_last_7d ?? 0} in last 7 days</p>
          </div>
        </div>

        {/* Top orgs table */}
        <section>
          <div className="section-title" style={{ marginBottom: '1rem' }}>Top organizations by activity</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Plan</th>
                  <th>Members</th>
                  <th>Leads</th>
                  <th>Quotations</th>
                  <th>Orders</th>
                  <th>Calls</th>
                </tr>
              </thead>
              <tbody>
                {(a?.top_organizations ?? []).map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{o.name}</div>
                      <div className="muted small">{o.slug}{o.suspended ? ' · suspended' : ''}</div>
                    </td>
                    <td><span className={`badge ${PLAN_COLOR[(o.plan || 'free').toLowerCase()] ?? 'badge-slate'}`}>{(o.plan || 'free').toLowerCase()}</span></td>
                    <td>{o.members}</td>
                    <td>{o.leads}</td>
                    <td>{o.quotations}</td>
                    <td>{o.production_orders}</td>
                    <td>{o.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analyticsQ.isLoading && <p className="muted" style={{ padding: '1rem' }}>Loading analytics…</p>}
            {!analyticsQ.isLoading && (a?.top_organizations.length ?? 0) === 0 && (
              <div className="empty-state"><p>No organization activity yet</p></div>
            )}
          </div>
        </section>

        {/* Org management */}
        <section>
          <div className="section-title" style={{ marginBottom: '1rem' }}>
            Organizations
            {orgsQ.isLoading && <span className="muted small" style={{ marginLeft: '0.5rem' }}>Loading…</span>}
          </div>
          {orgsQ.error && <p className="error">{(orgsQ.error as Error).message}</p>}
          <div className="orgs-grid">
            {orgs.map((o) => (
              <OrgCard
                key={o.id}
                org={o}
                onSuspendChange={(id, val) => patchOrg.mutate({ id, suspended: val })}
                onPlanChange={(id, plan) => patchOrg.mutate({ id, plan })}
                onExtraSeatsChange={(id, extra_seats) => patchOrg.mutate({ id, extra_seats })}
                onJoin={(id) => joinSupport.mutate(id)}
                joinPending={joinSupport.isPending}
                patchPending={patchOrg.isPending}
              />
            ))}
          </div>
          {orgs.length === 0 && !orgsQ.isLoading && (
            <div className="empty-state">
              <Building2 size={32} />
              <p>No organizations yet</p>
            </div>
          )}
        </section>

        <section>
          <div className="section-title">Add Membership</div>
          <div className="card" style={{ maxWidth: 640 }}>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault()
                if (addOrgId && addEmail) addMembership.mutate()
              }}
            >
              <div className="row" style={{ gap: '0.75rem' }}>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Organization</label>
                  <select className="select" value={addOrgId} onChange={(e) => setAddOrgId(e.target.value)} style={{ width: '100%' }}>
                    <option value="">Select org…</option>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">User email</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="user@email.com"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    style={{ width: '100%' }}
                    required
                  />
                </div>
                <div className="form-field">
                  <label className="input-label">Role</label>
                  <select className="select" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                    {MEMBERSHIP_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              {addMembership.error && <p className="error">{(addMembership.error as Error).message}</p>}
              {addMembership.isSuccess && <p className="success">Membership added.</p>}
              <div>
                <button type="submit" className="btn" disabled={addMembership.isPending || !addOrgId}>
                  <UserPlus size={15} />
                  Add membership
                </button>
              </div>
            </form>
          </div>
        </section>

        <section>
          <div className="section-title" style={{ marginBottom: '1rem' }}>
            All Users
            {usersQ.isLoading && <span className="muted small" style={{ marginLeft: '0.5rem' }}>Loading…</span>}
          </div>
          {usersQ.error && <p className="error">{(usersQ.error as Error).message}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Joined</th>
                  <th>Super Admin</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.email}</div>
                      {u.name && <div className="muted small">{u.name}</div>}
                    </td>
                    <td className="muted small">
                      <div className="row" style={{ gap: '0.3rem' }}>
                        <CalendarDays size={13} />
                        {new Date(u.created_at).toLocaleDateString('en-IN')}
                      </div>
                    </td>
                    <td>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={u.is_super_admin}
                          disabled={patchUser.isPending}
                          onChange={(e) => patchUser.mutate({ id: u.id, is_super_admin: e.target.checked })}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && !usersQ.isLoading && (
              <div className="empty-state">
                <p>No users found</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
