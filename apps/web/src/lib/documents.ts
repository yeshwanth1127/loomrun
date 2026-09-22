/**
 * Shared quotation / invoice document types and live GST totals.
 * Backend `document_totals.py` is the persistence source of truth;
 * this mirrors the same formula for editor preview.
 */

export type DocLine = {
  id?: string
  description: string
  quantity: number
  unit_price: number
  line_total?: number
}

export type DocVersion = {
  id: string | null
  quotation_id: string
  version_number: number
  title: string | null
  status: string
  invoice_number?: string | null
  subtotal: number
  tax_enabled: boolean
  tax_rate: number | null
  tax: number
  total: number
  lines?: DocLine[] | null
  lead_snapshot?: Record<string, unknown> | null
  note: string | null
  created_at: string | null
  is_current?: boolean
  is_snapshot?: boolean
}

export type QuotationDoc = {
  id: string
  number: string
  title: string | null
  invoice_number: string | null
  version: number
  status: string
  total: number
  subtotal: number
  tax: number
  tax_enabled: boolean
  tax_rate: number | null
  lead_id: string
  lead_title: string | null
  lead_phone: string | null
  lead_email: string | null
  lead_company?: string | null
  pdf_url: string | null
  template_id: string | null
  sent_at: string | null
  invoiced_at: string | null
  created_at?: string | null
  updated_at?: string | null
  source_quotation_id: string | null
  source_quotation_version: number | null
  source_quotation_number: string | null
  linked_invoice_id?: string | null
  linked_invoice_number?: string | null
  linked_invoices?: Array<{ id: string; invoice_number: string | null }>
  lines: DocLine[]
  versions?: DocVersion[]
}

export const GST_PRESETS = [0, 5, 12, 18, 28] as const

/** Round half-up to 2 decimal places (matches backend Decimal ROUND_HALF_UP). */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function computeDocumentTotals(input: {
  lines: Array<{ quantity: number; unit_price: number }>
  taxEnabled: boolean
  taxRate: number | null | undefined
}): { subtotal: number; tax: number; total: number; taxRate: number | null } {
  const subtotal = roundMoney(
    input.lines.reduce(
      (sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_price || 0),
      0,
    ),
  )
  if (!input.taxEnabled) {
    return { subtotal, tax: 0, total: subtotal, taxRate: null }
  }
  const rate = Number(input.taxRate ?? 0)
  const safeRate = Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : 0
  const tax = roundMoney((subtotal * safeRate) / 100)
  return { subtotal, tax, total: roundMoney(subtotal + tax), taxRate: safeRate }
}

export type LeadDocGroup = {
  leadId: string
  leadTitle: string
  leadCompany: string | null
  count: number
  latestAt: string | null
  totalValue: number
  docs: QuotationDoc[]
}

export function groupDocsByLead(docs: QuotationDoc[]): LeadDocGroup[] {
  const map = new Map<string, LeadDocGroup>()
  for (const d of docs) {
    const key = d.lead_id || 'unknown'
    const existing = map.get(key)
    const at = d.updated_at || d.created_at || d.sent_at || d.invoiced_at || null
    if (!existing) {
      map.set(key, {
        leadId: key,
        leadTitle: d.lead_title || 'Unnamed lead',
        leadCompany: d.lead_company ?? null,
        count: 1,
        latestAt: at,
        totalValue: Number(d.total || 0),
        docs: [d],
      })
    } else {
      existing.count += 1
      existing.totalValue += Number(d.total || 0)
      existing.docs.push(d)
      if (at && (!existing.latestAt || at > existing.latestAt)) {
        existing.latestAt = at
      }
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    (b.latestAt || '').localeCompare(a.latestAt || ''),
  )
}
