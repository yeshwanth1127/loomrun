import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export type CrmMutation = {
  entity: string
  action: string
  id: string
  label: string
  summary: string
  tool?: string
}

const LEAD_KEYS = [
  'leads',
  'lead-detail',
  'follow-ups',
  'follow-ups-due',
  'tele-summary',
  'home-quotations',
  'leads-picker',
  'leads-select',
] as const

const QUOTATION_KEYS = ['quotations', 'quotation-doc', 'home-quotations'] as const

const INVOICE_KEYS = ['invoices', 'quotation-doc'] as const

const PRODUCTION_KEYS = ['production', 'production-activity-log', 'home-orders'] as const

const EXPENSE_KEYS = ['expenses', 'ceo'] as const

function invalidateKeys(qc: QueryClient, orgId: string, keys: readonly string[], entityId?: string) {
  for (const key of keys) {
    if (key === 'lead-detail' || key === 'quotation-doc') {
      if (entityId) {
        void qc.invalidateQueries({ queryKey: [key, orgId, entityId] })
      }
      void qc.invalidateQueries({ queryKey: [key, orgId] })
    } else if (key === 'lead-orders') {
      if (entityId) void qc.invalidateQueries({ queryKey: [key, orgId, entityId] })
    } else {
      void qc.invalidateQueries({ queryKey: [key, orgId] })
      void qc.invalidateQueries({ queryKey: [key] })
    }
  }
}

/** Invalidate React Query caches and show toasts after agent CRM writes. */
export function applyCrmMutations(
  qc: QueryClient,
  orgId: string,
  mutations: CrmMutation[] | undefined,
  { toast: showToast = true }: { toast?: boolean } = {},
) {
  if (!orgId || !mutations?.length) return

  const seen = new Set<string>()
  for (const m of mutations) {
    const dedupe = `${m.entity}:${m.id}:${m.action}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)

    switch (m.entity) {
      case 'lead':
        invalidateKeys(qc, orgId, LEAD_KEYS, m.id)
        break
      case 'call':
        invalidateKeys(qc, orgId, LEAD_KEYS, m.id)
        break
      case 'quotation':
        invalidateKeys(qc, orgId, QUOTATION_KEYS, m.id)
        invalidateKeys(qc, orgId, LEAD_KEYS)
        break
      case 'invoice':
        invalidateKeys(qc, orgId, INVOICE_KEYS, m.id)
        invalidateKeys(qc, orgId, QUOTATION_KEYS)
        break
      case 'production':
        invalidateKeys(qc, orgId, PRODUCTION_KEYS, m.id)
        break
      case 'expense':
        invalidateKeys(qc, orgId, EXPENSE_KEYS)
        invalidateKeys(qc, orgId, PRODUCTION_KEYS)
        break
      default:
        invalidateKeys(qc, orgId, LEAD_KEYS)
        invalidateKeys(qc, orgId, QUOTATION_KEYS)
        break
    }

    if (showToast && m.summary) {
      toast.success(m.summary)
    }
  }
}
