import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  CallbackScheduleFields,
  type CallbackPreset,
} from '../../components/CallbackScheduleFields'
import { InfoField } from '../../components/ui/InfoField'
import { apiFetch } from '../../lib/api'
import {
  CALL_STATUS_OPTIONS,
  callStatusIsFollowUp,
  callStatusRequiresDate,
  callStatusesByGroup,
} from '../../lib/callStatus'
import {
  activeFollowUpAt,
  localDateTimeToIso,
  toLocalDateInput,
  toLocalTimeInput,
  tomorrowAt10Local,
} from '../../lib/followUp'
import { fmtINR } from '../../lib/format'
import {
  fmtLeadDateTime,
  toDatetimeLocalValue,
  type Lead,
  type PipelineSummary,
} from '../../lib/leads'
import type { LeadWorkspace } from './useLeadWorkspace'

/** The single most useful next action for where this lead currently sits. */
function nextStep(lead: Lead): { label: string; tab: 'call' | 'quotes' | 'order' } | null {
  switch (lead.stage) {
    case 'NEW':
      return { label: 'Call this lead', tab: 'call' }
    case 'CONTACTED':
    case 'QUALIFICATION':
      return { label: 'Create a quotation', tab: 'quotes' }
    case 'QUOTATION':
      return { label: 'Send or revise the quotation', tab: 'quotes' }
    case 'NEGOTIATION':
    case 'SAMPLE':
      return { label: 'Confirm the order', tab: 'order' }
    case 'WON':
      return { label: 'Start the order', tab: 'order' }
    default:
      return null
  }
}

export function LeadOverviewPanel({
  lead,
  orgId,
  workspace,
}: {
  lead: Lead
  orgId: string
  workspace: LeadWorkspace
}) {
  const { updateLead, logCallStatus } = workspace
  const [, setSearchParams] = useSearchParams()
  const [pendingCallOutcome, setPendingCallOutcome] = useState<string | null>(null)
  const [cbDate, setCbDate] = useState(() => toLocalDateInput(lead.next_follow_up_at))
  const [cbTime, setCbTime] = useState(() => toLocalTimeInput(lead.next_follow_up_at) || '10:00')
  const [cbPreset, setCbPreset] = useState<CallbackPreset>('custom')
  const [showNotes, setShowNotes] = useState(false)

  const pipelinesQ = useQuery({
    queryKey: ['pipelines', orgId, 'lead-detail'],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ items: PipelineSummary[] }>(`/v1/orgs/${orgId}/pipelines?include_archived=false`),
  })
  const pipelines = pipelinesQ.data?.items ?? []

  const canSetCallStatus = lead.stage !== 'WON' && lead.stage !== 'LOST'
  const displayedOutcome = pendingCallOutcome ?? lead.last_call_outcome ?? ''
  const schedulerVisible = canSetCallStatus && callStatusIsFollowUp(displayedOutcome ?? '')

  function seedCallbackIfEmpty() {
    if (cbDate.trim()) return
    const p = tomorrowAt10Local()
    setCbDate(p.date)
    setCbTime(p.time)
    setCbPreset('tomorrow')
  }

  function saveCallback() {
    if (!cbDate.trim()) {
      toast.error('Pick a follow-up date for Follow Up')
      return
    }
    const iso = localDateTimeToIso(cbDate, cbTime)
    if (!iso) {
      toast.error('Pick a follow-up date for Follow Up')
      return
    }
    logCallStatus.mutate({ outcome: 'CALLBACK_SCHEDULED', nextCallAt: iso })
  }

  const step = nextStep(lead)
  const followUp = activeFollowUpAt(lead.next_follow_up_at, lead.last_call_outcome)

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      {step && (
        <button
          type="button"
          className="card lead-next-step"
          onClick={() => {
            const params = new URLSearchParams()
            params.set('tab', step.tab)
            setSearchParams(params, { replace: true })
          }}
        >
          <span className="muted small">Next step</span>
          <strong>{step.label}</strong>
          <ArrowRight size={16} />
        </button>
      )}

      <section className="card">
        <div className="drawer-section-title">Where this lead stands</div>
        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {canSetCallStatus && (
            <div className="form-field" style={{ minWidth: 240 }}>
              <label className="input-label">How did the last call go?</label>
              <select
                className="select"
                value={displayedOutcome}
                onChange={(e) => {
                  const next = e.target.value
                  if (!next) return
                  if (callStatusIsFollowUp(next)) {
                    setPendingCallOutcome(next)
                    seedCallbackIfEmpty()
                  } else {
                    setPendingCallOutcome(null)
                    logCallStatus.mutate({ outcome: next })
                  }
                }}
              >
                <option value="" disabled>
                  Call status…
                </option>
                {callStatusesByGroup().map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          {!canSetCallStatus && (
            <p className="muted small" style={{ margin: 0 }}>
              This lead is closed. Move it back to an open stage to log calls again.
            </p>
          )}
        </div>

        {schedulerVisible && (
          <div style={{ marginTop: '0.85rem' }}>
            <CallbackScheduleFields
              date={cbDate}
              time={cbTime}
              preset={cbPreset}
              onChange={(next) => {
                setCbDate(next.date)
                setCbTime(next.time)
                setCbPreset(next.preset)
              }}
            />
            <div
              className="row"
              style={{
                gap: '0.5rem',
                marginTop: '0.6rem',
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                className="btn btn-sm"
                onClick={saveCallback}
                disabled={logCallStatus.isPending}
              >
                {logCallStatus.isPending
                  ? 'Saving…'
                  : callStatusIsFollowUp(pendingCallOutcome ?? '') ||
                      !callStatusIsFollowUp(lead.last_call_outcome ?? '')
                    ? 'Save follow-up'
                    : 'Update follow-up'}
              </button>
              {callStatusIsFollowUp(pendingCallOutcome ?? '') && (
                <span className="muted small">
                  Pick a date and time, then save to add this lead to Follow-ups.
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="drawer-section-title">Lead details</div>
        <div className="info-grid">
          <InfoField
            label="Phone"
            value={lead.phone}
            onEdit={(v) => updateLead.mutate({ phone: v })}
          />
          <InfoField
            label="Email"
            value={lead.email}
            onEdit={(v) => updateLead.mutate({ email: v })}
          />
          <InfoField
            label="City"
            value={lead.city}
            onEdit={(v) => updateLead.mutate({ city: v })}
          />
          <InfoField
            label="Company"
            value={lead.company}
            onEdit={(v) => updateLead.mutate({ company: v })}
          />
          <InfoField
            label="What they want"
            value={lead.product_interest}
            onEdit={(v) => updateLead.mutate({ product_interest: v })}
          />
          <InfoField
            label="Quantity"
            value={lead.quantity_estimate}
            onEdit={(v) => updateLead.mutate({ quantity_estimate: v })}
          />
          <InfoField
            label="Order value"
            value={lead.estimated_value != null ? fmtINR(lead.estimated_value) : null}
            editValue={lead.estimated_value != null ? String(lead.estimated_value) : ''}
            inputType="number"
            onEdit={(v) => updateLead.mutate({ estimated_value: v ? Number(v) : null })}
          />
          <InfoField
            label="Region"
            value={lead.region ?? null}
            onEdit={(v) => updateLead.mutate({ region: v || null })}
          />
          <InfoField
            label="Sector"
            value={lead.sector ?? null}
            onEdit={(v) => updateLead.mutate({ sector: v || null })}
          />
          <InfoField
            label="Campaign"
            value={lead.campaign_name ?? null}
            onEdit={(v) => updateLead.mutate({ campaign_name: v || null })}
          />
          <InfoField
            label="Campaign ID"
            value={lead.campaign_id ?? null}
            onEdit={(v) => updateLead.mutate({ campaign_id: v || null })}
          />
          {pipelines.length > 0 && (
            <InfoField
              label="Pipeline"
              value={lead.pipeline_name ?? null}
              editValue={lead.pipeline_id ?? ''}
              options={[
                { value: '', label: 'No pipeline' },
                ...pipelines.map((p) => ({ value: p.id, label: p.name })),
              ]}
              onEdit={(v) => {
                if (!v || v === lead.pipeline_id) return
                updateLead.mutate({ pipeline_id: v })
              }}
            />
          )}
          {schedulerVisible ? (
            <div className="info-field">
              <label>Follow-up</label>
              <div className="value muted small">Set the date and time above</div>
            </div>
          ) : (
            <InfoField
              label="Follow-up"
              value={followUp ? fmtLeadDateTime(followUp) : null}
              editValue={
                callStatusIsFollowUp(lead.last_call_outcome ?? '')
                  ? toDatetimeLocalValue(lead.next_follow_up_at)
                  : undefined
              }
              inputType="datetime-local"
              onEdit={(v) => {
                if (!callStatusIsFollowUp(lead.last_call_outcome ?? '')) {
                  toast.error('Set the call status to Follow Up to schedule a follow-up')
                  return
                }
                if (!v) {
                  toast.error('Follow-up date and time are required for Follow Up')
                  return
                }
                const iso = v.includes('T')
                  ? localDateTimeToIso(v.slice(0, 10), v.slice(11, 16))
                  : new Date(v).toISOString()
                if (!iso) {
                  toast.error('Follow-up date and time are required for Follow Up')
                  return
                }
                updateLead.mutate({ next_follow_up_at: iso })
              }}
            />
          )}
        </div>

        <div style={{ marginTop: '0.85rem' }}>
          {lead.notes !== null || showNotes ? (
            <InfoField
              label="Notes"
              value={lead.notes}
              multiline
              onEdit={(v) => updateLead.mutate({ notes: v })}
            />
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowNotes(true)}
            >
              Add a note
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
