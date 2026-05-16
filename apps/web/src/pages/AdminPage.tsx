import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  CalendarDays,
  Shield,
  UserPlus,
  Users,
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

const MEMBERSHIP_ROLES = ['VIEWER', 'SALES', 'TELECALLER', 'PRODUCTION', 'OWNER'] as const

const PLAN_COLOR: Record<string, string> = {
  FREE: 'badge-slate',
  STARTER: 'badge-blue',
  PRO: 'badge-indigo',
  ENTERPRISE: 'badge-purple',
}

function OrgCard({
  org,
  onSuspendChange,
  onJoin,
  joinPending,
  suspendPending,
}: {
  org: AdminOrg
  onSuspendChange: (id: string, val: boolean) => void
  onJoin: (id: string) => void
  joinPending: boolean
  suspendPending: boolean
}) {
  const initials = org.name.slice(0, 2).toUpperCase()
  const date = new Date(org.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

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
        <span className={`badge ${PLAN_COLOR[org.plan] ?? 'badge-slate'}`}>{org.plan}</span>
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

      <div className="org-card-footer">
        <div className="row" style={{ gap: '0.5rem' }}>
          {org.suspended && <span className="badge badge-red">Suspended</span>}
          <label className="row small muted" style={{ gap: '0.4rem', cursor: 'pointer' }}>
            <span>Suspend</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={org.suspended}
                disabled={suspendPending}
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
          Join as viewer
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

  const orgsQ = useQuery({
    queryKey: ['admin', 'organizations'],
    queryFn: () => apiFetch<{ items: AdminOrg[] }>('/v1/admin/organizations'),
    enabled: !!me?.is_super_admin,
  })

  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ items: AdminUser[]; total: number }>('/v1/admin/users'),
    enabled: !!me?.is_super_admin,
  })

  const patchOrg = useMutation({
    mutationFn: (p: { id: string; suspended: boolean }) =>
      apiFetch(`/v1/admin/organizations/${p.id}`, { method: 'PATCH', json: { suspended: p.suspended } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'organizations'] }),
  })

  const patchUser = useMutation({
    mutationFn: (p: { id: string; is_super_admin: boolean }) =>
      apiFetch(`/v1/admin/users/${p.id}`, { method: 'PATCH', json: { is_super_admin: p.is_super_admin } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
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
      void qc.invalidateQueries({ queryKey: ['admin', 'organizations'] })
      void reloadMe()
    },
  })

  const joinSupport = useMutation({
    mutationFn: (orgId: string) =>
      apiFetch(`/v1/admin/organizations/${orgId}/join-as-support`, { method: 'POST' }),
    onSuccess: () => void reloadMe(),
  })

  if (!me) return null
  if (!me.is_super_admin) return <Navigate to="/app/leads" replace />

  const orgs = orgsQ.data?.items ?? []
  const users = usersQ.data?.items ?? []

  const totalLeads = orgs.reduce((s, o) => s + o.lead_count, 0)
  const totalMembers = orgs.reduce((s, o) => s + o.member_count, 0)
  const suspendedOrgs = orgs.filter((o) => o.suspended).length

  return (
    <>
      <div className="page-header">
        <h1>Platform Admin</h1>
        <p>Manage organizations, users, and platform-wide settings</p>
      </div>

      <div className="page-body stack" style={{ gap: '2rem' }}>
        {/* Summary metrics */}
        <div className="metrics-grid">
          <div className="metric-card indigo">
            <div className="metric-icon indigo"><Building2 size={18} /></div>
            <div className="metric-label">Organizations</div>
            <div className="metric-value">{orgs.length}</div>
            {suspendedOrgs > 0 && <div className="metric-sub">{suspendedOrgs} suspended</div>}
          </div>
          <div className="metric-card blue">
            <div className="metric-icon blue"><Users size={18} /></div>
            <div className="metric-label">Total members</div>
            <div className="metric-value">{totalMembers}</div>
          </div>
          <div className="metric-card green">
            <div className="metric-icon green"><Shield size={18} /></div>
            <div className="metric-label">Total leads</div>
            <div className="metric-value">{totalLeads}</div>
          </div>
          <div className="metric-card purple">
            <div className="metric-icon purple"><Users size={18} /></div>
            <div className="metric-label">Platform users</div>
            <div className="metric-value">{usersQ.data?.total ?? '—'}</div>
          </div>
        </div>

        {/* Orgs grid */}
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
                onJoin={(id) => joinSupport.mutate(id)}
                joinPending={joinSupport.isPending}
                suspendPending={patchOrg.isPending}
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

        {/* Add membership */}
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

        {/* Users table */}
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
