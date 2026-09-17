import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Call, Device } from '@twilio/voice-sdk'
import { Bot, MicOff, Mic, Phone, PhoneOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CallbackScheduleFields,
  type CallbackPreset,
} from '../../components/CallbackScheduleFields'
import { apiFetch } from '../../lib/api'
import {
  CALL_STATUS_OPTIONS,
  CONNECTED_CALL_STATUSES,
  callStatusIsFollowUp,
  callStatusRequiresDate,
  callStatusesByGroup,
} from '../../lib/callStatus'
import { localDateTimeToIso, toLocalDateInput, toLocalTimeInput } from '../../lib/followUp'
import { STAGES, STAGE_LABELS, type Lead } from '../../lib/leads'
import type { LeadWorkspace } from './useLeadWorkspace'

type TelephonyProvider = {
  provider_name: string
  label: string
  provider_type: string
  status: string
  is_active: boolean
  provisioned: boolean
  phone_number: string | null
}

type DialerStatus = 'idle' | 'connecting' | 'in-call' | 'completed'

const CLICK_TO_CALL_PROVIDERS = new Set(['EXOTEL', 'PLIVO'])
const AGENT_PHONE_KEY = 'loomrun_agent_phone'

function fmtSeconds(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Place the call and log what happened, without leaving the lead.
 * Carries over every dialling path from the old Telecaller page: click-to-call,
 * in-browser (Twilio), AI auto-call, and manual.
 */
export function LeadCallPanel({
  lead,
  orgId,
  workspace,
  onLogged,
}: {
  lead: Lead
  orgId: string
  workspace: LeadWorkspace
  /** Fired after a successful call log — used by Sales → Calls to advance the queue. */
  onLogged?: () => void
}) {
  const qc = useQueryClient()
  const [step, setStep] = useState<'call' | 'log'>('call')
  const [callInProgress, setCallInProgress] = useState(false)

  // Dialler
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [agentPhone, setAgentPhone] = useState(() => localStorage.getItem(AGENT_PHONE_KEY) ?? '')
  const [dialerStatus, setDialerStatus] = useState<DialerStatus>('idle')
  const [dialerError, setDialerError] = useState<string | null>(null)
  const [callSeconds, setCallSeconds] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const deviceRef = useRef<Device | null>(null)
  const activeCallRef = useRef<Call | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const secondsRef = useRef(0)
  const logFormRef = useRef<HTMLDivElement>(null)

  // Log form
  const [outcome, setOutcome] = useState('CONNECTED_INTERESTED')
  const [notes, setNotes] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [sendCatalog, setSendCatalog] = useState(false)
  const [sendQuotation, setSendQuotation] = useState(false)
  const [cbDate, setCbDate] = useState('')
  const [cbTime, setCbTime] = useState('10:00')
  const [cbPreset, setCbPreset] = useState<CallbackPreset>('custom')

  // Lead fields the call form can correct in-line (same set as the old page)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [stage, setStage] = useState(lead.stage)
  const [phone, setPhone] = useState(lead.phone ?? '')
  const [email, setEmail] = useState(lead.email ?? '')
  const [city, setCity] = useState(lead.city ?? '')
  const [company, setCompany] = useState(lead.company ?? '')
  const [productInterest, setProductInterest] = useState(lead.product_interest ?? '')
  const [quantityEstimate, setQuantityEstimate] = useState(lead.quantity_estimate ?? '')
  const [estimatedValue, setEstimatedValue] = useState(
    lead.estimated_value != null ? String(lead.estimated_value) : '',
  )
  const [leadNotes, setLeadNotes] = useState(lead.notes ?? '')

  // Mirror server values into the correction form. Deliberately not a remount key:
  // a refetch mid-call must not tear down the live Twilio device.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sync lead fields without remounting the Twilio device */
    setStage(lead.stage)
    setPhone(lead.phone ?? '')
    setEmail(lead.email ?? '')
    setCity(lead.city ?? '')
    setCompany(lead.company ?? '')
    setProductInterest(lead.product_interest ?? '')
    setQuantityEstimate(lead.quantity_estimate ?? '')
    setEstimatedValue(lead.estimated_value != null ? String(lead.estimated_value) : '')
    setLeadNotes(lead.notes ?? '')
    setCbDate(toLocalDateInput(lead.next_follow_up_at))
    setCbTime(toLocalTimeInput(lead.next_follow_up_at) || '10:00')
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    lead.id,
    lead.stage,
    lead.phone,
    lead.email,
    lead.city,
    lead.company,
    lead.product_interest,
    lead.quantity_estimate,
    lead.estimated_value,
    lead.notes,
    lead.next_follow_up_at,
  ])

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
      activeCallRef.current?.disconnect()
      deviceRef.current?.destroy()
    },
    [],
  )

  const providersQ = useQuery({
    queryKey: ['telephony-providers', orgId],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ providers: TelephonyProvider[] }>(`/v1/orgs/${orgId}/telephony/providers`),
  })
  const voiceProviders = (providersQ.data?.providers ?? []).filter(
    (p) => p.provider_type === 'VOICE' && p.provisioned && p.status === 'connected',
  )

  // Default to the first connected provider until the user picks one.
  const providerName = selectedProvider ?? voiceProviders[0]?.provider_name ?? null
  const activeProvider = voiceProviders.find((p) => p.provider_name === providerName)
  const isClickToCall =
    !!activeProvider && CLICK_TO_CALL_PROVIDERS.has(activeProvider.provider_name)
  const leadPhone = phone || lead.phone

  const logCall = useMutation({
    mutationFn: () =>
      apiFetch<{
        lead_stage: string
        stage_changed: boolean
        wa_catalog_sent: boolean
        wa_quotation_sent: boolean
      }>(`/v1/orgs/${orgId}/telecaller/calls`, {
        method: 'POST',
        json: {
          lead_id: lead.id,
          outcome,
          notes: notes || null,
          duration_seconds: durationMinutes ? parseInt(durationMinutes, 10) * 60 : null,
          next_call_at:
            callStatusIsFollowUp(outcome) || cbDate
              ? cbDate
                ? localDateTimeToIso(cbDate, cbTime)
                : null
              : null,
          stage,
          phone,
          email,
          city,
          company,
          product_interest: productInterest || null,
          quantity_estimate: quantityEstimate || null,
          estimated_value: estimatedValue ? Number(estimatedValue) : null,
          lead_notes: leadNotes || null,
          send_catalog: CONNECTED_CALL_STATUSES.has(outcome) ? sendCatalog : false,
          send_quotation: CONNECTED_CALL_STATUSES.has(outcome) ? sendQuotation : false,
        },
      }),
    onSuccess: (data) => {
      toast.success(
        data.stage_changed
          ? `Call saved · lead moved to ${STAGE_LABELS[data.lead_stage] ?? data.lead_stage}`
          : 'Call saved',
      )
      if (data.wa_catalog_sent) toast.success('Catalog sent on WhatsApp')
      if (data.wa_quotation_sent) toast.success('Quotation sent on WhatsApp')
      setNotes('')
      setDurationMinutes('')
      setSendCatalog(false)
      setSendQuotation(false)
      setCallInProgress(false)
      setStep('call')
      workspace.invalidateLeadSurfaces()
      void qc.invalidateQueries({ queryKey: ['leads-picker', orgId] })
      onLogged?.()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const clickToCall = useMutation({
    mutationFn: () =>
      apiFetch<{ call_log_id: string; call_sid: string }>(
        `/v1/orgs/${orgId}/telephony/click-to-call`,
        { method: 'POST', json: { lead_id: lead.id, agent_phone: agentPhone } },
      ),
    onSuccess: () => {
      toast.success('Calling — pick up your phone')
      setCallInProgress(true)
      setOutcome('CONNECTED_INTERESTED')
      setStep('log')
      void qc.invalidateQueries({ queryKey: ['tele-summary', orgId] })
      setTimeout(
        () =>
          logFormRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          }),
        150,
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const aiCall = useMutation({
    mutationFn: () =>
      apiFetch<{ call_log_id: string; call_sid: string }>(`/v1/orgs/${orgId}/telecaller/ai-call`, {
        method: 'POST',
        json: { lead_id: lead.id },
      }),
    onSuccess: () => {
      toast.success('AI is calling this lead')
      void qc.invalidateQueries({ queryKey: ['tele-summary', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function startBrowserCall() {
    if (!leadPhone || !orgId) return
    setDialerError(null)
    setDialerStatus('connecting')
    try {
      if (!deviceRef.current) {
        const { Device: TwilioDevice } = await import('@twilio/voice-sdk')
        const { token } = await apiFetch<{ token: string }>(
          `/v1/orgs/${orgId}/telephony/browser-token`,
        )
        const dev = new TwilioDevice(token, { logLevel: 'warn' })
        await dev.register()
        deviceRef.current = dev
      }
      const call = await deviceRef.current.connect({
        params: { To: leadPhone, leadId: lead.id, orgId },
      })
      activeCallRef.current = call
      setDialerStatus('in-call')
      secondsRef.current = 0
      setCallSeconds(0)
      setCallInProgress(true)
      timerRef.current = setInterval(() => {
        secondsRef.current += 1
        setCallSeconds(secondsRef.current)
      }, 1000)
      call.on('disconnect', () => {
        if (timerRef.current) clearInterval(timerRef.current)
        setDialerStatus('completed')
        setDurationMinutes(String(Math.max(1, Math.ceil(secondsRef.current / 60))))
        setOutcome('CONNECTED_INTERESTED')
        activeCallRef.current = null
        setStep('log')
        setTimeout(
          () =>
            logFormRef.current?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            }),
          150,
        )
      })
      call.on('error', (err: Error) => {
        if (timerRef.current) clearInterval(timerRef.current)
        setDialerStatus('idle')
        setDialerError(err.message)
        setCallInProgress(false)
        activeCallRef.current = null
      })
    } catch (err) {
      setDialerStatus('idle')
      setCallInProgress(false)
      setDialerError(err instanceof Error ? err.message : 'Failed to start call')
    }
  }

  function hangUp() {
    activeCallRef.current?.disconnect()
    if (timerRef.current) clearInterval(timerRef.current)
    setDialerStatus('completed')
    setDurationMinutes(String(Math.max(1, Math.ceil(secondsRef.current / 60))))
    setOutcome('CONNECTED_INTERESTED')
    activeCallRef.current = null
    setStep('log')
  }

  function toggleMute() {
    if (!activeCallRef.current) return
    const next = !isMuted
    activeCallRef.current.mute(next)
    setIsMuted(next)
  }

  function submitLog() {
    if (callStatusRequiresDate(outcome) && !cbDate.trim()) {
      toast.error('Pick a follow-up date')
      return
    }
    logCall.mutate()
  }

  const connectedOutcome = CONNECTED_CALL_STATUSES.has(outcome)

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="panel-tabs">
        <button
          type="button"
          className={`panel-tab${step === 'call' ? ' active' : ''}`}
          onClick={() => setStep('call')}
        >
          1. Make the call
        </button>
        <button
          type="button"
          className={`panel-tab${step === 'log' ? ' active' : ''}`}
          onClick={() => setStep('log')}
        >
          2. Save what happened
          {callInProgress && (
            <span className="badge badge-green" style={{ marginLeft: '0.4rem' }}>
              Live
            </span>
          )}
        </button>
      </div>

      {step === 'call' ? (
        <section className="card stack" style={{ gap: '1rem' }}>
          {!leadPhone && (
            <p className="muted small" style={{ margin: 0 }}>
              This lead has no phone number. Add one under Overview to call.
            </p>
          )}

          {providersQ.isLoading ? (
            <p className="muted small">Checking your calling setup…</p>
          ) : voiceProviders.length === 0 ? (
            <div className="surface-muted" style={{ padding: '0.75rem' }}>
              <p className="small" style={{ margin: 0 }}>
                No calling provider is connected yet. You can still dial from your phone and save
                the outcome here.
              </p>
            </div>
          ) : (
            <div className="form-field">
              <label className="input-label">How do you want to call?</label>
              <div className="call-provider-list">
                {voiceProviders.map((p) => (
                  <label key={p.provider_name} className="call-provider-option">
                    <input
                      type="radio"
                      name="call-provider"
                      value={p.provider_name}
                      checked={providerName === p.provider_name}
                      onChange={() => setSelectedProvider(p.provider_name)}
                    />
                    <span>
                      <strong>{p.label}</strong>
                      <span className="muted small">
                        {p.phone_number ?? 'No number'} ·{' '}
                        {CLICK_TO_CALL_PROVIDERS.has(p.provider_name)
                          ? 'Rings your phone'
                          : 'Call from browser'}
                      </span>
                    </span>
                  </label>
                ))}
                <label className="call-provider-option">
                  <input
                    type="radio"
                    name="call-provider"
                    value="MANUAL"
                    checked={providerName === 'MANUAL'}
                    onChange={() => setSelectedProvider('MANUAL')}
                  />
                  <span>
                    <strong>My own phone</strong>
                    <span className="muted small">Dial manually, then save the outcome</span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {isClickToCall && providerName !== 'MANUAL' && (
            <div className="form-field" style={{ maxWidth: 260 }}>
              <label className="input-label">Your phone number</label>
              <input
                className="input"
                value={agentPhone}
                onChange={(e) => {
                  setAgentPhone(e.target.value)
                  localStorage.setItem(AGENT_PHONE_KEY, e.target.value)
                }}
                placeholder="+91…"
              />
              <span className="muted small">We ring you first, then connect the lead.</span>
            </div>
          )}

          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {isClickToCall && providerName !== 'MANUAL' && (
              <button
                type="button"
                className="btn"
                onClick={() => clickToCall.mutate()}
                disabled={clickToCall.isPending || !agentPhone || !leadPhone}
              >
                <Phone size={14} />
                {clickToCall.isPending ? 'Connecting…' : 'Call now'}
              </button>
            )}

            {!isClickToCall && providerName !== 'MANUAL' && activeProvider && (
              <>
                {(dialerStatus === 'idle' || dialerStatus === 'completed') && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void startBrowserCall()}
                    disabled={!leadPhone}
                  >
                    <Phone size={14} />
                    Call from browser
                  </button>
                )}
                {dialerStatus === 'connecting' && (
                  <button type="button" className="btn" disabled>
                    Connecting…
                  </button>
                )}
                {dialerStatus === 'in-call' && (
                  <>
                    <span className="badge badge-green">{fmtSeconds(callSeconds)}</span>
                    <button type="button" className="btn btn-secondary" onClick={toggleMute}>
                      {isMuted ? <Mic size={14} /> : <MicOff size={14} />}
                      {isMuted ? 'Unmute' : 'Mute'}
                    </button>
                    <button type="button" className="btn btn-danger" onClick={hangUp}>
                      <PhoneOff size={14} />
                      Hang up
                    </button>
                  </>
                )}
              </>
            )}

            {leadPhone && (
              <a className="btn btn-secondary" href={`tel:${leadPhone}`}>
                <Phone size={14} />
                Dial on my phone
              </a>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => aiCall.mutate()}
              disabled={aiCall.isPending || !leadPhone}
              title="Let the AI agent call this lead"
            >
              <Bot size={14} />
              {aiCall.isPending ? 'Starting…' : 'AI calls for me'}
            </button>

            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setStep('log')
                setTimeout(
                  () =>
                    logFormRef.current?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    }),
                  100,
                )
              }}
            >
              Save what happened
            </button>
          </div>

          {dialerError && <p className="error small">{dialerError}</p>}
        </section>
      ) : (
        <section
          ref={logFormRef}
          className="card stack"
          style={{
            gap: '1rem',
            border: callInProgress ? '1px solid var(--primary)' : undefined,
          }}
        >
          <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <div className="drawer-section-title" style={{ margin: 0 }}>
              What happened on the call?
            </div>
            {callInProgress && <span className="badge badge-green">In progress</span>}
          </div>

          <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <div className="form-field" style={{ flex: '1 1 240px' }}>
              <label className="input-label">Outcome *</label>
              <select
                className="select"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
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
            <div className="form-field" style={{ flex: '0 1 150px' }}>
              <label className="input-label">Call length (min)</label>
              <input
                className="input"
                type="number"
                min={0}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </div>
            <div className="form-field" style={{ flex: '1 1 200px' }}>
              <label className="input-label">Lead stage</label>
              <select className="select" value={stage} onChange={(e) => setStage(e.target.value)}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s] ?? s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-field">
            <label className="input-label">Call notes</label>
            <textarea
              className="input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did they say? What did you promise?"
            />
          </div>

          {callStatusIsFollowUp(outcome) && (
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
          )}

          {connectedOutcome && (
            <div className="stack" style={{ gap: '0.4rem' }}>
              <label className="row small" style={{ gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={sendCatalog}
                  onChange={(e) => setSendCatalog(e.target.checked)}
                />
                Send our catalog on WhatsApp
              </label>
              <label className="row small" style={{ gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={sendQuotation}
                  onChange={(e) => setSendQuotation(e.target.checked)}
                />
                Send the latest quotation on WhatsApp
              </label>
            </div>
          )}

          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? 'Hide lead details' : 'Correct lead details while saving'}
            </button>
            {detailsOpen && (
              <div
                className="row"
                style={{
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                  marginTop: '0.6rem',
                }}
              >
                <div className="form-field" style={{ flex: '1 1 160px' }}>
                  <label className="input-label">Phone</label>
                  <input
                    className="input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: '1 1 160px' }}>
                  <label className="input-label">Email</label>
                  <input
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: '1 1 140px' }}>
                  <label className="input-label">City</label>
                  <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div className="form-field" style={{ flex: '1 1 160px' }}>
                  <label className="input-label">Company</label>
                  <input
                    className="input"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: '1 1 180px' }}>
                  <label className="input-label">What they want</label>
                  <input
                    className="input"
                    value={productInterest}
                    onChange={(e) => setProductInterest(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: '1 1 120px' }}>
                  <label className="input-label">Quantity</label>
                  <input
                    className="input"
                    value={quantityEstimate}
                    onChange={(e) => setQuantityEstimate(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: '1 1 140px' }}>
                  <label className="input-label">Order value (₹)</label>
                  <input
                    className="input"
                    type="number"
                    value={estimatedValue}
                    onChange={(e) => setEstimatedValue(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: '1 1 100%' }}>
                  <label className="input-label">Lead notes</label>
                  <textarea
                    className="input"
                    rows={2}
                    value={leadNotes}
                    onChange={(e) => setLeadNotes(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="row" style={{ gap: '0.5rem' }}>
            <button type="button" className="btn" onClick={submitLog} disabled={logCall.isPending}>
              {logCall.isPending ? 'Saving…' : 'Save call'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep('call')}>
              Back to calling
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
