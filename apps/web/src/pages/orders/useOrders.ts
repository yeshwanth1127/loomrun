import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiFetch } from '../../lib/api'
import type { Order, OrderActivity } from '../../lib/orders'

/**
 * Everything the Orders list and the order workspace need from the production API.
 *
 * The API has no single-order endpoint, so the workspace reads the same list the
 * Orders screen uses and picks its order out of it. One cache entry, two screens.
 */
export function invalidateOrders(
  qc: ReturnType<typeof useQueryClient>,
  orgId: string | null,
): void {
  void qc.invalidateQueries({ queryKey: ['production', orgId] })
  void qc.invalidateQueries({ queryKey: ['production-activity-log', orgId] })
  void qc.invalidateQueries({ queryKey: ['order-activities', orgId] })
  void qc.invalidateQueries({ queryKey: ['expenses', orgId] })
  void qc.invalidateQueries({ queryKey: ['ceo', orgId] })
}

export type OrderMutations = ReturnType<typeof useOrderMutations>

export function useOrderMutations(orgId: string) {
  const qc = useQueryClient()
  const done = () => invalidateOrders(qc, orgId)

  /** Any field on the order: stage, status, ETA, courier, budget, name. */
  const patchOrder = useMutation({
    mutationFn: (p: { id: string; json: Record<string, unknown>; quiet?: boolean }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}`, { method: 'PATCH', json: p.json }),
    onSuccess: (_d, vars) => {
      done()
      if (!vars.quiet) toast.success('Order updated')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update order'),
  })

  const moveStage = useMutation({
    mutationFn: (p: {
      id: string
      stage: string
      internal_note?: string
      customer_note?: string
    }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}`, {
        method: 'PATCH',
        json: {
          stage: p.stage,
          internal_note: p.internal_note || null,
          customer_note: p.customer_note || null,
        },
      }),
    onSuccess: () => {
      done()
      toast.success('Stage updated')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update stage'),
  })

  const addExpense = useMutation({
    mutationFn: (p: {
      id: string
      category: string
      amount_cents: number
      vendor: string | null
      description: string | null
    }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}/expenses`, {
        method: 'POST',
        json: {
          category: p.category,
          amount_cents: p.amount_cents,
          vendor: p.vendor,
          description: p.description,
        },
      }),
    onSuccess: () => {
      done()
      toast.success('Expense recorded')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to add expense'),
  })

  const addPayment = useMutation({
    mutationFn: (p: { id: string; amount_cents: number; status: string; note: string | null }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}/payments`, {
        method: 'POST',
        json: { amount_cents: p.amount_cents, status: p.status, note: p.note },
      }),
    onSuccess: () => {
      done()
      toast.success('Payment recorded')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to add payment'),
  })

  const regenTracking = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/production/${id}/tracking/regenerate`, { method: 'POST' }),
    onSuccess: () => {
      done()
      toast.success('Tracking link regenerated')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to regenerate link'),
  })

  const toggleTracking = useMutation({
    mutationFn: (p: { id: string; enabled: boolean }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${p.id}/tracking`, {
        method: 'PATCH',
        json: { enabled: p.enabled },
      }),
    onSuccess: (_d, vars) => {
      done()
      toast.success(vars.enabled ? 'Tracking enabled' : 'Tracking disabled')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update tracking'),
  })

  const shareTracking = useMutation({
    mutationFn: (p: { lead_id: string; order_number: string; token: string }) => {
      const link = `${window.location.origin}/track/${p.token}`
      const message = `Hi! You can track your order ${p.order_number} here:\n${link}\n\n— Loomrun`
      return apiFetch<{ sent?: boolean; status?: string }>(
        `/v1/orgs/${orgId}/integrations/whatsapp/outbound`,
        { method: 'POST', json: { lead_id: p.lead_id, message } },
      )
    },
    onSuccess: (data) => {
      if (data?.sent === false) {
        toast.error('WhatsApp did not deliver the message. Check Integrations → WhatsApp.')
        return
      }
      toast.success('Tracking link sent on WhatsApp')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to send on WhatsApp'),
  })

  const removeOrder = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/production/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      done()
      toast.success('Order removed')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to remove order'),
  })

  return {
    patchOrder,
    moveStage,
    addExpense,
    addPayment,
    regenTracking,
    toggleTracking,
    shareTracking,
    removeOrder,
  }
}

/** Full order list (no date window) — the workspace reads its order from here. */
export function useAllOrders(orgId: string) {
  return useQuery({
    queryKey: ['production', orgId, 'all'],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Order[] }>(`/v1/orgs/${orgId}/production?day=all`),
  })
}

export function useOrderActivities(orgId: string, orderId: string) {
  return useQuery({
    queryKey: ['order-activities', orgId, orderId],
    enabled: !!orgId && !!orderId,
    queryFn: () =>
      apiFetch<{ items: OrderActivity[] }>(`/v1/orgs/${orgId}/production/${orderId}/activities`),
  })
}
