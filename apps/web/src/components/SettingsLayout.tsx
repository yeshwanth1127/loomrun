import {
  CreditCard,
  Link2,
  LayoutTemplate,
  Palette,
  Smartphone,
  Users,
} from 'lucide-react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isOwnerRole, membershipForOrg } from '../lib/membership'

const SETTINGS_NAV = [
  { to: '/app/leads/connections', icon: Link2, label: 'Integrations' },
  { to: '/app/settings/telephony', icon: Smartphone, label: 'Telephony' },
  { to: '/app/document-templates', icon: LayoutTemplate, label: 'Document templates' },
  { to: '/app/brand-assets', icon: Palette, label: 'Brand assets' },
  { to: '/app/team', icon: Users, label: 'Team' },
  { to: '/app/subscription', icon: CreditCard, label: 'Subscription' },
] as const

export function SettingsLayout() {
  const { me, orgId } = useAuth()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership)
  const hasFullAccess = isOwner || !!me?.is_super_admin

  if (!hasFullAccess) {
    return <Navigate to="/app/leads" replace />
  }

  return (
    <div className="settings-layout">
      <aside className="settings-nav" aria-label="Settings">
        <div className="settings-nav-title">Settings</div>
        {SETTINGS_NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `settings-nav-item${isActive ? ' active' : ''}`}
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </aside>
      <div className="settings-content">
        <Outlet />
      </div>
    </div>
  )
}
