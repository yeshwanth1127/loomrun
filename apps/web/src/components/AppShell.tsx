import { useQuery } from '@tanstack/react-query'
import {
  BarChart2,
  Building2,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  MessageCircle,
  Palette,
  Phone,
  Smartphone,
  Users,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type OrgBrandMeta = {
  legal_name: string | null
  has_logo: boolean
  updated_at: string
}

const NAV = [
  { to: '/app/leads',              icon: LayoutDashboard, label: 'Leads' },
  { to: '/app/telecaller',         icon: Phone,           label: 'Telecaller' },
  { to: '/app/leads/connections',  icon: Link2,           label: 'Integrations' },
  { to: '/app/quotations',         icon: FileText,        label: 'Quotations' },
  { to: '/app/production',         icon: Zap,             label: 'Production' },
  { to: '/app/whatsapp',           icon: MessageCircle,   label: 'WhatsApp' },
]

const CEO_NAV = [
  { to: '/app/ceo', icon: BarChart2, label: 'CEO Dashboard' },
]

export function AppShell() {
  const { me, loading, orgId, setOrgId, logout } = useAuth()
  const navigate = useNavigate()
  const membership = me?.organizations.find((o) => o.organization.id === orgId)
  const isOwner = membership?.role === 'OWNER'
  const orgName = membership?.organization?.name ?? ''

  const brandMeta = useQuery({
    queryKey: ['org-brand', orgId],
    enabled: !!orgId && !!membership,
    queryFn: () => apiFetch<OrgBrandMeta>(`/v1/orgs/${orgId}/brand`),
  })

  const [sidebarLogoUrl, setSidebarLogoUrl] = useState<string | null>(null)

  useEffect(() => {
    let revoked: string | null = null
    if (!orgId || !brandMeta.data?.has_logo) {
      setSidebarLogoUrl(null)
      return () => {}
    }
    const token = localStorage.getItem('access_token')
    ;(async () => {
      const res = await fetch(`${apiBase}/v1/orgs/${orgId}/brand/logo`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      })
      if (!res.ok) {
        setSidebarLogoUrl(null)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      revoked = url
      setSidebarLogoUrl(url)
    })().catch(() => setSidebarLogoUrl(null))
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [orgId, brandMeta.data?.has_logo, brandMeta.data?.updated_at])

  const legal = brandMeta.data?.legal_name?.trim()
  const sidebarTitle = legal || orgName || 'Workspace'
  const sidebarSubtitle = legal && legal !== orgName ? orgName : undefined

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (!me) return <Navigate to="/login" replace />

  if (!orgId && me.organizations.length === 0 && !me.is_super_admin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <p className="muted" style={{ marginBottom: '1rem' }}>No organization yet.</p>
          <button type="button" className="btn" onClick={() => navigate('/register')}>Create account</button>
        </div>
      </div>
    )
  }

  const initials = (me.name ?? me.email).slice(0, 2).toUpperCase()

  return (
    <div className="layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          {sidebarLogoUrl ? (
            <img className="sidebar-brand-logo-img" src={sidebarLogoUrl} alt="" />
          ) : (
            <div className="sidebar-brand-icon">{orgName ? orgName.slice(0, 1).toUpperCase() : 'L'}</div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="sidebar-brand-name">{sidebarTitle}</div>
            {sidebarSubtitle ? (
              <div className="sidebar-brand-sub">{sidebarSubtitle}</div>
            ) : null}
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="sidebar-section-label">Workspace</div>
            {NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </div>

          <div className="sidebar-section" style={{ marginTop: '0.5rem' }}>
            <div className="sidebar-section-label">Analytics</div>
            {CEO_NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </div>

          {(isOwner || me.is_super_admin) && (
            <div className="sidebar-section" style={{ marginTop: '0.5rem' }}>
              <div className="sidebar-section-label">Settings</div>
              {isOwner && (
                <>
                  <NavLink
                    to="/app/settings/telephony"
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  >
                    <Smartphone size={16} />
                    Telephony
                  </NavLink>
                  <NavLink
                    to="/app/brand-assets"
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  >
                    <Palette size={16} />
                    Brand assets
                  </NavLink>
                  <NavLink
                    to="/app/team"
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  >
                    <Users size={16} />
                    Team
                  </NavLink>
                </>
              )}
              {me.is_super_admin && (
                <NavLink
                  to="/app/admin"
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Building2 size={16} />
                  Platform Admin
                </NavLink>
              )}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          {me.organizations.length > 0 && (
            <select
              className="org-switcher"
              value={orgId ?? ''}
              onChange={(e) => setOrgId(e.target.value || null)}
              aria-label="Organization"
            >
              {me.organizations.map((o) => (
                <option key={o.organization.id} value={o.organization.id}>
                  {o.organization.name}{o.organization.suspended ? ' (suspended)' : ''}
                </option>
              ))}
            </select>
          )}
          <div className="user-row">
            <div className="user-avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-email">{me.email}</div>
              {membership?.role && (
                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {membership.role}
                </div>
              )}
            </div>
            <button type="button" className="btn-logout" onClick={() => logout()} title="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
