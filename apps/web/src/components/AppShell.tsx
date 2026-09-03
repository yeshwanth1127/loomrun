import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart2,
  Bot,
  Building2,
  CalendarClock,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Phone,
  Receipt,
  Settings,
  Store,
  Sun,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { AgentActivityDock } from './AgentActivityDock'
import { DateFilterBar } from './DateFilterBar'
import { SmoothScroll } from './SmoothScroll'
import { apiFetch } from '../lib/api'
import { planBadgeClass } from '../lib/entitlements'
import { membershipForOrg } from '../lib/membership'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const NAV_GROUPS_KEY = 'loomrun-nav-groups-v1'

type OrgBrandMeta = {
  legal_name: string | null
  has_logo: boolean
  updated_at: string
}

type NavItem = {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
  badge?: 'follow-ups'
}

type NavGroup = {
  id: string
  label: string
  items: NavItem[]
}

const SETTINGS_PATHS = [
  '/app/leads/connections',
  '/app/settings/telephony',
  '/app/document-templates',
  '/app/brand-assets',
  '/app/team',
  '/app/subscription',
] as const

const CEO_NAV: NavItem[] = [
  { to: '/app/ceo', icon: BarChart2, label: 'CEO Dashboard' },
]

function isSettingsPath(pathname: string) {
  return (SETTINGS_PATHS as readonly string[]).includes(pathname)
}

function buildWorkspaceGroups(hasFullAccess: boolean, isProduction: boolean): NavGroup[] {
  const crm: NavItem[] = [
    { to: '/app/leads', icon: LayoutDashboard, label: 'Leads', end: true },
    { to: '/app/leads/follow-ups', icon: CalendarClock, label: 'Follow ups', badge: 'follow-ups' },
    { to: '/app/telecaller', icon: Phone, label: 'Telecaller' },
  ]
  const ai: NavItem[] = [
    { to: '/app/ai', icon: Bot, label: 'Loomrun AI' },
  ]

  if (!hasFullAccess) {
    const groups: NavGroup[] = [{ id: 'crm', label: 'CRM', items: crm }]
    if (isProduction) {
      groups.push({
        id: 'ops',
        label: 'Ops',
        items: [{ to: '/app/production', icon: Zap, label: 'Production' }],
      })
    }
    groups.push({ id: 'ai', label: 'AI', items: ai })
    return groups
  }

  return [
    { id: 'crm', label: 'CRM', items: crm },
    {
      id: 'commerce',
      label: 'Commerce',
      items: [
        { to: '/app/quotations', icon: FileText, label: 'Quotations' },
        { to: '/app/invoices', icon: FileText, label: 'Invoices' },
      ],
    },
    {
      id: 'ops',
      label: 'Ops',
      items: [
        { to: '/app/production', icon: Zap, label: 'Production' },
        { to: '/app/vendors', icon: Store, label: 'Vendors' },
        { to: '/app/expenses', icon: Receipt, label: 'Expenses' },
        { to: '/app/whatsapp', icon: MessageCircle, label: 'WhatsApp' },
      ],
    },
    { id: 'ai', label: 'AI', items: ai },
  ]
}

function loadOpenGroups(ids: string[]): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_GROUPS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, boolean>
      const next: Record<string, boolean> = {}
      for (const id of ids) next[id] = parsed[id] ?? true
      return next
    }
  } catch {
    /* ignore */
  }
  return Object.fromEntries(ids.map((id) => [id, true]))
}

function NavItemLink({
  item,
  dueCount,
}: {
  item: NavItem
  dueCount: number
}) {
  const { to, icon: Icon, label, end, badge } = item
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      <Icon size={16} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge === 'follow-ups' && dueCount > 0 && (
        <span
          className="badge badge-red"
          style={{ marginLeft: 'auto', fontSize: '0.65rem', minWidth: '1.25rem', textAlign: 'center' }}
        >
          {dueCount > 99 ? '99+' : dueCount}
        </span>
      )}
    </NavLink>
  )
}

export function AppShell() {
  const { me, loading, orgId, setOrgId, logout } = useAuth()
  const { isDark, toggleDark } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const membership = membershipForOrg(me, orgId)
  const isOwner = membership?.role === 'OWNER'
  const hasFullAccess = isOwner || !!me?.is_super_admin
  const isProduction = membership?.role === 'PRODUCTION'
  const workspaceGroups = useMemo(
    () => buildWorkspaceGroups(hasFullAccess, isProduction),
    [hasFullAccess, isProduction],
  )
  const orgName = membership?.organization?.name ?? ''
  const org = membership?.organization
  const trialExpired = !!org?.trial_expired
  const trialActive = !!org?.trial_active
  const trialDaysLeft = org?.days_left ?? null
  const settingsActive = isSettingsPath(location.pathname)
  const onSpecialScrollPage =
    location.pathname === '/app/leads' ||
    location.pathname === '/app/ai' ||
    location.pathname === '/app/telecaller' ||
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
      apiFetch<{ items: Array<{ id: string; title: string; in_app_pending: boolean }>; count: number }>(
        `/v1/orgs/${orgId}/follow-ups/due`,
      ),
    refetchInterval: 30_000,
  })
  const dueCount = dueFollowUps.data?.count ?? 0
  const pendingToastIds = (dueFollowUps.data?.items ?? [])
    .filter((i) => i.in_app_pending)
    .map((i) => i.id)
  const toastedRef = useRef<Set<string>>(new Set())
  const qc = useQueryClient()

  useEffect(() => {
    if (!orgId || pendingToastIds.length === 0) return
    const fresh = pendingToastIds.filter((id) => !toastedRef.current.has(id))
    if (fresh.length === 0) return
    for (const id of fresh) toastedRef.current.add(id)
    const titles = (dueFollowUps.data?.items ?? [])
      .filter((i) => fresh.includes(i.id))
      .map((i) => i.title)
    toast.message(
      fresh.length === 1
        ? `Follow-up due: ${titles[0]}`
        : `${fresh.length} follow-ups due`,
      {
        description: titles.slice(0, 3).join(', ') + (titles.length > 3 ? '…' : ''),
        action: {
          label: 'Open',
          onClick: () => navigate('/app/leads/follow-ups'),
        },
      },
    )
    void apiFetch(`/v1/orgs/${orgId}/follow-ups/ack`, {
      method: 'POST',
      json: { lead_ids: fresh },
    }).then(() => {
      void qc.invalidateQueries({ queryKey: ['follow-ups-due', orgId] })
    }).catch(() => { /* ignore */ })
  }, [orgId, pendingToastIds.join(','), dueFollowUps.data, navigate, qc])

  useEffect(() => {
    if (!trialExpired) return
    if (location.pathname.startsWith('/app/subscription')) return
    navigate('/app/subscription', { replace: true })
  }, [trialExpired, location.pathname, navigate])

  const [sidebarLogoUrl, setSidebarLogoUrl] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const groupIds = workspaceGroups.map((g) => g.id)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    loadOpenGroups(groupIds),
  )

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev }
      let changed = false
      for (const id of groupIds) {
        if (next[id] === undefined) {
          next[id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [groupIds.join(',')])

  useEffect(() => {
    try {
      localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(openGroups))
    } catch {
      /* ignore */
    }
  }, [openGroups])

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

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="layout">
      <aside className={navOpen ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-brand">
          <img className="sidebar-brand-logo-img" src="/loomrun-mark.jpg" alt="Loom Run" />
          <div style={{ minWidth: 0 }}>
            <div className="sidebar-brand-name">Loom Run</div>
            <div className="sidebar-brand-sub">Business OS</div>
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
                  {o.organization.name}{o.organization.suspended ? ' (suspended)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="sidebar-nav">
          {workspaceGroups.map((group) => {
            const open = openGroups[group.id] !== false
            return (
              <div key={group.id} className="sidebar-section">
                <button
                  type="button"
                  className="sidebar-group-toggle"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={open}
                >
                  <span className="sidebar-group-toggle-label">{group.label}</span>
                  <ChevronDown
                    size={14}
                    style={{
                      transform: open ? undefined : 'rotate(-90deg)',
                      transition: 'transform 0.15s ease',
                      opacity: 0.7,
                    }}
                  />
                </button>
                <div className="sidebar-group-items" hidden={!open}>
                  {group.items.map((item) => (
                    <NavItemLink key={item.to} item={item} dueCount={dueCount} />
                  ))}
                </div>
              </div>
            )
          })}

          {hasFullAccess && (
            <div className="sidebar-section" style={{ marginTop: '0.5rem' }}>
              <div className="sidebar-section-label">Analytics</div>
              {CEO_NAV.map((item) => (
                <NavItemLink key={item.to} item={item} dueCount={dueCount} />
              ))}
            </div>
          )}

          {hasFullAccess && (
            <div className="sidebar-section" style={{ marginTop: '0.5rem' }}>
              <div className="sidebar-section-label">Settings</div>
              {isOwner && (
                <NavLink
                  to="/app/leads/connections"
                  className={() => `nav-item${settingsActive ? ' active' : ''}`}
                >
                  <Settings size={16} />
                  Settings
                </NavLink>
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
            {sidebarLogoUrl ? (
              <img className="user-avatar" src={sidebarLogoUrl} alt="" style={{ objectFit: 'cover' }} />
            ) : (
              <div className="user-avatar">{orgName ? orgName.slice(0, 2).toUpperCase() : initials}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-email">{sidebarTitle || me.name || me.email}</div>
              {membership?.role && (
                <div className="user-role">
                  {membership.role.charAt(0) + membership.role.slice(1).toLowerCase()}
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

      <AgentActivityDock />

      {navOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
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
            {isOwner && (
              <NavLink to="/app/subscription">View plans</NavLink>
            )}
          </div>
        )}
        {trialExpired && (
          <div className="trial-banner trial-banner--expired">
            <span>Trial ended — upgrade to continue</span>
            <NavLink to="/app/subscription">Upgrade now</NavLink>
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
            style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <SmoothScroll
              enabled={!onSpecialScrollPage}
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
