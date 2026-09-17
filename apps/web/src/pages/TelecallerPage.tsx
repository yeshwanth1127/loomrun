import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Call, Device } from '@twilio/voice-sdk'
import {
  Bot,
  CheckCircle,
  ChevronDown,
  Mail,
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Send,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { LeadSearchSelect } from '../components/LeadSearchSelect'
import { CallbackScheduleFields, type CallbackPreset } from '../components/CallbackScheduleFields'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { DonutChart, DonutLegend, MetricCard } from '../components/ui/dashboard'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'
import {
  CALL_STATUS_MAP,
  CALL_STATUS_OPTIONS,
  CONNECTED_CALL_STATUSES,
} from '../lib/callStatus'
import {
  localDateTimeToIso,
  toLocalDateInput,
  toLocalTimeInput,
  tomorrowAt10Local,
} from '../lib/followUp'

type LeadDetail = {
  id: string
  title: string
  stage: string
  phone: string | null
  email: string | null
  city: string | null
  company: string | null
  product_interest: string | null
  quantity_estimate: string | null
  next_follow_up_at: string | null
  estimated_value: number | null
  notes: string | null
}

type TelephonyProvider = {
  provider_name: string
  label: string
  provider_type: string
  status: string
  is_active: boolean
  provisioned: boolean
  phone_number: string | null
}

const STAGES = ['NEW', 'CONTACTED', 'QUALIFICATION', 'QUOTATION', 'NEGOTIATION', 'SAMPLE', 'WON', 'LOST']

const STAGE_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFICATION: 'Requirement Collected',
  QUOTATION: 'Quoted',
  NEGOTIATION: 'Negotiation',
  SAMPLE: 'Sample Sent',
  WON: 'Won',
  LOST: 'Lost',
}

const CLICK_TO_CALL_PROVIDERS = new Set(['EXOTEL', 'PLIVO'])

const EMPTY_LEAD_FIELDS = {
  stage: 'NEW',
  phone: '',
  email: '',
  city: '',
  company: '',
  productInterest: '',
  quantityEstimate: '',
  nextFollowUpDate: '',
  nextFollowUpTime: '',
  estimatedValue: '',
  leadNotes: '',
}

export function TelecallerPage() {
  const { orgId, me } = useAuth()
  const qc = useQueryClient()
  const saveCallRef = useRef<HTMLDivElement>(null)
  const [searchParams] = useSearchParams()
  const [workStep, setWorkStep] = useState<'call' | 'log'>('call')
  const [leadDetailsOpen, setLeadDetailsOpen] = useState(false)

  // ── Lead state ──────────────────────────────────────────────────────────────
  const [leadId, setLeadId] = useState(() => searchParams.get('lead') ?? '')
  const [stage, setStage] = useState(EMPTY_LEAD_FIELDS.stage)
  const [phone, setPhone] = useState(EMPTY_LEAD_FIELDS.phone)
  const [email, setEmail] = useState(EMPTY_LEAD_FIELDS.email)
  const [city, setCity] = useState(EMPTY_LEAD_FIELDS.city)
  const [company, setCompany] = useState(EMPTY_LEAD_FIELDS.company)
  const [productInterest, setProductInterest] = useState(EMPTY_LEAD_FIELDS.productInterest)
  const [quantityEstimate, setQuantityEstimate] = useState(EMPTY_LEAD_FIELDS.quantityEstimate)
  const [nextFollowUpDate, setNextFollowUpDate] = useState(EMPTY_LEAD_FIELDS.nextFollowUpDate)
  const [nextFollowUpTime, setNextFollowUpTime] = useState(EMPTY_LEAD_FIELDS.nextFollowUpTime)
  const [callbackPreset, setCallbackPreset] = useState<CallbackPreset>('custom')
  const [estimatedValue, setEstimatedValue] = useState(EMPTY_LEAD_FIELDS.estimatedValue)
  const [leadNotes, setLeadNotes] = useState(EMPTY_LEAD_FIELDS.leadNotes)

  // ── Call log state ──────────────────────────────────────────────────────────
  const [outcome, setOutcome] = useState('CONNECTED_INTERESTED')
  const [notes, setNotes] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [sendCatalog, setSendCatalog] = useState(false)
  const [sendQuotation, setSendQuotation] = useState(false)
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)

  // ── Telephony selection state ───────────────────────────────────────────────
  const [selectedProvider, setSelectedProvider] = useState<string>('') // provider_name
  const [agentPhone, setAgentPhone] = useState(() => localStorage.getItem('loomrun_agent_phone') ?? '')
  const [callInProgress, setCallInProgress] = useState(false)

  // ── Browser dialer state (Twilio) ───────────────────────────────────────────
  type DialerStatus = 'idle' | 'connecting' | 'in-call' | 'completed'
  const [dialerStatus, setDialerStatus] = useState<DialerStatus>('idle')
  const [callSeconds, setCallSeconds] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [dialerError, setDialerError] = useState<string | null>(null)
  const deviceRef = useRef<Device | null>(null)
  const activeCallRef = useRef<Call | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { dayParam, appendDay, isAll, isToday } = useDateFilter()

  // ── Queries ─────────────────────────────────────────────────────────────────
  const leadDetailQ = useQuery({
    queryKey: ['lead-detail', orgId, leadId],
    enabled: !!orgId && !!leadId,
    queryFn: () => apiFetch<LeadDetail>(`/v1/orgs/${orgId}/leads/${leadId}`),
  })

  const providersQ = useQuery({
    queryKey: ['telephony-providers', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ providers: TelephonyProvider[] }>(`/v1/orgs/${orgId}/telephony/providers`),
  })

  // Voice providers that are active and provisioned
  const voiceProviders = (providersQ.data?.providers ?? []).filter(
    (p) => p.provider_type === 'VOICE' && p.provisioned && p.status === 'connected'
  )

  // Auto-select the first available provider
  useEffect(() => {
    if (selectedProvider || voiceProviders.length === 0) return
    setSelectedProvider(voiceProviders[0].provider_name)
  }, [voiceProviders, selectedProvider])

  const activeProvider = voiceProviders.find((p) => p.provider_name === selectedProvider)
  const isClickToCall = activeProvider ? CLICK_TO_CALL_PROVIDERS.has(activeProvider.provider_name) : false

  // ── Sync lead details into form ─────────────────────────────────────────────
  useEffect(() => {
    if (!leadId) {
      setStage(EMPTY_LEAD_FIELDS.stage)
      setPhone(EMPTY_LEAD_FIELDS.phone)
      setEmail(EMPTY_LEAD_FIELDS.email)
      setCity(EMPTY_LEAD_FIELDS.city)
      setCompany(EMPTY_LEAD_FIELDS.company)
      setProductInterest(EMPTY_LEAD_FIELDS.productInterest)
      setQuantityEstimate(EMPTY_LEAD_FIELDS.quantityEstimate)
      setNextFollowUpDate(EMPTY_LEAD_FIELDS.nextFollowUpDate)
      setNextFollowUpTime(EMPTY_LEAD_FIELDS.nextFollowUpTime)
      setCallbackPreset('custom')
      setEstimatedValue(EMPTY_LEAD_FIELDS.estimatedValue)
      setLeadNotes(EMPTY_LEAD_FIELDS.leadNotes)
      return
    }
    const d = leadDetailQ.data
    if (!d || d.id !== leadId) return
    setStage(d.stage)
    setPhone(d.phone ?? '')
    setEmail(d.email ?? '')
    setCity(d.city ?? '')
    setCompany(d.company ?? '')
    setProductInterest(d.product_interest ?? '')
    setQuantityEstimate(d.quantity_estimate ?? '')
    setNextFollowUpDate(toLocalDateInput(d.next_follow_up_at))
    setNextFollowUpTime(toLocalTimeInput(d.next_follow_up_at) || '10:00')
    setCallbackPreset('custom')
    setEstimatedValue(d.estimated_value != null ? String(d.estimated_value) : '')
    setLeadNotes(d.notes ?? '')
  }, [leadId, leadDetailQ.data])

  useEffect(() => {
    setShareOpen(false)
  }, [leadId])

  const membership = me?.organizations.find((o) => o.organization.id === orgId)
  const isTelecaller = membership?.role === 'TELECALLER'
  const myUserId = me?.id ?? null
  const summaryUserId = isTelecaller ? myUserId : null
  const [shareOpen, setShareOpen] = useState(false)
  const shareRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shareOpen) return
    function onDocClick(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [shareOpen])

  // ── Summary query ───────────────────────────────────────────────────────────
  const summary = useQuery({
    queryKey: ['tele-summary', orgId, summaryUserId, dayParam],
    enabled: !!orgId,
    refetchInterval: isAll ? false : isToday ? 30_000 : false,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      if (summaryUserId) params.set('user_id', summaryUserId)
      return apiFetch<{
        date: string
        total_calls: number
        by_outcome: Record<string, number>
        calls: { id: string; lead_title: string | null; logged_by: string | null; outcome: string; created_at: string }[]
      }>(`/v1/orgs/${orgId}/telecaller/daily-summary?${params}`)
    },
  })

  const callDetail = useQuery({
    queryKey: ['call-detail', orgId, selectedCallId],
    enabled: !!orgId && !!selectedCallId,
    queryFn: () =>
      apiFetch<{
        id: string
        lead_title: string | null
        logged_by: string | null
        outcome: string
        notes: string | null
        duration_seconds: number | null
        call_source: string
        attempt_number: number
        recording_url: string | null
        transcript_raw: string | null
        ai_summary: string | null
        created_at: string
        next_call_at: string | null
      }>(`/v1/orgs/${orgId}/telecaller/calls/${selectedCallId}`),
  })

  // ── Log call mutation ───────────────────────────────────────────────────────
  const logCall = useMutation({
    mutationFn: () =>
      apiFetch<{
        id: string
        lead_id: string
        attempt_number: number
        outcome: string
        created_at: string
        logged_by: string | null
        lead_stage: string
        stage_changed: boolean
        wa_catalog_sent: boolean
        wa_quotation_sent: boolean
      }>(
        `/v1/orgs/${orgId}/telecaller/calls`,
        {
          method: 'POST',
          json: {
            lead_id: leadId,
            outcome,
            notes: notes || null,
            duration_seconds: durationMinutes ? parseInt(durationMinutes, 10) * 60 : null,
            next_call_at:
              outcome === 'CALLBACK_SCHEDULED'
                ? localDateTimeToIso(nextFollowUpDate, nextFollowUpTime)
                : nextFollowUpDate
                  ? localDateTimeToIso(nextFollowUpDate, nextFollowUpTime)
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
        }
      ),
    onSuccess: () => {
      setNotes('')
      setDurationMinutes('')
      setSendCatalog(false)
      setSendQuotation(false)
      setCallInProgress(false)
      void qc.invalidateQueries({ queryKey: ['tele-summary', orgId] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      void qc.invalidateQueries({ queryKey: ['leads-picker', orgId] })
      void qc.invalidateQueries({ queryKey: ['follow-ups', orgId] })
      void qc.invalidateQueries({ queryKey: ['follow-ups-due', orgId] })
      if (leadId) void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, leadId] })
    },
  })

  const sendQuote = useMutation({
    mutationFn: async (channel: 'whatsapp' | 'email') => {
      const leadPhoneNow = phone || leadDetailQ.data?.phone || ''
      const leadEmailNow = email || leadDetailQ.data?.email || ''
      if (channel === 'whatsapp' && !leadPhoneNow) {
        throw new Error('This lead has no phone number')
      }
      if (channel === 'email' && !leadEmailNow) {
        throw new Error('This lead has no email address')
      }

      const { items } = await apiFetch<{
        items: Array<{
          id: string
          lead_id: string
          pdf_url: string | null
          number: string
        }>
      }>(`/v1/orgs/${orgId}/quotations?day=all&doc=quotation`)

      const forLead = items.filter((q) => q.lead_id === leadId)
      const ready = forLead.find((q) => !!q.pdf_url)
      if (!ready) {
        const draft = forLead.find((q) => !q.pdf_url)
        if (draft) {
          throw new Error(
            `Quotation ${draft.number} is still a draft — ask an owner to Generate PDF before sending`,
          )
        }
        throw new Error('No quotation for this lead yet — create one on Quotations')
      }

      return apiFetch<{ message?: string; channel: string }>(
        `/v1/orgs/${orgId}/quotations/${ready.id}/send`,
        {
          method: 'POST',
          json: { channel, doc_type: 'quotation' },
        },
      )
    },
    onSuccess: (data) => {
      setShareOpen(false)
      const via = data.channel === 'whatsapp' ? 'WhatsApp' : 'Email'
      toast.success(data.message ?? `Quotation sent via ${via}`)
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      if (leadId) void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, leadId] })
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to send quotation')
    },
  })

  // ── Click-to-call (Exotel) ──────────────────────────────────────────────────
  const clickToCall = useMutation({
    mutationFn: () =>
      apiFetch<{ call_log_id: string; call_sid: string }>(
        `/v1/orgs/${orgId}/telephony/click-to-call`,
        { method: 'POST', json: { lead_id: leadId, agent_phone: agentPhone } }
      ),
    onSuccess: () => {
      setCallInProgress(true)
      setOutcome('CONNECTED_INTERESTED')
      void qc.invalidateQueries({ queryKey: ['tele-summary', orgId] })
      setTimeout(() => saveCallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
      setWorkStep('log')
    },
  })

  // ── AI auto-call ────────────────────────────────────────────────────────────
  const aiCall = useMutation({
    mutationFn: () =>
      apiFetch<{ call_log_id: string; call_sid: string }>(
        `/v1/orgs/${orgId}/telecaller/ai-call`,
        { method: 'POST', json: { lead_id: leadId } }
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tele-summary', orgId] })
    },
  })

  // ── Browser dialer functions (Twilio) ───────────────────────────────────────
  async function startBrowserCall() {
    const targetPhone = phone || leadDetailQ.data?.phone
    if (!targetPhone || !leadId || !orgId) return
    setDialerError(null)
    setDialerStatus('connecting')
    try {
      if (!deviceRef.current) {
        const { Device: TwilioDevice } = await import('@twilio/voice-sdk')
        const { token } = await apiFetch<{ token: string }>(`/v1/orgs/${orgId}/telephony/browser-token`)
        const dev = new TwilioDevice(token, { logLevel: 'warn' })
        await dev.register()
        deviceRef.current = dev
      }
      const call = await deviceRef.current.connect({ params: { To: targetPhone, leadId, orgId } })
      activeCallRef.current = call
      setDialerStatus('in-call')
      setCallSeconds(0)
      setCallInProgress(true)
      timerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000)
      call.on('disconnect', () => {
        if (timerRef.current) clearInterval(timerRef.current)
        setDialerStatus('completed')
        setDurationMinutes(String(Math.ceil(callSeconds / 60)))
        setOutcome('CONNECTED_INTERESTED')
        activeCallRef.current = null
        setWorkStep('log')
        setTimeout(() => saveCallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
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
    setDurationMinutes(String(Math.ceil(callSeconds / 60)))
    setOutcome('CONNECTED_INTERESTED')
    activeCallRef.current = null
  }

  function toggleMute() {
    if (!activeCallRef.current) return
    const next = !isMuted
    activeCallRef.current.mute(next)
    setIsMuted(next)
  }

  function fmtSeconds(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  if (!orgId) return (
    <>
      <div className="page-header"><h1>Telecaller</h1><p>Select an organization.</p></div>
    </>
  )

  const data = summary.data
  const calls = data?.calls ?? []
  const byOutcome = data?.by_outcome ?? {}
  const leadPhone = phone || leadDetailQ.data?.phone || ''
  const leadEmail = email || leadDetailQ.data?.email || ''
  const waDigits = leadPhone.replace(/\D/g, '')

  return (
    <>
      <PageHeader
        title="Telecaller"
        badge={data ? `${data.total_calls} calls` : undefined}
        description={isTelecaller ? 'Your calls and daily performance' : 'Log calls and track daily performance'}
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {data && (
          <div className="metrics-grid">
            <MetricCard icon={Phone} tone="purple" label="Total calls" value={data.total_calls} hint={isAll ? 'All time' : isToday ? 'Today' : data.date} />
            <MetricCard
              icon={CheckCircle}
              tone="green"
              label="Connected"
              value={(byOutcome.CONNECTED_INTERESTED ?? 0) + (byOutcome.CONNECTED ?? 0) + (byOutcome.QUALIFIED ?? 0) + (byOutcome.ORDER_CONFIRMED ?? 0)}
              hint={data.total_calls ? `${((((byOutcome.CONNECTED_INTERESTED ?? 0) + (byOutcome.CONNECTED ?? 0) + (byOutcome.QUALIFIED ?? 0) + (byOutcome.ORDER_CONFIRMED ?? 0)) / data.total_calls) * 100).toFixed(1)}%` : '0%'}
            />
            <MetricCard icon={Phone} tone="red" label="Not interested" value={(byOutcome.CONNECTED_NOT_INTERESTED ?? 0) + (byOutcome.NOT_INTERESTED ?? 0)} />
            <MetricCard icon={Phone} tone="slate" label="No response" value={(byOutcome.RINGING_NO_RESPONSE ?? 0) + (byOutcome.NO_ANSWER ?? 0) + (byOutcome.SWITCHED_OFF ?? 0)} />
            <MetricCard icon={Phone} tone="amber" label="Busy" value={byOutcome.BUSY ?? 0} />
            <MetricCard icon={Phone} tone="purple" label="Qualified" value={(byOutcome.QUALIFIED ?? 0) + (byOutcome.ORDER_CONFIRMED ?? 0)} />
            <MetricCard icon={Phone} tone="green" label="Call back" value={byOutcome.CALLBACK_SCHEDULED ?? 0} />
          </div>
        )}
        <div className="page-grid-2">

        {/* Left column: Make Call + Save Call */}
        <div className="stack" style={{ gap: '1rem' }}>
          <div className="panel-tabs" style={{ paddingLeft: 0, paddingRight: 0, background: 'transparent' }}>
            <button
              type="button"
              className={`panel-tab${workStep === 'call' ? ' active' : ''}`}
              onClick={() => setWorkStep('call')}
            >
              1. Make call
            </button>
            <button
              type="button"
              className={`panel-tab${workStep === 'log' ? ' active' : ''}`}
              onClick={() => setWorkStep('log')}
            >
              2. Log result
              {callInProgress && <span className="badge badge-indigo" style={{ marginLeft: '0.35rem', fontSize: '0.65rem' }}>Live</span>}
            </button>
          </div>

          {/* ── Make Call ── */}
          {workStep === 'call' && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Phone size={16} style={{ color: 'var(--primary)' }} />
              Make Call
            </div>

            {/* Lead selector */}
            <div className="form-field" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Lead *</label>
              <LeadSearchSelect orgId={orgId} value={leadId} onChange={(id) => setLeadId(id)} required />
            </div>

            {leadId && leadDetailQ.isLoading && <p className="muted small">Loading lead…</p>}

            {/* Same quick actions as Leads Contacted drawer */}
            {leadId && !leadDetailQ.isLoading && (
              <div className="quick-actions" style={{ marginBottom: '1rem' }}>
                {leadPhone && (
                  <a href={`tel:${leadPhone}`} className="quick-action-btn">
                    <Phone size={13} /> Call
                  </a>
                )}
                {waDigits && (
                  <a
                    href={`https://wa.me/${waDigits}`}
                    target="_blank"
                    rel="noreferrer"
                    className="quick-action-btn"
                  >
                    <MessageCircle size={13} /> WhatsApp
                  </a>
                )}
                {leadEmail && (
                  <a href={`mailto:${leadEmail}`} className="quick-action-btn">
                    <Mail size={13} /> Gmail
                  </a>
                )}
                <div className="quick-action-dropdown" ref={shareRef}>
                  <button
                    type="button"
                    className="quick-action-btn primary"
                    aria-haspopup="menu"
                    aria-expanded={shareOpen}
                    disabled={sendQuote.isPending}
                    onClick={() => setShareOpen((v) => !v)}
                  >
                    <Send size={13} />
                    {sendQuote.isPending ? 'Sending…' : 'Send Quote'}
                    <ChevronDown size={13} />
                  </button>
                  {shareOpen && (
                    <div className="quick-action-menu" role="menu">
                      <button
                        type="button"
                        className="quick-action-menu-item"
                        role="menuitem"
                        disabled={sendQuote.isPending || !leadPhone}
                        title={
                          leadPhone
                            ? `Send quotation on WhatsApp to ${leadPhone}`
                            : 'This lead has no phone number'
                        }
                        onClick={() => sendQuote.mutate('whatsapp')}
                      >
                        <MessageCircle size={13} /> WhatsApp
                      </button>
                      <button
                        type="button"
                        className="quick-action-menu-item"
                        role="menuitem"
                        disabled={sendQuote.isPending || !leadEmail}
                        title={
                          leadEmail
                            ? `Email quotation to ${leadEmail}`
                            : 'This lead has no email address'
                        }
                        onClick={() => sendQuote.mutate('email')}
                      >
                        <Mail size={13} /> Gmail
                      </button>
                    </div>
                  )}
                </div>
                {stage === 'CONTACTED' && (
                  <select
                    className="select"
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    style={{ fontSize: '0.8rem', paddingRight: '1.8rem', minWidth: '11rem' }}
                  >
                    <option value="" disabled>Call status…</option>
                    {CALL_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Lead phone display */}
            {leadId && !leadDetailQ.isLoading && (
              <div style={{ marginBottom: '1rem', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.875rem' }}>
                <span className="muted small">Lead phone: </span>
                <strong>{leadPhone || '—'}</strong>
                {!leadPhone && (
                  <span className="muted small" style={{ marginLeft: '0.5rem' }}>
                    (add phone in Save Call section below)
                  </span>
                )}
              </div>
            )}

            {/* Phone number selector */}
            {voiceProviders.length > 0 ? (
              <div className="stack" style={{ gap: '0.75rem', marginBottom: '1rem' }}>
                <div className="input-label">Call from</div>
                <div className="stack" style={{ gap: '0.5rem' }}>
                  {voiceProviders.map((p) => (
                    <label
                      key={p.provider_name}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.6rem',
                        padding: '0.65rem 0.75rem',
                        borderRadius: '8px',
                        border: `1px solid ${selectedProvider === p.provider_name ? 'var(--primary)' : '#e2e8f0'}`,
                        background: selectedProvider === p.provider_name ? '#f5f3ff' : '#fff',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <input
                        type="radio"
                        name="provider"
                        value={p.provider_name}
                        checked={selectedProvider === p.provider_name}
                        onChange={() => setSelectedProvider(p.provider_name)}
                        style={{ marginTop: '2px' }}
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{p.label}</div>
                        <div className="muted small">{p.phone_number ?? 'No number'} · {CLICK_TO_CALL_PROVIDERS.has(p.provider_name) ? 'Click-to-call' : 'Browser call'}</div>
                      </div>
                    </label>
                  ))}
                  {/* Manual option — always shown */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.6rem',
                      padding: '0.65rem 0.75rem',
                      borderRadius: '8px',
                      border: `1px solid ${selectedProvider === 'MANUAL' ? 'var(--primary)' : '#e2e8f0'}`,
                      background: selectedProvider === 'MANUAL' ? '#f5f3ff' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <input
                      type="radio"
                      name="provider"
                      value="MANUAL"
                      checked={selectedProvider === 'MANUAL'}
                      onChange={() => setSelectedProvider('MANUAL')}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Manual / Own phone</div>
                      <div className="muted small">Call directly from your phone — just log the result</div>
                    </div>
                  </label>
                </div>

                {/* Exotel agent phone input */}
                {isClickToCall && selectedProvider !== 'MANUAL' && (
                  <div className="form-field">
                    <label className="input-label">Your phone number</label>
                    <input
                      className="input"
                      type="tel"
                      placeholder="+919876543210"
                      value={agentPhone}
                      onChange={(e) => {
                        setAgentPhone(e.target.value)
                        localStorage.setItem('loomrun_agent_phone', e.target.value)
                      }}
                      style={{ width: '100%' }}
                    />
                    <p className="muted small" style={{ marginTop: '0.2rem' }}>
                      {activeProvider?.label} will call this number first, then connect to the lead.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#fafafa', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#64748b' }}>
                No telephony configured. Go to Telephony settings to connect Exotel or Twilio, or use Manual below.
              </div>
            )}

            {/* Call action buttons */}
            {leadId && (
              <div className="stack" style={{ gap: '0.5rem' }}>
                {/* Exotel / click-to-call */}
                {isClickToCall && selectedProvider !== 'MANUAL' && (
                  <>
                    {callInProgress ? (
                      <div style={{ padding: '0.75rem', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd' }}>
                        <p style={{ fontSize: '0.875rem', color: '#0369a1', fontWeight: 600, marginBottom: '0.25rem' }}>
                          📞 {activeProvider?.label} is calling {agentPhone}…
                        </p>
                        <p className="muted small">Pick up — you'll be bridged to the lead automatically.</p>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ marginTop: '0.5rem' }}
                          onClick={() => { setCallInProgress(false); clickToCall.reset() }}
                        >
                          Make another call
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        disabled={clickToCall.isPending || !agentPhone || !leadPhone}
                        onClick={() => void clickToCall.mutateAsync()}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                      >
                        <Phone size={15} />
                        {clickToCall.isPending ? 'Initiating…' : 'Make Call'}
                      </button>
                    )}
                    {clickToCall.isError && (
                      <p className="error" style={{ fontSize: '0.8rem' }}>{(clickToCall.error as Error).message}</p>
                    )}
                  </>
                )}

                {/* Twilio browser call */}
                {!isClickToCall && selectedProvider !== 'MANUAL' && activeProvider && (
                  <>
                    {dialerStatus === 'idle' || dialerStatus === 'completed' ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={!leadPhone}
                        onClick={() => void startBrowserCall()}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                      >
                        <Phone size={15} />
                        Make Call
                      </button>
                    ) : dialerStatus === 'connecting' ? (
                      <div className="muted small" style={{ padding: '0.5rem' }}>Connecting…</div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, color: '#16a34a', fontSize: '0.9rem' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                          {fmtSeconds(callSeconds)}
                        </span>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={toggleMute} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {isMuted ? <MicOff size={13} /> : <Mic size={13} />}
                          {isMuted ? 'Unmute' : 'Mute'}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={hangUp} style={{ background: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <PhoneOff size={13} />
                          Hang up
                        </button>
                      </div>
                    )}
                    {dialerError && <p className="error" style={{ fontSize: '0.8rem' }}>{dialerError}</p>}
                  </>
                )}

                {/* Manual — just a prompt to log below */}
                {selectedProvider === 'MANUAL' && (
                  <div style={{ padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#64748b' }}>
                    Call <strong>{leadPhone || 'the lead'}</strong> manually, then fill in the result below.
                  </div>
                )}

                {/* AI Auto-call — available regardless of provider */}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={aiCall.isPending || !leadPhone}
                  onClick={() => void aiCall.mutateAsync()}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', alignSelf: 'flex-start' }}
                >
                  <Bot size={13} />
                  {aiCall.isPending ? 'Calling…' : 'AI Auto-Call'}
                </button>
                {aiCall.isSuccess && <p style={{ fontSize: '0.8rem', color: '#16a34a' }}>AI call initiated.</p>}
                {aiCall.error && <p className="error" style={{ fontSize: '0.8rem' }}>{(aiCall.error as Error).message}</p>}

                {!leadPhone && (
                  <p className="muted small">Add a phone number in Log result to enable calling.</p>
                )}
              </div>
            )}

            {leadId && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: '0.75rem' }}
                onClick={() => setWorkStep('log')}
              >
                Continue to log result
              </button>
            )}
          </div>
          )}

          {/* ── Save Call ── */}
          {workStep === 'log' && (
          <div className="card" ref={saveCallRef} style={callInProgress ? { border: '1px solid var(--primary)', boxShadow: '0 0 0 3px var(--ring-soft)' } : {}}>
            <div style={{ fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <PhoneCall size={16} style={{ color: callInProgress ? 'var(--primary)' : 'var(--muted-fg)' }} />
              Log result
              {callInProgress && (
                <span className="badge badge-indigo" style={{ marginLeft: '0.25rem', fontSize: '0.7rem' }}>In progress</span>
              )}
            </div>

            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                if (!leadId) return
                if (outcome === 'CALLBACK_SCHEDULED' && !nextFollowUpDate.trim()) {
                  toast.error('Pick a follow-up date for Follow Up')
                  return
                }
                void logCall.mutateAsync()
              }}
            >
              {!leadId && (
                <p className="muted small">Select a lead above to log a call.</p>
              )}

              {leadId && (
                <>
                  {/* Lead details — collapsed by default */}
                  <div className="stack" style={{ gap: '0.75rem', padding: '0.75rem', background: 'var(--secondary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <button
                      type="button"
                      className="row spread"
                      style={{
                        width: '100%',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        color: 'var(--foreground)',
                        padding: 0,
                      }}
                      onClick={() => setLeadDetailsOpen((v) => !v)}
                      aria-expanded={leadDetailsOpen}
                    >
                      <span>Lead details</span>
                      <ChevronDown
                        size={16}
                        style={{
                          transform: leadDetailsOpen ? 'rotate(180deg)' : undefined,
                          transition: 'transform 0.15s ease',
                          color: 'var(--muted-fg)',
                        }}
                      />
                    </button>
                    {leadDetailsOpen && (
                      <>
                    <div className="form-field">
                      <label className="input-label">Stage</label>
                      <select className="select" value={stage} onChange={(e) => setStage(e.target.value)} style={{ width: '100%' }}>
                        {STAGES.map((s) => (
                          <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>
                        ))}
                      </select>
                    </div>
                    <div className="row" style={{ gap: '0.75rem' }}>
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="input-label">Phone</label>
                        <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: '100%' }} />
                      </div>
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="input-label">Email</label>
                        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} />
                      </div>
                    </div>
                    <div className="row" style={{ gap: '0.75rem' }}>
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="input-label">City</label>
                        <input className="input" value={city} onChange={(e) => setCity(e.target.value)} style={{ width: '100%' }} />
                      </div>
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="input-label">Company</label>
                        <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} style={{ width: '100%' }} />
                      </div>
                    </div>
                    <div className="row" style={{ gap: '0.75rem' }}>
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="input-label">Product interest</label>
                        <input className="input" value={productInterest} onChange={(e) => setProductInterest(e.target.value)} style={{ width: '100%' }} />
                      </div>
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="input-label">Quantity</label>
                        <input className="input" value={quantityEstimate} onChange={(e) => setQuantityEstimate(e.target.value)} style={{ width: '100%' }} />
                      </div>
                    </div>
                    <div className="row" style={{ gap: '0.75rem' }}>
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="input-label">Est. value (₹)</label>
                        <input className="input" type="number" min="0" step="0.01" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} style={{ width: '100%' }} />
                      </div>
                    </div>
                    <div className="form-field">
                      <label className="input-label">Lead notes</label>
                      <textarea className="input" rows={2} value={leadNotes} onChange={(e) => setLeadNotes(e.target.value)} style={{ width: '100%', resize: 'vertical' }} placeholder="Persistent notes on the lead record…" />
                    </div>
                      </>
                    )}
                  </div>

                  {/* Call result */}
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--muted-fg)' }}>Call result</div>
                  <div className="form-field">
                    <label className="input-label">Call status</label>
                    <select
                      className="select"
                      value={outcome}
                      onChange={(e) => {
                        const next = e.target.value
                        setOutcome(next)
                        if (next === 'CALLBACK_SCHEDULED' && !nextFollowUpDate) {
                          const p = tomorrowAt10Local()
                          setNextFollowUpDate(p.date)
                          setNextFollowUpTime(p.time)
                          setCallbackPreset('tomorrow')
                        }
                      }}
                      style={{ width: '100%' }}
                    >
                      <option value="" disabled>Call status…</option>
                      {CALL_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  {outcome === 'CALLBACK_SCHEDULED' && (
                    <CallbackScheduleFields
                      date={nextFollowUpDate}
                      time={nextFollowUpTime}
                      preset={callbackPreset}
                      onChange={({ date, time, preset }) => {
                        setNextFollowUpDate(date)
                        setNextFollowUpTime(time)
                        setCallbackPreset(preset)
                      }}
                    />
                  )}

                  <div className="row" style={{ gap: '0.75rem' }}>
                    <div className="form-field" style={{ flex: 1 }}>
                      <label className="input-label">Duration (minutes)</label>
                      <input className="input" type="number" placeholder="e.g. 5" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} style={{ width: '100%' }} />
                    </div>
                  </div>
                  <div className="form-field">
                    <label className="input-label">Call notes / summary</label>
                    <textarea className="input" rows={3} placeholder="What was discussed on this call…" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
                  </div>

                  {/* WhatsApp automation */}
                  {CONNECTED_CALL_STATUSES.has(outcome) && (
                    <div style={{ padding: '0.75rem', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0369a1', marginBottom: '0.5rem' }}>
                        WhatsApp automation
                      </div>
                      {!leadPhone && (
                        <p style={{ fontSize: '0.8rem', color: '#b45309', marginBottom: '0.5rem' }}>
                          Add a phone number above to enable WhatsApp sends.
                        </p>
                      )}
                      <div className="stack" style={{ gap: '0.4rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={sendCatalog} onChange={(e) => setSendCatalog(e.target.checked)} disabled={!leadPhone} />
                          Send product catalog via WhatsApp
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={sendQuotation} onChange={(e) => setSendQuotation(e.target.checked)} disabled={!leadPhone} />
                          Send latest quotation via WhatsApp
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Save result */}
                  {logCall.error && <p className="error">{(logCall.error as Error).message}</p>}
                  {logCall.isSuccess && logCall.data && (
                    <div style={{ padding: '0.75rem', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '0.375rem' }}>
                      <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#166534', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <CheckCircle size={15} />
                        Call saved
                      </div>
                      <div className="stack" style={{ gap: '0.25rem', fontSize: '0.85rem' }}>
                        <div><strong>Outcome:</strong> {CALL_STATUS_MAP[logCall.data.outcome]?.label ?? logCall.data.outcome}</div>
                        <div><strong>Attempt #:</strong> {logCall.data.attempt_number}</div>
                        {logCall.data.stage_changed && <div><strong>Stage moved to:</strong> {STAGE_LABELS[logCall.data.lead_stage] ?? logCall.data.lead_stage}</div>}
                        <div><strong>Time:</strong> {new Date(logCall.data.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                        {logCall.data.wa_catalog_sent && <div style={{ color: '#0369a1' }}>📤 Catalog sent via WhatsApp</div>}
                        {logCall.data.wa_quotation_sent && <div style={{ color: '#0369a1' }}>📤 Quotation sent via WhatsApp</div>}
                      </div>
                    </div>
                  )}

                  <button type="submit" className="btn" disabled={logCall.isPending || !leadId}>
                    <PhoneCall size={14} />
                    {logCall.isPending ? 'Saving…' : 'Save Call'}
                  </button>
                </>
              )}
            </form>
          </div>
          )}
        </div>

        {/* Right column: Summary */}
        <div className="stack" style={{ gap: '1.25rem' }}>
          {data && (
            <>
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: '1rem' }}>Call outcome overview</div>
                {data.total_calls > 0 ? (
                  <>
                    <DonutChart
                      segments={Object.entries(byOutcome).map(([k, v], i) => ({
                        label: CALL_STATUS_MAP[k]?.label ?? k,
                        value: v,
                        color: ['#3D7A5A', '#B42318', '#0E7490', '#B07A2E', '#0F766E', '#64748b'][i % 6],
                      }))}
                      center={{ value: data.total_calls, label: 'Calls' }}
                    />
                    <DonutLegend
                      segments={Object.entries(byOutcome).map(([k, v], i) => ({
                        label: CALL_STATUS_MAP[k]?.label ?? k,
                        value: v,
                        color: ['#3D7A5A', '#B42318', '#0E7490', '#B07A2E', '#0F766E', '#64748b'][i % 6],
                      }))}
                      total={data.total_calls}
                    />
                  </>
                ) : (
                  <p className="muted small">
                    {isAll ? 'No calls logged yet.' : isToday ? 'No calls logged today.' : 'No calls logged on this date.'}
                  </p>
                )}
              </div>

              {calls.length > 0 && (
                <div className="card">
                  <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Call Logs</div>
                  <div className="stack" style={{ gap: '0.5rem' }}>
                    {calls.map((c) => {
                      const meta = CALL_STATUS_MAP[c.outcome]
                      return (
                        <div
                          key={c.id}
                          onClick={() => setSelectedCallId(c.id)}
                          className="row spread"
                          style={{ padding: '0.4rem 0', borderBottom: '1px solid #f8fafc', cursor: 'pointer' }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{c.lead_title ?? '—'}</div>
                            <div className="muted small">Logged by {c.logged_by ?? 'AI Auto-Call'}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span className={`badge ${meta?.color ?? 'badge-slate'}`}>{meta?.label ?? c.outcome}</span>
                            <div className="muted small" style={{ marginTop: '0.2rem' }}>
                              {isAll
                                ? new Date(c.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                                : new Date(c.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          {summary.isLoading && <div className="card muted">Loading summary…</div>}
        </div>
        </div>
        <div className="tips-banner">
          <span>Call between 11:00 AM – 1:00 PM and 4:00 PM – 8:00 PM for a better connect rate.</span>
        </div>
      </div>

      <Modal
        open={!!selectedCallId}
        onClose={() => setSelectedCallId(null)}
        title="Call Details"
      >
        {callDetail.isLoading && <p className="muted">Loading…</p>}
        {callDetail.data && (
          <div className="stack" style={{ gap: '0.75rem' }}>
            <div><div className="muted small">Lead</div><div style={{ fontWeight: 600 }}>{callDetail.data.lead_title ?? '—'}</div></div>
            <div><div className="muted small">Logged by</div><div>{callDetail.data.logged_by ?? 'AI Auto-Call'}</div></div>
            <div>
              <div className="muted small">Outcome</div>
              <span className={`badge ${CALL_STATUS_MAP[callDetail.data.outcome]?.color ?? 'badge-slate'}`}>
                {CALL_STATUS_MAP[callDetail.data.outcome]?.label ?? callDetail.data.outcome}
              </span>
            </div>
            <div><div className="muted small">Attempt #</div><div>{callDetail.data.attempt_number}</div></div>
            <div><div className="muted small">Call Source</div><div>{callDetail.data.call_source === 'HUMAN' ? 'Manual / Browser Call' : 'AI Auto-Call'}</div></div>
            <div><div className="muted small">Time</div><div>{new Date(callDetail.data.created_at).toLocaleString('en-IN')}</div></div>
            {callDetail.data.duration_seconds !== null && (
              <div><div className="muted small">Duration</div><div>{Math.floor(callDetail.data.duration_seconds / 60)}m {callDetail.data.duration_seconds % 60}s</div></div>
            )}
            {callDetail.data.notes && (
              <div><div className="muted small">Notes</div><div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{callDetail.data.notes}</div></div>
            )}
            {callDetail.data.transcript_raw && (
              <div>
                <div className="muted small">Transcript</div>
                <div style={{ background: 'var(--secondary)', padding: '0.5rem', borderRadius: 'var(--radius)', fontSize: '0.85rem', maxHeight: '200px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {callDetail.data.transcript_raw}
                </div>
              </div>
            )}
            {callDetail.data.ai_summary && (
              <div><div className="muted small">AI Summary</div><div style={{ fontSize: '0.9rem' }}>{callDetail.data.ai_summary}</div></div>
            )}
            {callDetail.data.recording_url && (
              <div><div className="muted small">Recording</div><audio controls style={{ width: '100%' }} src={callDetail.data.recording_url} /></div>
            )}
            {callDetail.data.next_call_at && (
              <div><div className="muted small">Next Follow-up</div><div>{new Date(callDetail.data.next_call_at).toLocaleDateString('en-IN')}</div></div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
