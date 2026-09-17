import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  isOwnerRole,
  isProductionRole,
  isTelecallerRole,
  membershipForOrg,
} from '../../lib/membership'
import { CEODashboardPage } from '../CEODashboardPage'
import { LeadsPage } from '../LeadsPage'
import { ProductionPage } from '../ProductionPage'
import { TelecallerPage } from '../TelecallerPage'

/**
 * Phase 0 Home bridge — soft-lands on existing working surfaces by role.
 * Phase 1 will replace this with the attention dashboard.
 */
export function HomeBridgePage() {
  const { me, orgId } = useAuth()
  const membership = membershipForOrg(me, orgId)
  const hasFullAccess = isOwnerRole(membership) || !!me?.is_super_admin

  if (hasFullAccess) return <CEODashboardPage />
  if (isTelecallerRole(membership)) return <TelecallerPage />
  if (isProductionRole(membership)) return <ProductionPage />
  return <LeadsPage />
}

/** Phase 0: /app/home with no role → sales-compatible default. */
export function HomeIndexRedirect() {
  return <Navigate to="/app/home" replace />
}
