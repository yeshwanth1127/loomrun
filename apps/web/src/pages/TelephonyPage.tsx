import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Copy, Check, Loader } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type Provider = {
  provider_name: string
  label: string
  provider_type: string
  credential_fields: string[]
  cost_per_min: number
  docs_url: string
  status: 'connected' | 'disconnected'
  is_active: boolean
}

const PROVIDER_ICONS: Record<string, string> = {
  TWILIO: '📞',
  PLIVO: '📱',
  EXOTEL: '🇮🇳',
  TELNYX: '📡',
  VONAGE: '🔊',
  VAPI: '🤖',
  RETELL: '🎙️',
  BLAND: '💬',
}

export function TelephonyPage() {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)

  const q = useQuery({
    queryKey: ['telephony-providers', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ providers: Provider[] }>(`/v1/orgs/${orgId}/telephony/providers`),
  })

  const connectProvider = useMutation({
    mutationFn: (p: Provider) =>
      apiFetch(`/v1/orgs/${orgId}/telephony/providers/connect`, {
        method: 'POST',
        json: {
          provider_name: p.provider_name,
          credentials: credentialValues,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['telephony-providers', orgId] })
      setSelectedProvider(null)
      setCredentialValues({})
    },
  })

  const setActive = useMutation({
    mutationFn: (provider_name: string) =>
      apiFetch(`/v1/orgs/${orgId}/telephony/providers/set-active`, {
        method: 'POST',
        json: { provider_name },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['telephony-providers', orgId] }),
  })

  const disconnect = useMutation({
    mutationFn: (provider_name: string) =>
      apiFetch(`/v1/orgs/${orgId}/telephony/providers/disconnect`, {
        method: 'POST',
        json: { provider_name },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['telephony-providers', orgId] }),
  })

  if (!orgId) return <div className="page-header"><h1>Telephony</h1><p className="muted">Select an organization.</p></div>

  const providers = q.data?.providers ?? []
  const voiceProviders = providers.filter((p) => p.provider_type === 'VOICE')
  const aiProviders = providers.filter((p) => p.provider_type === 'AI_CALL')

  function ProviderCard({ provider }: { provider: Provider }) {
    const isActive = provider.is_active
    const isConnected = provider.status === 'connected'

    return (
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>{PROVIDER_ICONS[provider.provider_name] || '🔌'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>{provider.label}</div>
            <div className="muted small" style={{ marginTop: '0.2rem' }}>
              ${provider.cost_per_min.toFixed(3)}/min
            </div>
          </div>
          {isActive && <span className="badge badge-green">Active</span>}
        </div>

        {isConnected ? (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={isActive || setActive.isPending}
              onClick={() => setActive.mutate(provider.provider_name)}
            >
              {setActive.isPending ? '...' : 'Set as Active'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate(provider.provider_name)}
            >
              {disconnect.isPending ? '...' : 'Disconnect'}
            </button>
            <a href={provider.docs_url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
              Docs <ChevronRight size={12} />
            </a>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setSelectedProvider(provider)
                setCredentialValues({})
              }}
            >
              Configure
            </button>
            <a href={provider.docs_url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
              Docs <ChevronRight size={12} />
            </a>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1>Telephony Settings</h1>
        <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>Configure voice and AI call providers</p>
      </div>

      <div className="page-body stack" style={{ gap: '2rem' }}>
        {/* Voice Providers Section */}
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Voice Provider (Human Calls)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {voiceProviders.map((p) => (
              <ProviderCard key={p.provider_name} provider={p} />
            ))}
          </div>
        </div>

        {/* AI Providers Section */}
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>AI Call Provider (Auto Fallback)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {aiProviders.map((p) => (
              <ProviderCard key={p.provider_name} provider={p} />
            ))}
          </div>
        </div>
      </div>

      {/* Credential Modal */}
      {selectedProvider && (
        <div className="modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) setSelectedProvider(null) }}>
          <div className="modal">
            <div className="modal-header">
              <h2>Configure {selectedProvider.label}</h2>
              <button
                type="button"
                className="btn-logout"
                onClick={() => setSelectedProvider(null)}
              >
                ✕
              </button>
            </div>
            <form
              className="modal-body stack"
              onSubmit={(e) => {
                e.preventDefault()
                connectProvider.mutate(selectedProvider)
              }}
            >
              <p className="muted small">Enter your {selectedProvider.label} credentials below.</p>
              {selectedProvider.credential_fields.map((field) => (
                <div key={field} className="form-field">
                  <label className="input-label">{field.replace(/_/g, ' ').toUpperCase()}</label>
                  <input
                    className="input"
                    type={field.includes('token') || field.includes('key') || field.includes('secret') ? 'password' : 'text'}
                    placeholder={`Enter ${field}`}
                    value={credentialValues[field] ?? ''}
                    onChange={(e) => setCredentialValues((v) => ({ ...v, [field]: e.target.value }))}
                    required
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
              <a href={selectedProvider.docs_url} target="_blank" rel="noreferrer" className="small muted">
                Where do I find these? →
              </a>
            </form>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSelectedProvider(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={connectProvider.isPending || Object.keys(credentialValues).length === 0}
                onClick={() => connectProvider.mutate(selectedProvider)}
              >
                {connectProvider.isPending ? 'Saving...' : 'Save Credentials'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
