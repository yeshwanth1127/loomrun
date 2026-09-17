import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiFetch } from '../../lib/api'
import { callStatusIsFollowUp } from '../../lib/callStatus'
import type { Lead } from '../../lib/leads'

/**
 * Data + mutations shared by every panel of the lead workspace.
 *
 * Query keys and invalidation match the legacy Leads drawer and Telecaller page so
 * the follow-up badge, Sales list, and calling summary all stay in sync.
 */
export function useLeadWorkspace(orgId: string, leadId: string) {
  const qc = useQueryClient()

  const detailQ = useQuery({
    queryKey: ['lead-detail', orgId, leadId],
    enabled: !!orgId && !!leadId,
    queryFn: () => apiFetch<Lead>(`/v1/orgs/${orgId}/leads/${leadId}`),
  })

  function invalidateLeadSurfaces() {
    void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, leadId] })
    void qc.invalidateQueries({ queryKey: ['leads', orgId] })
    void qc.invalidateQueries({ queryKey: ['tele-summary', orgId] })
    void qc.invalidateQueries({ queryKey: ['follow-ups', orgId] })
    void qc.invalidateQueries({ queryKey: ['follow-ups-due', orgId] })
    void qc.invalidateQueries({ queryKey: ['home-follow-ups', orgId] })
  }

  const updateLead = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      apiFetch<Lead>(`/v1/orgs/${orgId}/leads/${leadId}`, { method: 'PATCH', json: values }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, leadId] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      if ('next_follow_up_at' in vars) {
        void qc.invalidateQueries({ queryKey: ['follow-ups', orgId] })
        void qc.invalidateQueries({ queryKey: ['follow-ups-due', orgId] })
        void qc.invalidateQueries({ queryKey: ['home-follow-ups', orgId] })
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const logCallStatus = useMutation({
    mutationFn: (p: { outcome: string; nextCallAt?: string | null }) =>
      apiFetch(`/v1/orgs/${orgId}/telecaller/calls`, {
        method: 'POST',
        json: {
          lead_id: leadId,
          outcome: p.outcome,
          next_call_at: callStatusIsFollowUp(p.outcome) ? (p.nextCallAt ?? null) : null,
        },
      }),
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ['lead-detail', orgId, leadId] })
      await qc.cancelQueries({ queryKey: ['leads', orgId] })
      const prevDetail = qc.getQueryData<Lead>(['lead-detail', orgId, leadId])
      const nextFollowUp = callStatusIsFollowUp(p.outcome) ? (p.nextCallAt ?? null) : null
      if (prevDetail) {
        qc.setQueryData<Lead>(['lead-detail', orgId, leadId], {
          ...prevDetail,
          last_call_outcome: p.outcome,
          next_follow_up_at: nextFollowUp,
        })
      }
      const listSnapshots = qc.getQueriesData<{ items: Lead[] }>({ queryKey: ['leads', orgId] })
      for (const [key, data] of listSnapshots) {
        if (!data) continue
        qc.setQueryData(key, {
          ...data,
          items: data.items.map((l) =>
            l.id === leadId
              ? { ...l, last_call_outcome: p.outcome, next_follow_up_at: nextFollowUp }
              : l,
          ),
        })
      }
      return { prevDetail, listSnapshots }
    },
    onError: (err: Error, _p, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(['lead-detail', orgId, leadId], ctx.prevDetail)
      for (const [key, data] of ctx?.listSnapshots ?? []) qc.setQueryData(key, data)
      toast.error(err.message)
    },
    onSettled: () => invalidateLeadSurfaces(),
  })

  const deleteLead = useMutation({
    mutationFn: () => apiFetch(`/v1/orgs/${orgId}/leads/${leadId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Lead deleted')
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      qc.removeQueries({ queryKey: ['lead-detail', orgId, leadId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return { detailQ, updateLead, logCallStatus, deleteLead, invalidateLeadSurfaces }
}

export type LeadWorkspace = ReturnType<typeof useLeadWorkspace>
