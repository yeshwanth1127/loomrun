import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart2,
  ExternalLink,
  LogOut,
  Moon,
  Sun,
} from 'lucide-react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { NoolrunWordmark } from './react-bits/NoolrunWordmark'
import { SmoothScroll } from './SmoothScroll'

const NAV = [
  { to: '/platform', end: true, icon: BarChart2, label: 'Overview' },
] as const

export function PlatformAdminShell() {
  const { me, loading, logout } = useAuth()
  const { isDark, toggleDark } = useTheme()
  const location = useLocation()

  if (loading) {
    return (
      <div className="app-loading">
        <img src="/noolrun-mark.png?v=5" alt="" className="app-loading-mark" />
        <p className="muted">Loading platform…</p>
      </div>
    )
  }

  if (!me) return <Navigate to="/login" replace />
  if (!me.is_super_admin) return <Navigate to="/app" replace />

  const initials = (me.name ?? me.email).slice(0, 2).toUpperCase()
  const hasOrgs = me.organizations.length > 0

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-copy">
            <NoolrunWordmark size="nav" className="sidebar-noolrun-wordmark" />
            <div className="sidebar-brand-sub">Platform Admin</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="sidebar-section-label">Admin</div>
            {NAV.map(({ to, end, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </div>

          {hasOrgs && (
            <div className="sidebar-section" style={{ marginTop: '0.75rem' }}>
              <div className="sidebar-section-label">Support</div>
              <NavLink to="/app" className="nav-item">
                <ExternalLink size={16} />
                Open customer app
              </NavLink>
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-row">
            <div className="user-avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-email">{me.email}</div>
              <div className="user-role">Super admin</div>
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

      <main className="main">
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
              enabled={false}
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
