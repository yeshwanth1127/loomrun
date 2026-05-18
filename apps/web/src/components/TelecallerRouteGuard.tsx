import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isTelecallerRole, membershipForOrg, telecallerMayAccess } from '../lib/membership'

export function TelecallerRouteGuard({ children }: { children: React.ReactNode }) {
  const { me, orgId } = useAuth()
  const { pathname } = useLocation()
  const membership = membershipForOrg(me, orgId)

  if (isTelecallerRole(membership) && !telecallerMayAccess(pathname)) {
    return <Navigate to="/app/telecaller" replace />
  }

  return children
}
