import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart2,
  Bot,
  Building2,
  CalendarClock,
  CreditCard,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Palette,
  Phone,
  LayoutTemplate,
  Receipt,
  Smartphone,
  Sun,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { AgentActivityDock } from './AgentActivityDock'
import { DateFilterBar } from './DateFilterBar'
import { SmoothScroll } from './SmoothScroll'
import { apiFetch } from '../lib/api'
import { planBadgeClass } from '../lib/entitlements'
import { membershipForOrg } from '../lib/membership'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type OrgBrandMeta = {
  legal_name: string | null
  has_logo: boolean
  updated_at: string
}

const WORKSPACE_NAV = [
  { to: '/app/leads',              icon: LayoutDashboard, label: 'Leads', end: true },
  { to: '/app/leads/follow-ups',   icon: CalendarClock,   label: 'Follow ups' },
  { to: '/app/telecaller',         icon: Phone,           label: 'Telecaller' },
  { to: '/app/quotations',         icon: FileText,        label: 'Quotations' },
  { to: '/app/invoices',           icon: FileText,        label: 'Invoices' },
  { to: '/app/production',         icon: Zap,             label: 'Production' },
  { to: '/app/expenses',           icon: Receipt,         label: 'Expenses' },
  { to: '/app/whatsapp',           icon: MessageCircle,   label: 'WhatsApp' },
  { to: '/app/ai',                 icon: Bot,             label: 'Loomrun AI' },
] as const

// Every non-owner role (Sales, Telecaller, Production, Viewer) gets this fixed,
// restricted menu — only the Owner sees the full WORKSPACE_NAV, Analytics, and Settings.
const EMPLOYEE_NAV = [
  { to: '/app/leads',            icon: LayoutDashboard, label: 'Leads', end: true },
  { to: '/app/leads/follow-ups', icon: CalendarClock,   label: 'Follow ups' },
  { to: '/app/telecaller',       icon: Phone,           label: 'Telecaller' },
  { to: '/app/ai',               icon: Bot,             label: 'Loomrun AI' },
] as const

const CEO_NAV = [
  { to: '/app/ceo', icon: BarChart2, label: 'CEO Dashboard' },
]

export function AppShell() {
  const { me, loading, orgId, setOrgId, logout } = useAuth()
  const { isDark, toggleDark } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const membership = membershipForOrg(me, orgId)
  const isOwner = membership?.role === 'OWNER'
  const hasFullAccess = isOwner || !!me?.is_super_admin
  const workspaceNav = hasFullAccess ? WORKSPACE_NAV : EMPLOYEE_NAV
  const orgName = membership?.organization?.name ?? ''
  const org = membership?.organization
  const trialExpired = !!org?.trial_expired
  const trialActive = !!org?.trial_active
  const trialDaysLeft = org?.days_left ?? null

  const brandMeta = useQuery({
    queryKey: ['org-brand', orgId],
    enabled: !!orgId && !!membership && !trialExpired,
    queryFn: () => apiFetch<OrgBrandMeta>(`/v1/orgs/${orgId}/brand`),
  })

  useEffect(() => {
    if (!trialExpired) return
    if (location.pathname.startsWith('/app/subscription')) return
    navigate('/app/subscription', { replace: true })
  }, [trialExpired, location.pathname, navigate])

  const [sidebarLogoUrl, setSidebarLogoUrl] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!navOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [navOpen])

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
      <div className="app-loading">
        <div className="app-loading-mark">L</div>
        <p className="muted">Loading workspace…</p>
      </div>
    )
  }

  if (!me) return <Navigate to="/login" replace />

  // Super admins without a tenant org belong in the platform console
  if (me.is_super_admin && me.organizations.length === 0) {
    return <Navigate to="/platform" replace />
  }

  if (!orgId && me.organizations.length === 0) {
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
      <aside className={navOpen ? 'sidebar open' : 'sidebar'}>
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
            {workspaceNav.map(({ to, icon: Icon, label, ...rest }) => (
              <NavLink
                key={to}
                to={to}
                end={'end' in rest ? rest.end : undefined}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </div>

          {hasFullAccess && (
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
          )}

          {hasFullAccess && (
            <div className="sidebar-section" style={{ marginTop: '0.5rem' }}>
              <div className="sidebar-section-label">Settings</div>
              {isOwner && (
                <>
                  <NavLink
                    to="/app/leads/connections"
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  >
                    <Link2 size={16} />
                    Integrations
                  </NavLink>
                  <NavLink
                    to="/app/settings/telephony"
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  >
                    <Smartphone size={16} />
                    Telephony
                  </NavLink>
                  <NavLink
                    to="/app/document-templates"
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  >
                    <LayoutTemplate size={16} />
                    Document templates
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
                  <NavLink
                    to="/app/subscription"
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  >
                    <CreditCard size={16} />
                    Subscription
                  </NavLink>
                </>
              )}
              {me.is_super_admin && (
                <NavLink to="/platform" className="nav-item">
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
          {membership?.organization?.plan && (
            <div className="row" style={{ gap: '0.4rem', padding: '0 0.25rem 0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${planBadgeClass(membership.organization.plan)}`} style={{ textTransform: 'capitalize' }}>
                {membership.organization.plan}
              </span>
              {trialActive && trialDaysLeft != null && (
                <span className="badge badge-amber">{trialDaysLeft}d left</span>
              )}
              {trialExpired && <span className="badge badge-red">Trial ended</span>}
              {isOwner && (
                <NavLink to="/app/subscription" className="muted small" style={{ textDecoration: 'none' }}>
                  Manage
                </NavLink>
              )}
            </div>
          )}
          <div className="user-row">
            <div className="user-avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-email">{me.email}</div>
              {membership?.role && (
                <div className="user-role">
                  {membership.role}
                </div>
              )}
            </div>
            <button type="button" className="btn-logout" onClick={() => toggleDark()} title={isDark ? 'Light mode' : 'Dark mode'}>
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button type="button" className="btn-logout" onClick={() => logout()} title="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* App-wide agent readout: visible on every page, not just the chat. */}
      <AgentActivityDock />

      {navOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Main ── */}
      <main className="main">
        <header className="mobile-topbar">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
          >
            {navOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <span className="mobile-topbar-title">{sidebarTitle}</span>
        </header>
        {trialActive && trialDaysLeft != null && (
          <div
            className="row"
            style={{
              gap: '0.5rem',
              padding: '0.55rem 1rem',
              background: 'rgba(245, 158, 11, 0.12)',
              borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
              fontSize: '0.85rem',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>
              Free trial: <strong>{trialDaysLeft}</strong> day{trialDaysLeft === 1 ? '' : 's'} left — Scale features with limited capacity.
            </span>
            {isOwner && (
              <NavLink to="/app/subscription" style={{ fontWeight: 600 }}>
                View plans
              </NavLink>
            )}
          </div>
        )}
        {trialExpired && (
          <div
            className="row"
            style={{
              gap: '0.5rem',
              padding: '0.55rem 1rem',
              background: 'rgba(220, 38, 38, 0.1)',
              borderBottom: '1px solid rgba(220, 38, 38, 0.35)',
              fontSize: '0.85rem',
              alignItems: 'center',
            }}
          >
            <span>Your free trial has ended. Upgrade to Growth or Scale to continue.</span>
            <NavLink to="/app/subscription" style={{ fontWeight: 600 }}>
              Upgrade now
            </NavLink>
          </div>
        )}
        {!trialExpired && <DateFilterBar />}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <SmoothScroll
              enabled={
                location.pathname !== '/app/leads' &&
                location.pathname !== '/app/ai' &&
                location.pathname !== '/app/telecaller'
              }
              style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
            >
              <Outlet />
            </SmoothScroll>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
