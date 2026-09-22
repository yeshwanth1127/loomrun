/**
 * Shared vocabulary for Orders (ProductionOrder on the API).
 *
 * Same stages, statuses and categories the Production page used — only the
 * user-facing wording is plainer.
 */

export type OrderExpense = {
  id: string
  category: string
  amount_cents: number
  description: string | null
  vendor: string | null
  incurred_at: string
}

export type OrderPayment = {
  id: string
  amount_cents: number
  status: string
  method: string | null
  reference: string | null
  label: string | null
  note: string | null
  recorded_at: string | null
  expected_payment_id: string | null
}

export type ExpectedPayment = {
  id: string
  amount_cents: number
  remaining_cents: number
  expected_at: string | null
  label: string | null
  note: string | null
  status: string
  is_overdue: boolean
  days_overdue: number | null
  is_unscheduled: boolean
  created_at: string | null
  updated_at: string | null
  cancelled_at: string | null
}

export type PaymentTimelineEvent = {
  id: string
  kind: string
  marker: 'filled' | 'open' | 'overdue' | string
  at: string | null
  title: string
  subtitle: string | null
  amount_cents: number | null
  meta: Record<string, unknown>
}

export type OrderPnl = {
  revenue_cents: number | null
  revenue_source: string | null
  budget_cents: number | null
  actual_cost_cents: number
  collected_cents: number
  balance_due_cents: number | null
  overpaid_cents: number
  collection_percentage: number | null
  payment_status: string
  next_expected_payment: ExpectedPayment | null
  overdue_expected_count: number
  overdue_expected_cents: number
  active_expected_count: number
  margin_cents: number | null
  budget_variance_cents: number | null
  collection_gap_cents: number | null
  over_budget: boolean
}

export type OrderActivity = {
  id: string
  type: string
  body: string
  user_name: string | null
  created_at: string
  metadata?: {
    internal_note?: string | null
    customer_note?: string | null
    from_stage?: string
    to_stage?: string
  } | null
}

export type OrderActivityGroup = {
  lead_id: string
  lead_title: string | null
  production_order_id: string
  activities: OrderActivity[]
}

export type Order = {
  id: string
  lead_id: string
  quotation_id: string | null
  order_number: string
  name: string | null
  display_name: string | null
  stage: string
  order_status: string
  delay_flag: boolean
  budget_cents: number | null
  expected_completion_at: string | null
  expected_dispatch_at: string | null
  actual_dispatch_at: string | null
  courier_name: string | null
  courier_tracking_no: string | null
  shipping_notes: string | null
  on_hold_reason: string | null
  days_until_dispatch: number | null
  tracking_token: string | null
  tracking_enabled: boolean
  stage_entered_at: string
  lead_title: string | null
  lead_phone: string | null
  design_garment_type: string | null
  design_garment_color: string | null
  payments: OrderPayment[]
  expected_payments: ExpectedPayment[]
  expenses: OrderExpense[]
  pnl: OrderPnl
  payment_timeline: PaymentTimelineEvent[]
}

/** Order of work on the floor — also the progress order. */
export const STAGES = [
  'PENDING',
  'FABRIC_CHECK',
  'PROCUREMENT',
  'FABRIC_RECEIVED',
  'CUTTING',
  'PRINTING',
  'STITCHING',
  'QC',
  'PACKING',
  'PAYMENT_HOLD',
  'READY_DISPATCH',
  'SHIPPED',
  'DELIVERED',
] as const

export const STAGE_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  FABRIC_CHECK: 'Fabric Check',
  PROCUREMENT: 'Procurement',
  FABRIC_RECEIVED: 'Fabric Received',
  CUTTING: 'Cutting',
  PRINTING: 'Printing',
  STITCHING: 'Stitching',
  QC: 'Quality Check',
  PACKING: 'Packing',
  PAYMENT_HOLD: 'Payment Hold',
  READY_DISPATCH: 'Ready to Dispatch',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
}

export const STAGE_COLOR: Record<string, string> = {
  PENDING: '#94a3b8',
  FABRIC_CHECK: '#60a5fa',
  PROCUREMENT: '#f59e0b',
  FABRIC_RECEIVED: '#34d399',
  CUTTING: '#0F766E',
  PRINTING: '#0E7490',
  STITCHING: '#0891B2',
  QC: '#f97316',
  PACKING: '#14B8A6',
  PAYMENT_HOLD: '#ef4444',
  READY_DISPATCH: '#10b981',
  SHIPPED: '#0284C7',
  DELIVERED: '#059669',
}

export const ORDER_STATUSES = [
  'ON_TRACK',
  'AT_RISK',
  'DELAYED',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
] as const

export const STATUS_LABELS: Record<string, string> = {
  ON_TRACK: 'On Track',
  AT_RISK: 'At Risk',
  DELAYED: 'Delayed',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export const STATUS_BADGE: Record<string, string> = {
  ON_TRACK: 'badge-green',
  AT_RISK: 'badge-amber',
  DELAYED: 'badge-red',
  ON_HOLD: 'badge-slate',
  COMPLETED: 'badge-green',
  CANCELLED: 'badge-red',
}

export const EXPENSE_CATEGORIES = [
  'FABRIC',
  'LABOR',
  'OUTSOURCING',
  'FREIGHT',
  'CONSUMABLES',
  'RENT',
  'UTILITIES',
  'OTHER',
] as const

export const CATEGORY_LABELS: Record<string, string> = {
  FABRIC: 'Fabric',
  LABOR: 'Labor',
  OUTSOURCING: 'Outsourcing',
  FREIGHT: 'Freight',
  CONSUMABLES: 'Consumables',
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  OTHER: 'Other',
}

export const ACTIVITY_ICONS: Record<string, string> = {
  ORDER_CREATED: '🏭',
  STAGE_CHANGED: '→',
  DELAY_TOGGLED: '⚠',
  PAYMENT_RECORDED: '₹',
  EXPENSE_RECORDED: '🧾',
  BUDGET_SET: '📊',
  NAME_CHANGED: '✎',
  NOTE_ADDED: '📝',
  STATUS_CHANGED: '⚑',
  ETA_UPDATED: '📅',
  SHIPMENT_UPDATED: '🚚',
}

export const SHIPPING_STAGES = new Set(['READY_DISPATCH', 'SHIPPED', 'DELIVERED'])

export function orderTitle(o: Order): string {
  return o.display_name ?? o.lead_title ?? 'Unnamed order'
}

export function stageProgress(stage: string): number {
  const idx = STAGES.indexOf(stage as (typeof STAGES)[number])
  return ((idx + 1) / STAGES.length) * 100
}

export function nextStage(stage: string): string | undefined {
  const idx = STAGES.indexOf(stage as (typeof STAGES)[number])
  return STAGES[idx + 1]
}

export function isLate(o: Order): boolean {
  return o.order_status === 'DELAYED' || o.delay_flag
}

export function isFinished(o: Order): boolean {
  return o.stage === 'DELIVERED' || o.order_status === 'COMPLETED'
}

export function daysIn(dt: string): string {
  const days = Math.floor((Date.now() - new Date(dt).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day'
  return `${days} days`
}

export function fmtOrderDate(dt: string | null | undefined): string {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function fmtOrderDateTime(dt: string): string {
  return new Date(dt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function toDateInput(dt: string | null | undefined): string {
  if (!dt) return ''
  const d = new Date(dt)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export function etaLabel(days: number | null): string | null {
  if (days == null) return null
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (days === 0) return 'Due today'
  return `${days} day${days === 1 ? '' : 's'} remaining`
}

export function rupeesToCents(value: string): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export const PAYMENT_METHODS = [
  'CASH',
  'UPI',
  'BANK_TRANSFER',
  'CHEQUE',
  'CARD',
  'OTHER',
] as const

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  OTHER: 'Other',
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
}

export const PAYMENT_STATUS_BADGE: Record<string, string> = {
  UNPAID: 'badge-slate',
  PARTIALLY_PAID: 'badge-amber',
  PAID: 'badge-green',
  OVERDUE: 'badge-red',
}

export const PAYMENT_LABEL_SUGGESTIONS = [
  'Advance',
  'Before Production',
  'Before Dispatch',
  'After Delivery',
  'Final Payment',
] as const

/** Convert a date input (YYYY-MM-DD) to ISO midnight UTC for API bodies. */
export function dateInputToIso(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return `${trimmed}T00:00:00.000Z`
}
