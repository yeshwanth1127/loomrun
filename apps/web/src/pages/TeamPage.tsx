import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Shield, UserPlus, Users } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import type { SubscriptionInfo } from '../lib/entitlements'

type Member = {
  membership_id: string
  user_id: string
  email: string
  name: string | null
  role: string
  whatsapp_phone: string | null
  created_at: string
}

const ROLES = ['TELECALLER'] as const

const ROLE_COLOR: Record<string, string> = {
  OWNER:      'badge-indigo',
  SALES:      'badge-green',
  TELECALLER: 'badge-blue',
  PRODUCTION: 'badge-amber',
  VIEWER:     'badge-slate',
}

export function TeamPage() {
  const { orgId, me } = useAuth()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<string>('TELECALLER')
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [editingPhone, setEditingPhone] = useState<Record<string, string>>({})

  const membership = me?.organizations.find((o) => o.organization.id === orgId)
  const isOwner = membership?.role === 'OWNER'

  const q = useQuery({
    queryKey: ['org-members', orgId],
    enabled: !!orgId && isOwner,
    queryFn: () => apiFetch<{ items: Member[] }>(`/v1/orgs/${orgId}/members`),
  })

  const subQ = useQuery({
    queryKey: ['subscription', orgId],
    enabled: !!orgId && isOwner,
    queryFn: () => apiFetch<SubscriptionInfo>(`/v1/orgs/${orgId}/subscription`),
  })

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/members`, {
        method: 'POST',
        json: {
          email,
          password,
          name: name || undefined,
          role,
          whatsapp_phone: whatsappPhone || undefined,
        },
      }),
    onSuccess: () => {
      setEmail(''); setPassword(''); setName(''); setWhatsappPhone('')
      void qc.invalidateQueries({ queryKey: ['org-members', orgId] })
      void qc.invalidateQueries({ queryKey: ['subscription', orgId] })
    },
  })

  const updatePhone = useMutation({
    mutationFn: (p: { membership_id: string; whatsapp_phone: string }) =>
      apiFetch(`/v1/orgs/${orgId}/members/${p.membership_id}`, {
        method: 'PATCH',
        json: { whatsapp_phone: p.whatsapp_phone || null },
      }),
    onSuccess: () => {
      toast.success('WhatsApp number saved')
      void qc.invalidateQueries({ queryKey: ['org-members', orgId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save phone'),
  })

  if (!orgId) return (
    <PageHeader title="Team" description="Select an organization." />
  )

  if (!isOwner) return (
    <>
      <PageHeader title="Team" description="Manage your organization members and roles." />
      <div className="page-body">
        <div className="card" style={{ maxWidth: 420 }}>
          <Shield size={24} style={{ color: '#94a3b8', marginBottom: '0.5rem' }} />
          <p>Only the organization owner can manage team members.</p>
        </div>
      </div>
    </>
  )

  const members = q.data?.items ?? []

  return (
    <>
      <PageHeader
        title="Team"
        description={
          <>
            {members.length} member{members.length !== 1 ? 's' : ''} · {membership?.organization?.name}
            {subQ.data && (
              <> · {subQ.data.seats.used}/{subQ.data.seats.limit} seats</>
            )}
          </>
        }
      />

      <div className="page-body stack" style={{ gap: '1.5rem' }}>

        {/* Add member */}
        <section>
          <div className="section-title">Add Team Member</div>
          <div className="card" style={{ maxWidth: 640 }}>
            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                if (email.trim() && password.length >= 8) void create.mutateAsync()
              }}
            >
              <div className="row" style={{ gap: '0.75rem' }}>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Email *</label>
                  <input className="input" type="email" required placeholder="member@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} autoComplete="off" />
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Password * (min 8)</label>
                  <input className="input" type="password" required minLength={8} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%' }} autoComplete="new-password" />
                </div>
              </div>
              <div className="row" style={{ gap: '0.75rem' }}>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Name</label>
                  <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div className="form-field">
                  <label className="input-label">Role</label>
                  <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-field">
                <label className="input-label">WhatsApp number (for follow-up reminders)</label>
                <input
                  className="input"
                  type="tel"
                  placeholder="9876543210"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value)}
                  style={{ width: '100%', maxWidth: 280 }}
                />
                <p className="muted small" style={{ marginTop: '0.25rem' }}>
                  Reminders are sent from your org’s linked WhatsApp to this number.
                </p>
              </div>
              {create.error && <p className="error">{(create.error as Error).message}</p>}
              {create.isSuccess && <p className="success">Member added. They can sign in with that email and password.</p>}
              <div>
                <button type="submit" className="btn" disabled={create.isPending}>
                  <UserPlus size={15} />
                  {create.isPending ? 'Adding…' : 'Add member'}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Members list */}
        <section>
          <div className="section-title">Members</div>
          {q.isLoading && <p className="muted">Loading…</p>}
          {q.error && <p className="error">{(q.error as Error).message}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>WhatsApp</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const initials = (m.name ?? m.email).slice(0, 2).toUpperCase()
                  const draft = editingPhone[m.membership_id] ?? m.whatsapp_phone ?? ''
                  return (
                    <tr key={m.membership_id}>
                      <td>
                        <div className="row" style={{ gap: '0.6rem' }}>
                          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: '0.75rem' }}>{initials}</div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{m.email}</div>
                            {m.name && <div className="muted small">{m.name}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${ROLE_COLOR[m.role] ?? 'badge-slate'}`}>{m.role}</span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
                          <input
                            className="input"
                            type="tel"
                            placeholder="WhatsApp #"
                            value={draft}
                            onChange={(e) =>
                              setEditingPhone((prev) => ({ ...prev, [m.membership_id]: e.target.value }))
                            }
                            style={{ width: 140, fontSize: '0.8rem' }}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={updatePhone.isPending || draft === (m.whatsapp_phone ?? '')}
                            onClick={() =>
                              void updatePhone.mutateAsync({
                                membership_id: m.membership_id,
                                whatsapp_phone: draft,
                              })
                            }
                          >
                            Save
                          </button>
                        </div>
                      </td>
                      <td className="muted small">
                        {new Date(m.created_at).toLocaleDateString('en-IN')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {members.length === 0 && !q.isLoading && (
              <div className="empty-state">
                <Users size={28} />
                <p>No members yet. Add your first team member.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
