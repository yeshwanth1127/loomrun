import type { Me, OrgSummary } from '../context/AuthContext'

// Non-owner roles (Sales, Telecaller, Production, Viewer) are restricted to this
// fixed set of pages. Everything else (Quotations, Invoices, Production, Expenses,
// WhatsApp, CEO Dashboard, and all Settings pages) is Owner-only.
export const EMPLOYEE_PATHS = ['/app/leads', '/app/leads/follow-ups', '/app/telecaller', '/app/ai'] as const

export function membershipForOrg(me: Me | null, orgId: string | null): OrgSummary | undefined {
  if (!me || !orgId) return undefined
  return me.organizations.find((o) => o.organization.id === orgId)
}

export function isOwnerRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'OWNER'
}

export function isTelecallerRole(membership: OrgSummary | undefined): boolean {
  return membership?.role === 'TELECALLER'
}

export function employeeMayAccess(pathname: string): boolean {
  return (EMPLOYEE_PATHS as readonly string[]).includes(pathname)
}
