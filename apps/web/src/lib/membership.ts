import type { Me, OrgSummary } from '../context/AuthContext'

// Non-owner roles (Sales, Telecaller, Production, Viewer) share this base set.
// PRODUCTION also gets /app/production (ops only — money stays Owner-only).
export const EMPLOYEE_PATHS = ['/app/leads', '/app/leads/follow-ups', '/app/telecaller', '/app/ai'] as const
export const PRODUCTION_PATHS = ['/app/production'] as const

export function membershipForOrg(me: Me | null, orgId: string | null): OrgSummary | undefined {
  if (!me || !orgId) return undefined
  return me.organizations.find((o) => o.organization.id === orgId)
}

export function isOwnerRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'OWNER'
}

export function isProductionRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'PRODUCTION'
}

export function isTelecallerRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'TELECALLER'
}

export function employeeMayAccess(pathname: string, role?: string | null): boolean {
  if ((EMPLOYEE_PATHS as readonly string[]).includes(pathname)) return true
  if (role === 'PRODUCTION' && (PRODUCTION_PATHS as readonly string[]).includes(pathname)) return true
  return false
}
