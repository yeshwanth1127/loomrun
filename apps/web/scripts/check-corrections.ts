/**
 * Quotation RBAC expectations for TELECALLER create access (frontend gates).
 * Run: npx esbuild --bundle | node  (via check script below)
 */
import { employeeMayAccess } from '../src/lib/membership'
import { CALL_STATUS_MAP } from '../src/lib/callStatus'

let failed = 0
function check(name: string, cond: boolean) {
  if (!cond) {
    failed += 1
    console.error(`FAIL ${name}`)
  }
}

// Role access matrix (unchanged PRODUCTION_MANAGER)
check('PM home', employeeMayAccess('/app/home', 'PRODUCTION_MANAGER') === true)
check('PM orders', employeeMayAccess('/app/orders', 'PRODUCTION_MANAGER') === true)
check('PM sales blocked', employeeMayAccess('/app/sales', 'PRODUCTION_MANAGER') === false)
check('PM money blocked', employeeMayAccess('/app/money', 'PRODUCTION_MANAGER') === false)

check('Telecaller sales', employeeMayAccess('/app/sales', 'TELECALLER') === true)
check('Telecaller my-connections', employeeMayAccess('/app/my-connections', 'TELECALLER') === true)
check('Telecaller money blocked', employeeMayAccess('/app/money', 'TELECALLER') === false)
check('Telecaller quote doc', employeeMayAccess('/app/sales/quotes/q1', 'TELECALLER') === true)
check('Telecaller quote list blocked', employeeMayAccess('/app/sales/quotes', 'TELECALLER') === false)

// Call status pipeline sync
check('CLOSED_NOT_NOW no stage', CALL_STATUS_MAP.CLOSED_NOT_NOW.stageKey === null)
check('DEAL_LOST lost', CALL_STATUS_MAP.DEAL_LOST.stageKey === 'LOST')
check('DO_NOT_CONTACT lost', CALL_STATUS_MAP.DO_NOT_CONTACT.stageKey === 'LOST')
check('DEAL_REJECTED lost', CALL_STATUS_MAP.DEAL_REJECTED_AFTER_SAMPLE.stageKey === 'LOST')
check('WHATSAPP_SENT no stage', CALL_STATUS_MAP.WHATSAPP_SENT.stageKey === null)

if (failed > 0) {
  console.error(`\n${failed} checks failed`)
  process.exit(1)
}
console.log('quotation/connection/call-status frontend checks passed')
