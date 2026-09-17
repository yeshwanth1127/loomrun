import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader, Phone, PhoneCall, Zap } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'


type Provider = {
  provider_name: string
  label: string
  provider_type: string
  cost_per_min: number
  docs_url: string
  status: 'connected' | 'disconnected'
  is_active: boolean
  provisioned: boolean
  phone_number: string | null
}

type UsageData = {
  month: string
  total_calls: number
  total_duration_minutes: number
  total_billed_cost: number
  by_provider: Record<string, { calls: number; duration_seconds: number; billed_cost: number }>
}

const MANAGED_PROVIDERS = ['TWILIO', 'VAPI']

export function TelephonyPage() {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const [provisionTarget, setProvisionTarget] = useState<string | null>(null)

  const providersQ = useQuery({
    queryKey: ['telephony-providers', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ providers: Provider[] }>(`/v1/orgs/${orgId}/telephony/providers`),
  })

  const usageQ = useQuery({
    queryKey: ['telephony-usage', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<UsageData>(`/v1/orgs/${orgId}/telephony/usage`),
  })

  const provision = useMutation({
    mutationFn: (provider: string) =>
      apiFetch(`/v1/orgs/${orgId}/telephony/provision`, {
        method: 'POST',
        json: { provider },
      }),
    onSuccess: () => {
      setProvisionTarget(null)
      void qc.invalidateQueries({ queryKey: ['telephony-providers', orgId] })
      void qc.invalidateQueries({ queryKey: ['telephony-usage', orgId] })
    },
  })


  if (!orgId) {
    return <PageHeader title="Telephony" description="Select an organization." />
  }

  const providers = providersQ.data?.providers ?? []
  const twilio = providers.find((p) => p.provider_name === 'TWILIO')
  const vapi = providers.find((p) => p.provider_name === 'VAPI')
  const usage = usageQ.data

  const isProvisioned = (p?: Provider) => p?.provisioned && p.status === 'connected'

  return (
    <>
      <PageHeader
        title="Telephony"
        description="Platform-managed voice calling and AI auto-calls"
      />

      <div className="page-body stack" style={{ gap: '1.5rem' }}>

        {/* Status cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>

          {/* Twilio */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <Phone size={20} style={{ color: 'var(--primary)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>Browser Calls</div>
                <div className="muted small">Twilio · Human dialer</div>
              </div>
              {isProvisioned(twilio) ? (
                <span className="badge badge-green">Active</span>
              ) : (
                <span className="badge badge-slate">Not provisioned</span>
              )}
            </div>

            {isProvisioned(twilio) ? (
              <div className="stack" style={{ gap: '0.5rem' }}>
                <div className="row spread">
                  <span className="muted small">Phone number</span>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{twilio?.phone_number ?? '—'}</span>
                </div>
                <div className="row spread">
                  <span className="muted small">Provider</span>
                  <span style={{ fontSize: '0.85rem' }}>Twilio subaccount</span>
                </div>
              </div>
            ) : (
              <div>
                <p className="muted small" style={{ marginBottom: '0.75rem' }}>
                  Provision to get a dedicated phone number for browser-based calls.
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={provision.isPending && provisionTarget === 'TWILIO'}
                  onClick={() => { setProvisionTarget('TWILIO'); void provision.mutateAsync('TWILIO') }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  {provision.isPending && provisionTarget === 'TWILIO' ? (
                    <><Loader size={13} className="spin" /> Provisioning…</>
                  ) : 'Provision Twilio'}
                </button>
                {provision.isError && provisionTarget === 'TWILIO' && (
                  <p className="error" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    {(provision.error as Error).message}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* VAPI */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <Zap size={20} style={{ color: '#8b5cf6' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>AI Auto-Calls</div>
                <div className="muted small">VAPI · AI voice agent</div>
              </div>
              {isProvisioned(vapi) ? (
                <span className="badge badge-green">Active</span>
              ) : (
                <span className="badge badge-slate">Not provisioned</span>
              )}
            </div>

            {isProvisioned(vapi) ? (
              <div className="stack" style={{ gap: '0.5rem' }}>
                <div className="row spread">
                  <span className="muted small">Outbound number</span>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{vapi?.phone_number ?? '—'}</span>
                </div>
                <div className="row spread">
                  <span className="muted small">Provider</span>
                  <span style={{ fontSize: '0.85rem' }}>VAPI assistant</span>
                </div>
              </div>
            ) : (
              <div>
                <p className="muted small" style={{ marginBottom: '0.75rem' }}>
                  Requires Twilio to be provisioned first. Provisions an AI voice assistant using your Twilio number.
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={(provision.isPending && provisionTarget === 'VAPI') || !isProvisioned(twilio)}
                  onClick={() => { setProvisionTarget('VAPI'); void provision.mutateAsync('VAPI') }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  {provision.isPending && provisionTarget === 'VAPI' ? (
                    <><Loader size={13} className="spin" /> Provisioning…</>
                  ) : 'Provision VAPI'}
                </button>
                {!isProvisioned(twilio) && (
                  <p className="muted small" style={{ marginTop: '0.4rem' }}>Provision Twilio first.</p>
                )}
                {provision.isError && provisionTarget === 'VAPI' && (
                  <p className="error" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    {(provision.error as Error).message}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Exotel — platform-managed, provisioned from master .env credentials */}
          {(() => {
            const exotel = providers.find((p) => p.provider_name === 'EXOTEL')
            const provisioned = exotel?.provisioned && exotel.status === 'connected'
            return (
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <PhoneCall size={20} style={{ color: '#0ea5e9' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>Exotel · Click-to-Call</div>
                    <div className="muted small">Indian numbers · Platform managed</div>
                  </div>
                  {provisioned
                    ? <span className="badge badge-green">Active</span>
                    : <span className="badge badge-slate">Not provisioned</span>}
                </div>

                {provisioned ? (
                  <div className="stack" style={{ gap: '0.5rem' }}>
                    <div className="row spread">
                      <span className="muted small">ExoPhone number</span>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{exotel?.phone_number ?? '—'}</span>
                    </div>
                    <div className="row spread">
                      <span className="muted small">Mode</span>
                      <span style={{ fontSize: '0.85rem' }}>Server-side click-to-call</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="muted small" style={{ marginBottom: '0.75rem' }}>
                      Enable Exotel click-to-call for this org. Uses the platform Exotel account — no credentials needed from users.
                    </p>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={provision.isPending && provisionTarget === 'EXOTEL'}
                      onClick={() => { setProvisionTarget('EXOTEL'); void provision.mutateAsync('EXOTEL') }}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      {provision.isPending && provisionTarget === 'EXOTEL'
                        ? <><Loader size={13} className="spin" /> Provisioning…</>
                        : 'Provision Exotel'}
                    </button>
                    {provision.isError && provisionTarget === 'EXOTEL' && (
                      <p className="error" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                        {(provision.error as Error).message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Provision Both */}
          {!isProvisioned(twilio) && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', textAlign: 'center', background: '#fafafa', border: '2px dashed #e2e8f0' }}>
              <div style={{ fontWeight: 700 }}>Provision Everything</div>
              <p className="muted small">Set up Twilio + VAPI in one click.</p>
              <button
                type="button"
                className="btn"
                disabled={provision.isPending && provisionTarget === 'all'}
                onClick={() => { setProvisionTarget('all'); void provision.mutateAsync('all') }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                {provision.isPending && provisionTarget === 'all' ? (
                  <><Loader size={14} className="spin" /> Provisioning…</>
                ) : 'Provision All'}
              </button>
            </div>
          )}
        </div>

        {/* Usage */}
        {(isProvisioned(twilio) || isProvisioned(vapi)) && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '1rem' }}>
              Usage — {usage?.month ?? '…'}
            </div>
            {usageQ.isLoading ? (
              <p className="muted small">Loading…</p>
            ) : usage ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a' }}>{usage.total_calls}</div>
                  <div className="muted small">total calls</div>
                </div>
                <div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a' }}>{usage.total_duration_minutes.toFixed(1)}</div>
                  <div className="muted small">minutes</div>
                </div>
                <div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a' }}>₹{(usage.total_billed_cost * 83).toFixed(0)}</div>
                  <div className="muted small">billed this month</div>
                </div>
                {Object.entries(usage.by_provider).map(([prov, stats]) => (
                  <div key={prov} style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>{prov}</div>
                    <div className="muted small">{stats.calls} calls · {Math.round(stats.duration_seconds / 60)} min</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">No calls this month.</p>
            )}
          </div>
        )}

        {/* Other providers note */}
        <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#64748b' }}>
          Other providers (Plivo, Exotel, Telnyx, Vonage, Retell, Bland) are available for BYO configuration — contact support.
        </div>

      </div>
    </>
  )
}
