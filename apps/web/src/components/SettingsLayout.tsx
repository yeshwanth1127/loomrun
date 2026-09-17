import {
  Activity,
  CreditCard,
  LayoutTemplate,
  Link2,
  MessageCircle,
  Palette,
  Smartphone,
  Users,
} from 'lucide-react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { routes } from '../lib/appRoutes'
import { isOwnerRole, membershipForOrg } from '../lib/membership'

/** Grouped so people look for a job ("get paid", "add a person"), not a feature name. */
const SETTINGS_GROUPS = [
  {
    title: 'Connections',
    items: [
      { to: routes.settings('connections'), icon: Link2, label: 'Lead sources' },
      { to: routes.settings('whatsapp'), icon: MessageCircle, label: 'WhatsApp' },
      { to: routes.settings('calling'), icon: Smartphone, label: 'Calling' },
    ],
  },
  {
    title: 'Brand & documents',
    items: [
      { to: routes.settings('brand'), icon: Palette, label: 'Brand' },
      { to: routes.settings('documents'), icon: LayoutTemplate, label: 'Quote & invoice look' },
    ],
  },
  {
    title: 'Team',
    items: [{ to: routes.settings('team'), icon: Users, label: 'People' }],
  },
  {
    title: 'Plan & usage',
    items: [
      { to: routes.settings('plan'), icon: CreditCard, label: 'Plan' },
      { to: routes.settings('usage'), icon: Activity, label: 'Usage' },
    ],
  },
] as const

export function SettingsLayout() {
  const { me, orgId } = useAuth()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership)
  const hasFullAccess = isOwner || !!me?.is_super_admin

  if (!hasFullAccess) {
    return <Navigate to="/app/home" replace />
  }

  return (
    <div className="settings-layout">
      <aside className="settings-nav" aria-label="Settings">
        <div className="settings-nav-title">Settings</div>
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.title} className="settings-nav-group">
            <div className="settings-nav-group-title">{group.title}</div>
            {group.items.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `settings-nav-item${isActive ? ' active' : ''}`}
              >
                <Icon size={15} />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </aside>
      <div className="settings-content">
        <Outlet />
      </div>
    </div>
  )
}
