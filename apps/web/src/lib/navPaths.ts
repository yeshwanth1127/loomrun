/**
 * Which top-level section a URL belongs to.
 *
 * Each section lists its own routes plus the retired routes that still redirect into
 * it, so the sidebar highlights correctly while old links keep working.
 */

export const SALES_PATHS = ['/app/sales'] as const

/** Retired Sales surfaces that now redirect. */
export const SALES_LEGACY_PATHS = [
  '/app/leads',
  '/app/leads/follow-ups',
  '/app/telecaller',
  '/app/pipelines',
  '/app/quotations',
] as const

export const ORDERS_PATHS = ['/app/orders'] as const
export const ORDERS_LEGACY_PATHS = ['/app/production'] as const

export const MONEY_PATHS = ['/app/money'] as const
export const MONEY_LEGACY_PATHS = ['/app/invoices', '/app/expenses', '/app/vendors'] as const

export const HOME_PATHS = ['/app/home', '/app/ceo'] as const

export const SETTINGS_PATHS = ['/app/settings'] as const

/** Retired settings URLs that now redirect (plus the OAuth return path). */
export const SETTINGS_LEGACY_PATHS = [
  '/app/leads/connections',
  '/app/document-templates',
  '/app/brand-assets',
  '/app/team',
  '/app/subscription',
  '/app/whatsapp',
] as const

export function pathMatches(pathname: string, candidates: readonly string[]): boolean {
  return candidates.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function isSettingsPath(pathname: string): boolean {
  return pathMatches(pathname, SETTINGS_PATHS) || pathMatches(pathname, SETTINGS_LEGACY_PATHS)
}

export function isHomePath(pathname: string): boolean {
  return pathMatches(pathname, HOME_PATHS)
}

export function isPipelinesPath(pathname: string): boolean {
  return (
    pathname === '/app/sales/organize' ||
    pathname.startsWith('/app/sales/organize/') ||
    pathname === '/app/pipelines' ||
    pathname.startsWith('/app/pipelines/')
  )
}

export function isSalesPath(pathname: string): boolean {
  // Integrations live under Settings even though the legacy URL sits under /app/leads.
  if (pathname.startsWith('/app/leads/connections')) return false
  // Organize/pipelines has its own sidebar item.
  if (isPipelinesPath(pathname)) return false
  return pathMatches(pathname, SALES_PATHS) || pathMatches(pathname, SALES_LEGACY_PATHS)
}

export function isOrdersPath(pathname: string): boolean {
  return pathMatches(pathname, ORDERS_PATHS) || pathMatches(pathname, ORDERS_LEGACY_PATHS)
}

export function isMoneyPath(pathname: string): boolean {
  return pathMatches(pathname, MONEY_PATHS) || pathMatches(pathname, MONEY_LEGACY_PATHS)
}
