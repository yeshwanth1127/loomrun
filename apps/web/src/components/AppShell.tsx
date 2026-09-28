import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3,
  Bot,
  Building2,
  FileText,
  GitBranch,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Plug,
  Receipt,
  Settings,
  Store,
  Sun,
  Wallet,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { AgentActivityDock } from './AgentActivityDock'
import { DateFilterBar } from './DateFilterBar'
import { GlobalSearch } from './GlobalSearch'
import { NoolrunWordmark } from './react-bits/NoolrunWordmark'
import { SmoothScroll } from './SmoothScroll'
import { apiFetch } from '../lib/api'
import { routes } from '../lib/appRoutes'
import { planBadgeClass } from '../lib/entitlements'
import { isProductionRole, isTelecallerRole, membershipForOrg, roleLabel } from '../lib/membership'
import {
  isAiPath,
  isBusinessPath,
  isHomePath,
  isMoneyExpensesPath,
  isMoneyInvoicesPath,
  isMoneyQuotationsPath,
  isMoneySuppliersPath,
  isOrdersPath,
  isPipelinesPath,
  isSalesPath,
  isSettingsPath,
} from '../lib/navPaths'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type OrgBrandMeta = {
  legal_name: string | null
  has_logo: boolean
  updated_at: string
}

type NavSectionId =
  | 'overview'
  | 'sales'
  | 'orders'
  | 'money'
  | 'ai'
  | 'analytics'
  | 'settings'
  | 'account'

type PrimaryNavItem = {
  id: string
  section: NavSectionId
  to: string
  icon: LucideIcon
  label: string
  badge?: 'follow-ups'
  match: (pathname: string) => boolean
  /** Owner / super-admin only */
  fullAccessOnly?: boolean
  /** Telecaller (+ sales) personal connections */
  telecallerConnections?: boolean
}

const SECTION_ORDER: NavSectionId[] = [
  'overview',
  'sales',
  'orders',
  'money',
  'ai',
  'analytics',
  'account',
  'settings',
]

const SECTION_LABELS: Record<NavSectionId, string> = {
  overview: 'Overview',
  sales: 'Sales',
  orders: 'Orders',
  money: 'Money',
  ai: 'AI',
  analytics: 'Analytics',
  account: 'Account',
  settings: 'Settings',
}

const PRIMARY_NAV: PrimaryNavItem[] = [
  {
    id: 'home',
    section: 'overview',
    to: routes.home,
    icon: Home,
    label: 'Home',
    match: isHomePath,
  },
  {
    id: 'sales',
    section: 'sales',
    to: routes.sales(),
    icon: LayoutDashboard,
    label: 'Sales',
    badge: 'follow-ups',
    match: isSalesPath,
  },
  {
    id: 'pipelines',
    section: 'sales',
    to: routes.salesOrganize,
    icon: GitBranch,
    label: 'Pipelines',
    match: isPipelinesPath,
  },
  {
    id: 'my-connections',
    section: 'account',
    to: '/app/my-connections',
    icon: Plug,
    label: 'My Connections',
    match: (pathname) => pathname.startsWith('/app/my-connections'),
    telecallerConnections: true,
  },
  {
    id: 'orders',
    section: 'orders',
    to: routes.orders(),
    icon: Package,
    label: 'Orders',
    match: isOrdersPath,
  },
  {
    id: 'quotations',
    section: 'money',
    to: routes.money('quotations'),
    icon: FileText,
    label: 'Quotations',
    match: isMoneyQuotationsPath,
    fullAccessOnly: true,
  },
  {
    id: 'invoices',
    section: 'money',
    to: routes.money('invoices'),
    icon: Receipt,
    label: 'Invoices',
    match: isMoneyInvoicesPath,
    fullAccessOnly: true,
  },
  {
    id: 'expenses',
    section: 'money',
    to: routes.money('expenses'),
    icon: Wallet,
    label: 'Expense',
    match: isMoneyExpensesPath,
    fullAccessOnly: true,
  },
  {
    id: 'suppliers',
    section: 'money',
    to: routes.money('suppliers'),
    icon: Store,
    label: 'Suppliers',
    match: isMoneySuppliersPath,
    fullAccessOnly: true,
  },
  {
    id: 'ai',
    section: 'ai',
    to: routes.ai,
    icon: Bot,
    label: 'Ask NoolRun AI',
    match: isAiPath,
  },
  {
    id: 'business',
    section: 'analytics',
    to: routes.business,
    icon: BarChart3,
    label: 'CEO Dashboard',
    match: isBusinessPath,
    fullAccessOnly: true,
  },
  {
    id: 'settings',
    section: 'settings',
    to: routes.settings(),
    icon: Settings,
    label: 'Settings',
    match: isSettingsPath,
    fullAccessOnly: true,
  },
]

function navVisible(
  item: PrimaryNavItem,
  hasFullAccess: boolean,
  isProduction: boolean,
  isTelecaller: boolean,
  isSales: boolean,
): boolean {
  if (item.telecallerConnections) return !hasFullAccess && (isTelecaller || false)
  if (item.fullAccessOnly) return hasFullAccess
  // Same audience as Sales → Organize (owners + Sales role).
  if (item.id === 'pipelines') return hasFullAccess || isSales
  // Production roles: Home + Orders (+ Ask AI), not Sales/Money/Settings
  if (item.id === 'sales' && isProduction && !hasFullAccess) return false
  if (item.id === 'orders') return hasFullAccess || isProduction
  return true
}

export function AppShell() {
  const { me, loading, orgId, setOrgId, logout } = useAuth()
  const { isDark, toggleDark } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const membership = membershipForOrg(me, orgId)
  const isOwner = membership?.role === 'OWNER'
  const hasFullAccess = isOwner || !!me?.is_super_admin
  const isProduction = isProductionRole(membership)
  const isTelecaller = isTelecallerRole(membership)
  const isSales = membership?.role === 'SALES'
  const visibleNav = useMemo(
    () =>
      PRIMARY_NAV.filter((item) =>
        navVisible(item, hasFullAccess, isProduction, isTelecaller, isSales),
      ),
    [hasFullAccess, isProduction, isTelecaller, isSales],
  )
  const navSections = useMemo(() => {
    return SECTION_ORDER.map((sectionId) => ({
      id: sectionId,
      label: SECTION_LABELS[sectionId],
      items: visibleNav.filter((item) => item.section === sectionId),
    })).filter((section) => section.items.length > 0)
  }, [visibleNav])
  const orgName = membership?.organization?.name ?? ''
  const org = membership?.organization
  const trialExpired = !!org?.trial_expired
  const trialActive = !!org?.trial_active
  const trialDaysLeft = org?.days_left ?? null
  const settingsActive = isSettingsPath(location.pathname)
  const onSpecialScrollPage =
    location.pathname === '/app/sales' ||
    location.pathname === '/app/home' ||
    location.pathname === '/app/ai' ||
    settingsActive

  const brandMeta = useQuery({
    queryKey: ['org-brand', orgId],
    enabled: !!orgId && !!membership && !trialExpired,
    queryFn: () => apiFetch<OrgBrandMeta>(`/v1/orgs/${orgId}/brand`),
  })

  const dueFollowUps = useQuery({
    queryKey: ['follow-ups-due', orgId],
    enabled: !!orgId && !!membership && !trialExpired,
    queryFn: () =>
      apiFetch<{
        items: Array<{ id: string; title: string }>
        count: number
        reminders: Array<{
          id: string
          title: string
          offset_minutes: number
          in_app_pending: boolean
        }>
      }>(`/v1/orgs/${orgId}/follow-ups/due`),
    refetchInterval: 30_000,
  })
  const dueCount = dueFollowUps.data?.count ?? 0
  const pendingReminders = (dueFollowUps.data?.reminders ?? []).filter((r) => r.in_app_pending)
  const toastedRef = useRef<Set<string>>(new Set())
  const qc = useQueryClient()

  useEffect(() => {
    if (!orgId || pendingReminders.length === 0) return
    const fresh = pendingReminders.filter((r) => {
      const key = `${r.id}:${r.offset_minutes}`
      return !toastedRef.current.has(key)
    })
    if (fresh.length === 0) return

    const labelFor = (mins: number) => {
      if (mins >= 60) return 'in 1 hour'
      if (mins === 1) return 'in 1 minute'
      return `in ${mins} minutes`
    }

    for (const rem of fresh) {
      toastedRef.current.add(`${rem.id}:${rem.offset_minutes}`)
      toast.message(`Follow-up ${labelFor(rem.offset_minutes)}: ${rem.title}`, {
        description: 'Open the Call tab to dial this lead.',
        duration: 12_000,
        action: {
          label: 'Open call',
          onClick: () => navigate(routes.lead(rem.id, 'call')),
        },
      })
    }

    void apiFetch(`/v1/orgs/${orgId}/follow-ups/ack`, {
      method: 'POST',
      json: {
        reminders: fresh.map((r) => ({
          lead_id: r.id,
          offset_minutes: r.offset_minutes,
        })),
      },
    })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['follow-ups-due', orgId] })
      })
      .catch(() => {
        /* ignore */
      })
  }, [orgId, pendingReminders.map((r) => `${r.id}:${r.offset_minutes}`).join(','), navigate, qc])

  useEffect(() => {
    if (!trialExpired) return
    if (location.pathname.startsWith(routes.settings('plan'))) return
    navigate(routes.settings('plan'), { replace: true })
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

  if (loading) {
    return (
      <div className="app-loading">
        <img src="/noolrun-mark.png?v=5" alt="" className="app-loading-mark" />
        <p className="muted">Loading workspace…</p>
      </div>
    )
  }

  if (!me) return <Navigate to="/login" replace />

  if (me.is_super_admin && me.organizations.length === 0) {
    return <Navigate to="/platform" replace />
  }

  if (!orgId && me.organizations.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <p className="muted" style={{ marginBottom: '1rem' }}>
            No organization yet.
          </p>
          <button type="button" className="btn" onClick={() => navigate('/register')}>
            Create account
          </button>
        </div>
      </div>
    )
  }

  const initials = (me.name ?? me.email).slice(0, 2).toUpperCase()

  return (
    <div className="layout">
      <aside className={navOpen ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-copy">
            <NoolrunWordmark size="nav" className="sidebar-noolrun-wordmark" />
          </div>
        </div>

        {me.organizations.length > 0 && (
          <div className="sidebar-org-switch">
            <select
              className="org-switcher"
              value={orgId ?? ''}
              onChange={(e) => setOrgId(e.target.value || null)}
              aria-label="Organization"
            >
              {me.organizations.map((o) => (
                <option key={o.organization.id} value={o.organization.id}>
                  {o.organization.name}
                  {o.organization.suspended ? ' (suspended)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <GlobalSearch />

        <nav className="sidebar-nav" aria-label="Primary">
          {navSections.map((section) => (
            <div key={section.id} className="sidebar-section">
              <div className="sidebar-section-label">{section.label}</div>
              <div className="sidebar-group-items">
                {section.items.map((item) => {
                  const Icon = item.icon
                  const active = item.match(location.pathname)
                  return (
                    <NavLink
                      key={item.id}
                      to={item.to}
                      end={item.id === 'home'}
                      className={() =>
                        `nav-item${active ? ' active' : ''}${item.id === 'ai' ? ' nav-item-ai' : ''}`
                      }
                    >
                      <Icon size={16} />
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {item.badge === 'follow-ups' && dueCount > 0 && (
                        <span
                          className="badge badge-red"
                          style={{
                            marginLeft: 'auto',
                            fontSize: '0.65rem',
                            minWidth: '1.25rem',
                            textAlign: 'center',
                          }}
                        >
                          {dueCount > 99 ? '99+' : dueCount}
                        </span>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}

          {me.is_super_admin && (
            <div className="sidebar-section">
              <div className="sidebar-section-label">Platform</div>
              <div className="sidebar-group-items">
                <NavLink to="/platform" className="nav-item">
                  <Building2 size={16} />
                  Platform Admin
                </NavLink>
              </div>
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          {membership?.organization?.plan && (
            <div
              className="row"
              style={{
                gap: '0.4rem',
                padding: '0.35rem 0.25rem',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span
                className={`badge ${planBadgeClass(membership.organization.plan)}`}
                style={{ textTransform: 'capitalize' }}
              >
                {membership.organization.plan}
              </span>
              {trialActive && trialDaysLeft != null && (
                <span className="badge badge-amber">{trialDaysLeft}d left</span>
              )}
              {trialExpired && <span className="badge badge-red">Trial ended</span>}
              {isOwner && (
                <NavLink
                  to={routes.settings('plan')}
                  className="muted small"
                  style={{ textDecoration: 'none' }}
                >
                  Manage
                </NavLink>
              )}
            </div>
          )}
          <div className="user-row">
            {sidebarLogoUrl ? (
              <img
                className="user-avatar"
                src={sidebarLogoUrl}
                alt=""
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <div className="user-avatar">
                {orgName ? orgName.slice(0, 2).toUpperCase() : initials}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-email">{sidebarTitle || me.name || me.email}</div>
              {membership?.role && (
                <div className="user-role">
                  {membership.role.charAt(0) + membership.role.slice(1).toLowerCase()}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn-logout"
              onClick={() => toggleDark()}
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button type="button" className="btn-logout" onClick={() => logout()} title="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <AgentActivityDock />

      {navOpen && (
        <div className="sidebar-overlay" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

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
          <div className="trial-banner trial-banner--active">
            <span>
              Free trial: <strong>{trialDaysLeft}</strong> day{trialDaysLeft === 1 ? '' : 's'} left
            </span>
            {isOwner && <NavLink to={routes.settings('plan')}>View plans</NavLink>}
          </div>
        )}
        {trialExpired && (
          <div className="trial-banner trial-banner--expired">
            <span>Trial ended — upgrade to continue</span>
            <NavLink to={routes.settings('plan')}>Upgrade now</NavLink>
          </div>
        )}
        {!trialExpired && <DateFilterBar compact />}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={settingsActive ? 'settings' : location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <SmoothScroll
              enabled={!onSpecialScrollPage}
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Outlet />
            </SmoothScroll>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
