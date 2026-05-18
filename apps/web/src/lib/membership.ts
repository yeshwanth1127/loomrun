import type { Me, OrgSummary } from '../context/AuthContext'

export const TELECALLER_PATHS = ['/app/leads', '/app/telecaller'] as const

export function membershipForOrg(me: Me | null, orgId: string | null): OrgSummary | undefined {
  if (!me || !orgId) return undefined
  return me.organizations.find((o) => o.organization.id === orgId)
}

export function isTelecallerRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'TELECALLER'
}

export function telecallerMayAccess(pathname: string): boolean {
  return (TELECALLER_PATHS as readonly string[]).includes(pathname)
}
