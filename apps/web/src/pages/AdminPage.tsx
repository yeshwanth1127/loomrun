import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  Building2,
  Coins,
  Search,
  UserPlus,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { MetricCard } from '../components/ui/dashboard'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { roleLabel } from '../lib/membership'
import { timeAgo } from '../lib/format'

type UsageBucket = {
  turns: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  credits: number
  avg_tokens_per_turn: number
}

type CreditWindow = {
  used: number
  limit: number | null
  remaining: number | null
  resets_at: string | null
}

type AdminMember = {
  membership_id: string
  user_id: string
  email: string
  name: string | null
  role: string
  is_super_admin: boolean
  joined_at: string | null
}

type AdminOrg = {
  id: string
  name: string
  slug: string
  plan: string
  extra_seats: number
  suspended: boolean
  created_at: string | null
  member_count: number
  members: AdminMember[]
  ai: UsageBucket & {
    last_7d: UsageBucket
    windows: { session_5h: CreditWindow; weekly: CreditWindow }
  }
}

type AdminUser = {
  id: string
  email: string
  name: string | null
  is_super_admin: boolean
  created_at: string | null
  organizations: Array<{ id: string; name: string; slug: string; role: string }>
}

type Overview = {
  generated_at: string
  totals: {
    organizations: number
    users: number
    super_admins: number
    memberships: number
    ai: UsageBucket & { last_7d: UsageBucket }
  }
  organizations: AdminOrg[]
  users: AdminUser[]
}

type AiTurn = {
  id: string
  organization_id: string
  organization_name: string
  conversation_id: string | null
  conversation_title: string | null
  user_email: string | null
  user_name: string | null
  source: string
  model: string | null
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  credits: number
  created_at: string | null
}

const MEMBERSHIP_ROLES = ['VIEWER', 'SALES', 'TELECALLER', 'PRODUCTION', 'PRODUCTION_MANAGER', 'OWNER'] as const
const PLAN_OPTIONS = ['free', 'growth', 'scale'] as const
const PLAN_COLOR: Record<string, string> = {
  free: 'badge-slate',
  growth: 'badge-blue',
  scale: 'badge-indigo',
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-IN')
}

function WindowBar({ label, window }: { label: string; window: CreditWindow }) {
  const limit = window.limit
  const used = window.used
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>{label}</span>
        <span className="muted small">
          {limit == null ? `${fmtNum(used)} used` : `${fmtNum(used)} / ${fmtNum(limit)}`}
        </span>
      </div>
      <div className="platform-usage-track">
        <div
          className="platform-usage-fill"
          style={{ width: limit == null ? '0%' : `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function AdminPage() {
  const { me, reloadMe } = useAuth()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [turnDays, setTurnDays] = useState<number | null>(30)
  const [turnSkip, setTurnSkip] = useState(0)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState<string>('VIEWER')

  const overviewQ = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => apiFetch<Overview>('/v1/admin/overview'),
    enabled: !!me?.is_super_admin,
    refetchInterval: 60_000,
  })

  const orgs = overviewQ.data?.organizations ?? []
  const users = overviewQ.data?.users ?? []
  const totals = overviewQ.data?.totals
  const selected = orgs.find((o) => o.id === selectedOrgId) ?? orgs[0] ?? null

  const turnsQ = useQuery({
    queryKey: ['admin', 'ai-usage', selected?.id, turnDays, turnSkip],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (selected?.id) qs.set('organization_id', selected.id)
      if (turnDays) qs.set('days', String(turnDays))
      qs.set('skip', String(turnSkip))
      qs.set('take', '50')
      return apiFetch<{ items: AiTurn[]; total: number; skip: number; take: number }>(
        `/v1/admin/ai-usage?${qs}`,
      )
    },
    enabled: !!me?.is_super_admin && !!selected,
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
        json: { organization_id: selected?.id, user_email: addEmail, role: addRole },
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

  const q = query.trim().toLowerCase()
  const filteredOrgs = useMemo(() => {
    if (!q) return orgs
    return orgs.filter((o) => {
      const hay = `${o.name} ${o.slug} ${o.members.map((m) => `${m.email} ${m.name ?? ''}`).join(' ')}`
      return hay.toLowerCase().includes(q)
    })
  }, [orgs, q])

  const filteredUsers = useMemo(() => {
    if (!q) return users
    return users.filter((u) => {
      const hay = `${u.email} ${u.name ?? ''} ${u.organizations.map((o) => o.name).join(' ')}`
      return hay.toLowerCase().includes(q)
    })
  }, [users, q])

  if (!me) return null
  if (!me.is_super_admin) return <Navigate to="/app" replace />

  const ai = totals?.ai
  const turns = turnsQ.data?.items ?? []
  const turnsTotal = turnsQ.data?.total ?? 0

  return (
    <div className="platform-dash">
      <PageHeader
        title="Platform"
        description="Every organization, every member, and every AI turn’s token count"
      />

      <div className="page-body stack" style={{ gap: '1.5rem' }}>
        {overviewQ.error && <p className="error">{(overviewQ.error as Error).message}</p>}

        <div className="metrics-grid">
          <MetricCard
            icon={Building2}
            tone="purple"
            label="Organizations"
            value={totals?.organizations ?? '—'}
            hint={`${totals?.memberships ?? 0} memberships`}
          />
          <MetricCard
            icon={Users}
            tone="blue"
            label="Users"
            value={totals?.users ?? '—'}
            hint={`${totals?.super_admins ?? 0} super admins`}
          />
          <MetricCard
            icon={Bot}
            tone="green"
            label="AI turns"
            value={ai ? fmtNum(ai.turns) : '—'}
            hint={`${fmtNum(ai?.last_7d.turns ?? 0)} last 7 days`}
          />
          <MetricCard
            icon={Coins}
            tone="amber"
            label="Tokens"
            value={ai ? fmtNum(ai.total_tokens) : '—'}
            hint={`${fmtNum(ai?.prompt_tokens ?? 0)} in · ${fmtNum(ai?.completion_tokens ?? 0)} out`}
          />
          <MetricCard
            icon={Coins}
            tone="slate"
            label="Credits billed"
            value={ai ? fmtNum(ai.credits) : '—'}
            hint={`${fmtNum(ai?.last_7d.credits ?? 0)} last 7 days`}
          />
        </div>

        <div className="platform-search">
          <Search size={15} />
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search orgs, emails, names…"
          />
        </div>

        <div className="platform-split">
          <section className="card platform-orgs">
            <div className="section-title" style={{ marginBottom: '0.75rem' }}>Organizations</div>
            <div className="table-wrap" style={{ border: 'none', boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Org</th>
                    <th>People</th>
                    <th>Tokens</th>
                    <th>7d</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrgs.map((o) => {
                    const active = selected?.id === o.id
                    return (
                      <tr
                        key={o.id}
                        className={active ? 'platform-row-active' : undefined}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setSelectedOrgId(o.id)
                          setTurnSkip(0)
                        }}
                      >
                        <td>
                          <div style={{ fontWeight: 650 }}>{o.name}</div>
                          <div className="muted small">
                            <span className={`badge ${PLAN_COLOR[o.plan] ?? 'badge-slate'}`}>{o.plan}</span>
                            {o.suspended ? ' · suspended' : ''}
                          </div>
                        </td>
                        <td>{o.member_count}</td>
                        <td className="platform-num">{fmtNum(o.ai.total_tokens)}</td>
                        <td className="muted small platform-num">{fmtNum(o.ai.last_7d.total_tokens)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {overviewQ.isLoading && <p className="muted" style={{ padding: '1rem' }}>Loading…</p>}
              {!overviewQ.isLoading && filteredOrgs.length === 0 && (
                <div className="empty-state"><p>No organizations match</p></div>
              )}
            </div>
          </section>

          <section className="card platform-detail">
            {!selected ? (
              <div className="empty-state"><p>Select an organization</p></div>
            ) : (
              <div className="stack" style={{ gap: '1.15rem' }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                  <div style={{ minWidth: 0, flex: '1 1 12rem' }}>
                    <div className="org-name" style={{ fontSize: '1.05rem' }}>{selected.name}</div>
                    <div className="org-slug">{selected.slug}</div>
                  </div>
                  <div className="platform-detail-actions">
                    {selected.suspended && <span className="badge badge-red">Suspended</span>}
                    <select
                      className="select"
                      value={PLAN_OPTIONS.includes(selected.plan as (typeof PLAN_OPTIONS)[number]) ? selected.plan : 'free'}
                      disabled={patchOrg.isPending}
                      onChange={(e) => patchOrg.mutate({ id: selected.id, plan: e.target.value })}
                    >
                      {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={500}
                      title="Extra seats"
                      defaultValue={selected.extra_seats ?? 0}
                      key={`${selected.id}-${selected.extra_seats}`}
                      disabled={patchOrg.isPending}
                      onBlur={(e) => {
                        const n = Number(e.target.value)
                        if (!Number.isNaN(n) && n >= 0 && n !== (selected.extra_seats ?? 0)) {
                          patchOrg.mutate({ id: selected.id, extra_seats: n })
                        }
                      }}
                      style={{ width: 88 }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={joinSupport.isPending}
                      onClick={() => joinSupport.mutate(selected.id)}
                    >
                      <UserPlus size={13} />
                      Join as owner
                    </button>
                  </div>
                </div>

                <div className="platform-kpi-row">
                  <div>
                    <div className="muted small">Turns</div>
                    <strong>{fmtNum(selected.ai.turns)}</strong>
                  </div>
                  <div>
                    <div className="muted small">Prompt</div>
                    <strong>{fmtNum(selected.ai.prompt_tokens)}</strong>
                  </div>
                  <div>
                    <div className="muted small">Completion</div>
                    <strong>{fmtNum(selected.ai.completion_tokens)}</strong>
                  </div>
                  <div>
                    <div className="muted small">Avg / turn</div>
                    <strong>{fmtNum(selected.ai.avg_tokens_per_turn)}</strong>
                  </div>
                  <div>
                    <div className="muted small">Credits</div>
                    <strong>{fmtNum(selected.ai.credits)}</strong>
                  </div>
                </div>

                <div className="stack" style={{ gap: '0.65rem' }}>
                  <WindowBar label="5-hour session credits" window={selected.ai.windows.session_5h} />
                  <WindowBar label="Weekly credits" window={selected.ai.windows.weekly} />
                </div>

                <div>
                  <div className="section-title" style={{ marginBottom: '0.65rem' }}>
                    Members
                    <span className="muted small" style={{ marginLeft: 8, fontWeight: 500 }}>
                      role is MembershipRole in the DB
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Role</th>
                          <th>Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.members.map((m) => (
                          <tr key={m.membership_id}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{m.email}</div>
                              <div className="muted small">
                                {m.name || '—'}
                                {m.is_super_admin ? ' · super admin' : ''}
                              </div>
                            </td>
                            <td>
                              <div>{m.role}</div>
                              <div className="muted small">{roleLabel(m.role)}</div>
                            </td>
                            <td className="muted small">{m.joined_at ? timeAgo(m.joined_at) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {selected.members.length === 0 && (
                      <div className="empty-state"><p>No members</p></div>
                    )}
                  </div>
                </div>

                <form
                  className="row"
                  style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (selected && addEmail) addMembership.mutate()
                  }}
                >
                  <div className="form-field" style={{ flex: 1, minWidth: 180 }}>
                    <label className="input-label">Add existing user</label>
                    <input
                      className="input"
                      type="email"
                      placeholder="user@email.com"
                      value={addEmail}
                      onChange={(e) => setAddEmail(e.target.value)}
                      required
                    />
                  </div>
                  <select className="select" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                    {MEMBERSHIP_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button type="submit" className="btn" disabled={addMembership.isPending}>
                    Add
                  </button>
                  <label className="row small muted" style={{ gap: '0.4rem', marginLeft: 'auto' }}>
                    Suspend
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={selected.suspended}
                        disabled={patchOrg.isPending}
                        onChange={(e) => patchOrg.mutate({ id: selected.id, suspended: e.target.checked })}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </label>
                </form>
                {addMembership.error && <p className="error">{(addMembership.error as Error).message}</p>}

                <div>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.65rem' }}>
                    <div className="section-title" style={{ margin: 0 }}>
                      AI turns
                      <span className="muted small" style={{ marginLeft: 8, fontWeight: 500 }}>
                        one row per message / turn
                      </span>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {([7, 30, null] as const).map((d) => (
                        <button
                          key={String(d)}
                          type="button"
                          className={`btn btn-ghost btn-sm${turnDays === d ? ' active' : ''}`}
                          onClick={() => {
                            setTurnDays(d)
                            setTurnSkip(0)
                          }}
                        >
                          {d ? `${d}d` : 'All'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Who</th>
                          <th>Source</th>
                          <th>In</th>
                          <th>Out</th>
                          <th>Total</th>
                          <th>Credits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {turns.map((t) => (
                          <tr key={t.id}>
                            <td className="muted small">{t.created_at ? timeAgo(t.created_at) : '—'}</td>
                            <td>
                              <div>{t.user_email || t.conversation_title || '—'}</div>
                              <div className="muted small">{t.model || t.source}</div>
                            </td>
                            <td className="muted small">{t.source}</td>
                            <td className="platform-num">{fmtNum(t.prompt_tokens)}</td>
                            <td className="platform-num">{fmtNum(t.completion_tokens)}</td>
                            <td className="platform-num" style={{ fontWeight: 650 }}>{fmtNum(t.total_tokens)}</td>
                            <td className="platform-num">{fmtNum(t.credits)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {turnsQ.isLoading && <p className="muted" style={{ padding: '1rem' }}>Loading turns…</p>}
                    {!turnsQ.isLoading && turns.length === 0 && (
                      <div className="empty-state"><p>No AI turns in this window</p></div>
                    )}
                  </div>
                  {turnsTotal > turns.length && (
                    <div className="row" style={{ marginTop: '0.65rem', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={turnSkip === 0}
                        onClick={() => setTurnSkip((n) => Math.max(0, n - 50))}
                      >
                        Previous
                      </button>
                      <span className="muted small">
                        {turnSkip + 1}–{Math.min(turnSkip + turns.length, turnsTotal)} of {fmtNum(turnsTotal)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={turnSkip + turns.length >= turnsTotal}
                        onClick={() => setTurnSkip((n) => n + 50)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        <section>
          <div className="section-title" style={{ marginBottom: '0.75rem' }}>
            All users
            <span className="muted small" style={{ marginLeft: 8, fontWeight: 500 }}>
              platform flag is users.is_super_admin — not a membership role
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Organizations</th>
                  <th>Joined</th>
                  <th>Super admin</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.email}</div>
                      <div className="muted small">{u.name || '—'}</div>
                    </td>
                    <td>
                      {u.organizations.length === 0 ? (
                        <span className="muted small">No org</span>
                      ) : (
                        <div className="platform-chips">
                          {u.organizations.map((o) => (
                            <button
                              key={`${u.id}-${o.id}`}
                              type="button"
                              className="platform-chip"
                              onClick={() => {
                                setSelectedOrgId(o.id)
                                setTurnSkip(0)
                              }}
                            >
                              {o.name}
                              <span>{o.role}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="muted small">{u.created_at ? timeAgo(u.created_at) : '—'}</td>
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
            {filteredUsers.length === 0 && !overviewQ.isLoading && (
              <div className="empty-state"><p>No users match</p></div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
