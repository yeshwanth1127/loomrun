import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Globe, RefreshCw, Users, X, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

const apiPublicBase = import.meta.env.VITE_API_PUBLIC_URL ?? import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// ── Brand Icons ───────────────────────────────────────────────────────────────

function MetaIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.04C6.5 2.04 2 6.53 2 12.06C2 17.06 5.66 21.21 10.44 21.96V14.96H7.9V12.06H10.44V9.85C10.44 7.34 11.93 5.96 14.22 5.96C15.31 5.96 16.45 6.15 16.45 6.15V8.62H15.19C13.95 8.62 13.56 9.39 13.56 10.18V12.06H16.34L15.89 14.96H13.56V21.96C18.34 21.21 22 17.06 22 12.06C22 6.53 17.5 2.04 12 2.04Z" fill="#1877F2"/>
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#25D366" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

function IndiaMARTIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#F47B20"/>
      <text x="3.5" y="16.5" fontFamily="Arial, sans-serif" fontWeight="800" fontSize="10" fill="#fff">IM</text>
    </svg>
  )
}

const SOURCE_ICONS: Record<string, JSX.Element> = {
  META_ADS:   <MetaIcon />,
  GOOGLE_ADS: <GoogleIcon />,
  INDIAMART:  <IndiaMARTIcon />,
  WHATSAPP:   <WhatsAppIcon />,
  WEBSITE:    <Globe size={22} color="#3b82f6" />,
  MANUAL:     <Users size={22} color="#8b5cf6" />,
}

type ConnectionItem = {
  source_name: string
  label: string
  method: string
  status: 'connected' | 'disconnected'
  leads_count: number
  last_sync: string | null
  webhook_url: string | null
  connection_id: string | null
}

const METHOD_LABELS: Record<string, string> = {
  oauth: 'OAuth 2.0',
  api_key: 'API Key + Webhook',
  webhook: 'Webhook / Form POST',
  built_in: 'Built-in',
}

// ── API Key Modal ─────────────────────────────────────────────────────────────

function ApiKeyModal({ conn, orgId, onClose, onConnected }: {
  conn: ConnectionItem
  orgId: string
  onClose: () => void
  onConnected: () => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')

  const connect = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/lead-connections/connect`, {
        method: 'POST',
        json: { source_name: conn.source_name, api_key: apiKey },
      }),
    onSuccess: () => { onConnected(); onClose() },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <div className="modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="row" style={{ gap: '0.5rem' }}>
            {SOURCE_ICONS[conn.source_name]}
            <h2>Connect {conn.label}</h2>
          </div>
          <button type="button" className="btn-logout" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body stack" style={{ gap: '0.75rem' }}>
          <p className="muted" style={{ fontSize: '0.875rem' }}>
            Enter your {conn.label} API key to start receiving leads.
          </p>
          <div className="form-field">
            <label className="input-label">API Key</label>
            <input
              className="input"
              type="password"
              placeholder="Paste your API key here"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ width: '100%' }}
              autoFocus
            />
          </div>
          {conn.webhook_url && (
            <div className="form-field">
              <label className="input-label">Your Webhook URL (copy to {conn.label} dashboard)</label>
              <WebhookUrlRow url={conn.webhook_url} />
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={!apiKey.trim() || connect.isPending}
            onClick={() => void connect.mutateAsync()}
          >
            {connect.isPending ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── OAuth Mock Modal ──────────────────────────────────────────────────────────

function OAuthModal({ conn, orgId, onClose, onConnected }: {
  conn: ConnectionItem
  orgId: string
  onClose: () => void
  onConnected: () => void
}) {
  const [error, setError] = useState('')

  const connect = useMutation({
    mutationFn: async () => {
      if (conn.source_name === 'META_ADS') {
        const returnUrl = `${window.location.origin}/app/leads/connections`
        const params = new URLSearchParams({
          base_url: apiPublicBase,
          return_url: returnUrl,
        })
        const data = await apiFetch<{ url: string }>(
          `/v1/orgs/${orgId}/meta/oauth-url?${params.toString()}`,
        )
        window.location.href = data.url
        return
      }
      await apiFetch(`/v1/orgs/${orgId}/lead-connections/connect`, {
        method: 'POST',
        json: { source_name: conn.source_name, access_token: 'oauth_mock_token' },
      })
    },
    onSuccess: () => { onConnected(); onClose() },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <div className="modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="row" style={{ gap: '0.5rem' }}>
            {SOURCE_ICONS[conn.source_name]}
            <h2>Connect {conn.label}</h2>
          </div>
          <button type="button" className="btn-logout" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body stack" style={{ gap: '0.75rem' }}>
          <p className="muted" style={{ fontSize: '0.875rem' }}>
            You'll be redirected to {conn.label} to authorise access to your Lead Ads.
          </p>
          <div
            className="card"
            style={{ background: '#f8fafc', padding: '1rem', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}
          >
            <p>✅ Read Lead Ad forms</p>
            <p>✅ Receive new lead notifications</p>
            <p>❌ Post or edit ads</p>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={connect.isPending}
            onClick={() => void connect.mutateAsync()}
          >
            {connect.isPending ? 'Authorising…' : `Authorise with ${conn.label}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Webhook URL row with copy ─────────────────────────────────────────────────

function WebhookUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  function doCopy() {
    void navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="webhook-url-row">
      <span>{url}</span>
      <button type="button" className="copy-btn" onClick={doCopy} title="Copy">
        {copied ? <Check size={13} style={{ color: '#10b981' }} /> : <Copy size={13} />}
      </button>
    </div>
  )
}

// ── Connection Card ───────────────────────────────────────────────────────────

function ConnectionCard({ conn, orgId, onRefresh }: {
  conn: ConnectionItem
  orgId: string
  onRefresh: () => void
}) {
  const [showModal, setShowModal] = useState(false)

  const syncMeta = useMutation({
    mutationFn: () => apiFetch<{ status: string }>(`/v1/orgs/${orgId}/meta/sync`, { method: 'POST' }),
    onSuccess: onRefresh,
  })

  const disconnect = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/lead-connections/disconnect`, {
        method: 'POST',
        json: { source_name: conn.source_name },
      }),
    onSuccess: onRefresh,
  })

  const connectManual = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/lead-connections/connect`, {
        method: 'POST',
        json: { source_name: conn.source_name },
      }),
    onSuccess: onRefresh,
  })

  function handleConnect() {
    if (conn.method === 'built_in') {
      void connectManual.mutateAsync()
    } else {
      setShowModal(true)
    }
  }

  return (
    <>
      <div className="integration-card">
        <div className="integration-card-header">
          <div className="integration-icon">
            {SOURCE_ICONS[conn.source_name] ?? <Globe size={22} />}
          </div>
          <div>
            <div className="integration-name">{conn.label}</div>
            <div className="integration-method">{METHOD_LABELS[conn.method] ?? conn.method}</div>
          </div>
        </div>

        <div className="integration-meta">
          <span>
            <Zap size={12} /> {conn.leads_count} lead{conn.leads_count !== 1 ? 's' : ''}
          </span>
          {conn.last_sync && (
            <span>
              Last sync: {new Date(conn.last_sync).toLocaleDateString('en-IN')}
            </span>
          )}
        </div>

          {conn.source_name === 'META_ADS' && conn.webhook_url && (
            <div className="form-field">
              <label className="input-label" style={{ marginBottom: '0.25rem' }}>
                Webhook URL (paste into Meta Developer Console)
              </label>
              <WebhookUrlRow url={conn.webhook_url} />
            </div>
          )}

          {conn.status === 'connected' && conn.webhook_url && conn.source_name !== 'META_ADS' && (
          <div className="form-field">
            <label className="input-label" style={{ marginBottom: '0.25rem' }}>Webhook URL</label>
            <WebhookUrlRow url={conn.webhook_url} />
          </div>
        )}

        <div className="integration-card-footer">
          <span className={`status-pill ${conn.status}`}>
            {conn.status === 'connected' ? 'Connected' : 'Not Connected'}
          </span>
          <div className="row" style={{ gap: '0.5rem' }}>
            {conn.status === 'connected' && conn.source_name === 'META_ADS' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={syncMeta.isPending}
                onClick={() => void syncMeta.mutateAsync()}
                title="Import existing leads from Meta Lead Ad forms"
              >
                <RefreshCw size={14} style={{ marginRight: 4 }} />
                {syncMeta.isPending ? 'Syncing…' : 'Sync leads'}
              </button>
            )}
            {conn.status === 'connected' ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disconnect.isPending}
                onClick={() => void disconnect.mutateAsync()}
              >
                {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm"
                disabled={connectManual.isPending}
                onClick={handleConnect}
              >
                {connectManual.isPending ? 'Connecting…' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      </div>

      {showModal && conn.method === 'oauth' && (
        <OAuthModal
          conn={conn}
          orgId={orgId}
          onClose={() => setShowModal(false)}
          onConnected={onRefresh}
        />
      )}
      {showModal && conn.method === 'api_key' && (
        <ApiKeyModal
          conn={conn}
          orgId={orgId}
          onClose={() => setShowModal(false)}
          onConnected={onRefresh}
        />
      )}
      {showModal && conn.method === 'webhook' && (
        <ApiKeyModal
          conn={conn}
          orgId={orgId}
          onClose={() => setShowModal(false)}
          onConnected={onRefresh}
        />
      )}
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function LeadConnectionsPage() {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    const meta = searchParams.get('meta')
    if (!meta) return
    if (meta === 'success') {
      const pages = searchParams.get('pages')
      setBanner({
        type: 'success',
        message: pages
          ? `Meta Ads connected — ${pages} Facebook Page${pages === '1' ? '' : 's'} linked.`
          : 'Meta Ads connected successfully.',
      })
    } else if (meta === 'error') {
      setBanner({ type: 'error', message: 'Meta authorisation failed. Please try again.' })
    }
    setSearchParams({}, { replace: true })
    void qc.invalidateQueries({ queryKey: ['lead-connections', orgId] })
  }, [searchParams, setSearchParams, qc, orgId])

  const q = useQuery({
    queryKey: ['lead-connections', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: ConnectionItem[] }>(`/v1/orgs/${orgId}/lead-connections`),
  })

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['lead-connections', orgId] })
  }

  if (!orgId) return (
    <><div className="page-header"><h1>Lead Integrations</h1></div></>
  )

  const items = q.data?.items ?? []
  const connectedCount = items.filter((c) => c.status === 'connected').length

  return (
    <>
      <div className="page-header">
        <h1>Lead Integrations</h1>
        <p>
          {connectedCount} of {items.length} source{items.length !== 1 ? 's' : ''} connected · Manage how leads flow into Loomrun
        </p>
      </div>

      <div className="page-body stack" style={{ gap: '1.5rem' }}>
        <div className="card" style={{ padding: '1rem 1.25rem', background: '#eef2ff', border: '1px solid #c7d2fe', boxShadow: 'none' }}>
          <div className="row" style={{ gap: '0.5rem' }}>
            <Zap size={16} style={{ color: '#4f46e5', flexShrink: 0 }} />
            <span style={{ fontSize: '0.875rem', color: '#3730a3' }}>
              All connected sources feed into a single pipeline. Duplicate leads (same phone or email) are automatically merged — the new inquiry is logged as an activity.
            </span>
          </div>
        </div>

        {banner && (
          <div
            className="card"
            style={{
              padding: '0.75rem 1rem',
              background: banner.type === 'success' ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${banner.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
              boxShadow: 'none',
              color: banner.type === 'success' ? '#065f46' : '#991b1b',
              fontSize: '0.875rem',
            }}
          >
            {banner.message}
          </div>
        )}

        {q.isLoading && <p className="muted">Loading integrations…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        <div className="integration-grid">
          {items.map((conn) => (
            <ConnectionCard
              key={conn.source_name}
              conn={conn}
              orgId={orgId}
              onRefresh={refresh}
            />
          ))}
        </div>
      </div>
    </>
  )
}
