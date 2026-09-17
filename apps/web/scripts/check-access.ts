/**
 * Access-rule check for the refreshed routes.
 *
 * `employeeMayAccess` decides what a non-owner can open, so a wrong prefix match
 * silently exposes a screen. Run with: npx esbuild --bundle | node
 */
import { employeeMayAccess } from '../src/lib/membership'

type Case = [pathname: string, role: string, expected: boolean]

const CASES: Case[] = [
  // Sales roles
  ['/app/home', 'SALES', true],
  ['/app/sales', 'SALES', true],
  ['/app/sales/abc123', 'SALES', true],
  ['/app/sales/organize', 'SALES', true],
  ['/app/sales/organize/pipe1', 'SALES', true],
  ['/app/sales/quotes', 'SALES', false],
  ['/app/sales/quotes/q1', 'SALES', true],
  ['/app/ai', 'SALES', true],
  ['/app/leads', 'SALES', true],
  ['/app/leads/follow-ups', 'SALES', true],
  ['/app/telecaller', 'SALES', true],
  ['/app/leads/connections', 'SALES', false],
  ['/app/settings/connections', 'SALES', false],
  ['/app/settings/plan', 'SALES', false],
  ['/app/money', 'SALES', false],
  ['/app/money/invoices', 'SALES', false],
  ['/app/invoices', 'SALES', false],
  ['/app/orders', 'SALES', false],
  ['/app/ceo', 'SALES', false],

  // Telecaller: same as Sales but no pipeline setup
  ['/app/sales', 'TELECALLER', true],
  ['/app/sales/abc123', 'TELECALLER', true],
  ['/app/sales/organize', 'TELECALLER', false],
  ['/app/sales/quotes', 'TELECALLER', false],
  ['/app/sales/quotes/q1', 'TELECALLER', true],
  ['/app/pipelines', 'TELECALLER', false],
  ['/app/leads/connections', 'TELECALLER', false],

  // Production: orders only
  ['/app/home', 'PRODUCTION', true],
  ['/app/orders', 'PRODUCTION', true],
  ['/app/orders/ord1', 'PRODUCTION', true],
  ['/app/production', 'PRODUCTION', true],
  ['/app/sales', 'PRODUCTION', false],
  ['/app/money/invoices', 'PRODUCTION', false],
  ['/app/settings/team', 'PRODUCTION', false],
  ['/app/ai', 'PRODUCTION', true],


  // Telecaller personal connections
  ['/app/my-connections', 'TELECALLER', true],
  ['/app/my-connections', 'SALES', true],
  ['/app/my-connections', 'PRODUCTION', false],
  ['/app/money', 'TELECALLER', false],
  ['/app/orders', 'TELECALLER', false],
  ['/app/settings/plan', 'TELECALLER', false],

  // Production Manager: same as Production
  ['/app/home', 'PRODUCTION_MANAGER', true],
  ['/app/orders', 'PRODUCTION_MANAGER', true],
  ['/app/orders/ord1', 'PRODUCTION_MANAGER', true],
  ['/app/production', 'PRODUCTION_MANAGER', true],
  ['/app/sales', 'PRODUCTION_MANAGER', false],
  ['/app/money', 'PRODUCTION_MANAGER', false],
  ['/app/settings/team', 'PRODUCTION_MANAGER', false],
  ['/app/my-connections', 'PRODUCTION_MANAGER', false],
  ['/app/ceo', 'PRODUCTION_MANAGER', false],

  // Viewer: read-only sales surfaces
  ['/app/sales', 'VIEWER', true],
  ['/app/orders', 'VIEWER', false],
  ['/app/ceo', 'PRODUCTION', false],
  ['/app/money/expenses', 'VIEWER', false],
]

let failed = 0
for (const [pathname, role, expected] of CASES) {
  const actual = employeeMayAccess(pathname, role)
  if (actual !== expected) {
    failed += 1
    console.error(`FAIL ${role} ${pathname}: expected ${expected}, got ${actual}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${CASES.length} access checks failed`)
  process.exit(1)
}
console.log(`${CASES.length} access checks passed`)
