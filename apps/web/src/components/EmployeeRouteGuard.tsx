import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { employeeMayAccess, isOwnerRole, membershipForOrg } from '../lib/membership'

export function EmployeeRouteGuard({ children }: { children: React.ReactNode }) {
  const { me, orgId } = useAuth()
  const { pathname } = useLocation()
  const membership = membershipForOrg(me, orgId)
  const hasFullAccess = isOwnerRole(membership) || !!me?.is_super_admin

  if (!hasFullAccess && !employeeMayAccess(pathname, membership?.role)) {
    return <Navigate to="/app/leads" replace />
  }

  return children
}
