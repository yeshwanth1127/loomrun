import type { Me, OrgSummary } from '../context/AuthContext'
import {
  HOME_PATHS,
  MONEY_LEGACY_PATHS,
  MONEY_PATHS,
  ORDERS_LEGACY_PATHS,
  ORDERS_PATHS,
  SETTINGS_LEGACY_PATHS,
  SETTINGS_PATHS,
  pathMatches,
} from './navPaths'

/** Business-facing label for MembershipRole. OWNER presents as CEO. */
export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'CEO',
  SALES: 'Sales',
  TELECALLER: 'Telecaller',
  PRODUCTION: 'Production',
  PRODUCTION_MANAGER: 'Production Manager',
  VIEWER: 'Viewer',
}

export function roleLabel(role?: string | null): string {
  if (!role) return 'Member'
  return ROLE_LABELS[role] ?? role
}

export function membershipForOrg(me: Me | null, orgId: string | null): OrgSummary | undefined {
  if (!me || !orgId) return undefined
  return me.organizations.find((o) => o.organization.id === orgId)
}

/** CEO / owner of the business. */
export function isOwnerRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'OWNER'
}

export function isCeoRole(membership: OrgSummary | undefined): boolean {
  return isOwnerRole(membership)
}

export function isProductionRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'PRODUCTION' || membership?.role === 'PRODUCTION_MANAGER'
}

export function isProductionManagerRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'PRODUCTION_MANAGER'
}

export function isTelecallerRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'TELECALLER'
}

export function isSalesRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'SALES'
}

/** Retired Sales URLs that redirect into the workspace — the guard must let them through. */
const SALES_REDIRECT_PATHS = ['/app/leads', '/app/leads/follow-ups', '/app/telecaller'] as const

/** Telecaller personal connections (not full Settings). */
const TELECALLER_CONNECTION_PATHS = ['/app/my-connections'] as const

/**
 * What a non-owner may open. Mirrors the API's role guards so nobody lands on a
 * screen that will 403, and matches the sidebar so there are no dead links.
 *
 * Primary business roles:
 * - OWNER (CEO): full access (this function is not consulted for owners)
 * - TELECALLER: Home + Sales + My Connections
 * - PRODUCTION / PRODUCTION_MANAGER: Home + Orders
 * - SALES / VIEWER: Home + Sales (Sales can organize pipelines)
 */
export function employeeMayAccess(pathname: string, role?: string | null): boolean {
  if (pathname === '/app/ai' || pathname.startsWith('/app/ai/')) return true

  // Full analytics reads an Owner-only endpoint.
  if (pathname.startsWith('/app/ceo')) return false

  // Production roles: Home + Orders only.
  if (role === 'PRODUCTION' || role === 'PRODUCTION_MANAGER') {
    if (pathMatches(pathname, HOME_PATHS)) return true
    if (pathMatches(pathname, ORDERS_PATHS) || pathMatches(pathname, ORDERS_LEGACY_PATHS)) {
      return true
    }
    return false
  }

  if (pathMatches(pathname, HOME_PATHS)) return true

  // Telecaller personal connections surface.
  if (pathMatches(pathname, TELECALLER_CONNECTION_PATHS)) {
    return role === 'TELECALLER' || role === 'SALES'
  }

  // Checked before Sales: Integrations still lives at /app/leads/connections.
  if (pathMatches(pathname, MONEY_PATHS) || pathMatches(pathname, MONEY_LEGACY_PATHS)) return false
  if (pathMatches(pathname, SETTINGS_PATHS) || pathMatches(pathname, SETTINGS_LEGACY_PATHS)) {
    return false
  }

  if (pathMatches(pathname, ['/app/sales']) || pathMatches(pathname, SALES_REDIRECT_PATHS)) {
    // Full quotation list: Owner only. Document workspace for a single quote is OK.
    if (pathname === '/app/sales/quotes' || pathname === '/app/sales/quotes/') return false
    // Pipeline setup is Owner + Sales.
    if (pathname.startsWith('/app/sales/organize')) return role === 'SALES'
    return role === 'SALES' || role === 'TELECALLER' || role === 'VIEWER'
  }

  if (pathname.startsWith('/app/pipelines')) return role === 'SALES'
  if (pathname.startsWith('/app/quotations')) return false

  return false
}
