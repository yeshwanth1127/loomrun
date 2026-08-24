import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Globe, Mail, RefreshCw, Users, Workflow, X, Zap } from 'lucide-react'
import { type ReactElement, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  GoogleIcon,
  GoogleServiceCard,
  WhatsAppConnectorCard,
  type GoogleConnectionItem,
} from '../components/MessagingConnectors'
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

const SOURCE_ICONS: Record<string, ReactElement> = {
  META_ADS:   <MetaIcon />,
  GOOGLE_ADS: <GoogleIcon />,
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
  plan_locked?: boolean
  required_plan?: string | null
  meta_available?: number | null
  sync_note?: string | null
}

const METHOD_LABELS: Record<string, string> = {
  oauth: 'OAuth 2.0',
  api_key: 'API Key + Webhook',
  webhook: 'Webhook / Form POST',
  built_in: 'Built-in',
  provisioned: 'Auto-provisioned',
}

type ProvisionedWorkflow = {
  template: string
  n8n_id: string
  name: string
  webhook_path: string | null
  editor_url: string | null
}

type AutomationItem = {
  service_name: string
  label: string
  method: string
  provider: string
  description: string
  capabilities: string[]
  loomrun_events: string[]
  status: 'connected' | 'disconnected'
  connected_email: string | null
  last_used: string | null
  connection_id: string | null
  organization_slug: string | null
  organization_name: string | null
  suggested_sender_email: string | null
  workflows: ProvisionedWorkflow[]
  needs_gmail_setup: boolean
  automation_ready: boolean
}

function N8nIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="#EA4B71"/>
      <text x="12" y="16" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="800" fontSize="11" fill="#fff">n8</text>
    </svg>
  )
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

// ── n8n Automation Setup Modal ────────────────────────────────────────────────

function N8nSetupModal({ item, orgId, n8nUrl, onClose, onConnected }: {
  item: AutomationItem
  orgId: string
  n8nUrl: string | null
  onClose: () => void
  onConnected: () => void
}) {
  const [senderEmail, setSenderEmail] = useState(
    item.connected_email ?? item.suggested_sender_email ?? '',
  )
  const [error, setError] = useState('')
  const orgLabel = item.organization_name ?? item.organization_slug ?? 'your organization'
  const credName = item.organization_slug
    ? `Gmail — ${item.organization_slug}`
    : 'Gmail — org inbox'

  const provision = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/automation-connections/provision`, {
        method: 'POST',
        json: { sender_email: senderEmail.trim() },
      }),
    onSuccess: () => { onConnected(); onClose() },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <div className="modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div className="row" style={{ gap: '0.5rem' }}>
            <N8nIcon />
            <h2>Provision n8n for {orgLabel}</h2>
          </div>
          <button type="button" className="btn-logout" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body stack" style={{ gap: '0.875rem' }}>
          {!item.automation_ready && (
            <div className="card" style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '0.85rem' }}>
              Automations are not configured on the server yet. Your admin must set <code>N8N_API_URL</code>, <code>N8N_API_KEY</code>, and <code>N8N_WEBHOOK_URL</code> in the environment.
            </div>
          )}

          <p className="muted" style={{ fontSize: '0.875rem', margin: 0 }}>
            Loomrun will clone four n8n workflows for this org. Webhook routing is handled automatically by the server — you only need to connect Gmail in n8n.
          </p>

          <div
            className="card"
            style={{ background: '#f8fafc', padding: '1rem', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.7 }}
          >
            <p style={{ fontWeight: 600, color: '#334155', marginTop: 0 }}>After provisioning</p>
            <p>1. {n8nUrl ? <>Open <a href={n8nUrl} target="_blank" rel="noreferrer">n8n</a></> : 'Open n8n'} — you will see 4 new workflows named <strong>{orgLabel}</strong>.</p>
            <p>2. Create Gmail OAuth credential <strong>{credName}</strong> and sign in as the sender email below.</p>
            <p>3. Attach that credential to every <strong>Gmail</strong> node in each cloned workflow.</p>
            <p style={{ marginBottom: 0 }}>4. Toggle each workflow <strong>Active</strong> after Gmail is connected (workflows stay inactive until then).</p>
          </div>

          <div className="form-field">
            <label className="input-label">Sender Gmail address (this org)</label>
            <input
              className="input"
              type="email"
              placeholder="sales@yourcompany.com"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              style={{ width: '100%' }}
              autoFocus
              disabled={!item.automation_ready}
            />
            <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.35rem', marginBottom: 0 }}>
              Authorize this exact Google account on the Gmail nodes in n8n.
            </p>
          </div>

          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={!senderEmail.trim() || !item.automation_ready || provision.isPending}
            onClick={() => void provision.mutateAsync()}
          >
            {provision.isPending ? 'Cloning workflows…' : 'Clone workflows for this org'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Automation Card ───────────────────────────────────────────────────────────

function AutomationCard({ item, orgId, n8nUrl, onRefresh }: {
  item: AutomationItem
  orgId: string
  n8nUrl: string | null
  onRefresh: () => void
}) {
  const [showModal, setShowModal] = useState(false)

  const disconnect = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/automation-connections/disconnect`, {
        method: 'POST',
        json: { service_name: item.service_name },
      }),
    onSuccess: onRefresh,
  })

  return (
    <>
      <div className="integration-card">
        <div className="integration-card-header">
          <div className="integration-icon">
            <N8nIcon />
          </div>
          <div>
            <div className="integration-name">{item.label}</div>
            <div className="integration-method">{METHOD_LABELS[item.method] ?? item.method}</div>
          </div>
        </div>

        <p className="muted" style={{ fontSize: '0.8rem', margin: 0, lineHeight: 1.5 }}>
          {item.description}
        </p>

        <div className="integration-meta">
          {item.connected_email && (
            <span>
              <Mail size={12} /> Sends from {item.connected_email}
            </span>
          )}
          {item.last_used && (
            <span>
              Last event: {new Date(item.last_used).toLocaleDateString('en-IN')}
            </span>
          )}
          {item.organization_slug && (
            <span>Org: {item.organization_slug}</span>
          )}
        </div>

        {item.workflows.length > 0 && (
          <div className="form-field">
            <label className="input-label" style={{ marginBottom: '0.35rem' }}>Cloned workflows ({item.workflows.length})</label>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', lineHeight: 1.6 }}>
              {item.workflows.map((wf) => (
                <li key={wf.n8n_id}>
                  {wf.editor_url ? (
                    <a href={wf.editor_url} target="_blank" rel="noreferrer">{wf.name}</a>
                  ) : (
                    wf.name
                  )}
                </li>
              ))}
            </ul>
            {item.needs_gmail_setup && (
              <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem', marginBottom: 0 }}>
                Open each workflow in n8n and attach your org Gmail credential to all Gmail nodes.
              </p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
          {item.capabilities.map((cap) => (
            <span
              key={cap}
              style={{
                fontSize: '0.68rem',
                fontWeight: 600,
                background: '#eef2ff',
                color: '#4338ca',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
              }}
            >
              {cap}
            </span>
          ))}
        </div>

        <div className="integration-card-footer">
          <span className={`status-pill ${item.status}`}>
            {item.status === 'connected' ? 'Connected' : 'Not Connected'}
          </span>
          <div className="row" style={{ gap: '0.5rem' }}>
            {n8nUrl && (
              <a href={n8nUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                Open n8n
              </a>
            )}
            {item.status === 'connected' ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowModal(true)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={disconnect.isPending}
                  onClick={() => void disconnect.mutateAsync()}
                >
                  {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </>
            ) : item.workflows.length === 0 ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowModal(true)}
              >
                Clone workflows
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {showModal && (
        <N8nSetupModal
          item={item}
          orgId={orgId}
          n8nUrl={n8nUrl}
          onClose={() => setShowModal(false)}
          onConnected={onRefresh}
        />
      )}
    </>
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
    mutationFn: () =>
      apiFetch<{
        status: string
        created?: number
        skipped?: number
        meta_available?: number
        total_meta?: number
        retention_note?: string
      }>(`/v1/orgs/${orgId}/meta/sync`, { method: 'POST' }),
    onSuccess: (res) => {
      onRefresh()
      const created = res.created ?? 0
      const available = res.meta_available
      const total = res.total_meta
      if (created > 0) {
        toast.success(`Imported ${created} new Meta lead${created === 1 ? '' : 's'}${total != null ? ` · ${total} total in Loomrun` : ''}`)
      } else {
        toast.success(
          available != null
            ? `Already up to date · Meta currently exposes ${available} Instant Form leads · ${total ?? conn.leads_count} in Loomrun`
            : 'Already up to date',
        )
      }
      if (available != null && total != null && total < 900) {
        toast.message(
          'Ads Manager lifetime lead totals can look higher (~1000+) because Meta only lets apps download Instant Form details for about 90 days.',
        )
      }
    },
    onError: (err) => toast.error((err as Error).message || 'Meta sync failed'),
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
            <Zap size={12} /> {conn.leads_count} lead{conn.leads_count !== 1 ? 's' : ''} in Loomrun
          </span>
          {conn.source_name === 'META_ADS' && conn.meta_available != null && (
            <span>Meta downloadable now: {conn.meta_available}</span>
          )}
          {conn.last_sync && (
            <span>
              Last sync: {new Date(conn.last_sync).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>

          {conn.source_name === 'META_ADS' && conn.status === 'connected' && (
            <p className="muted small" style={{ margin: '0.5rem 0 0' }}>
              {conn.sync_note
                ?? 'Meta Ads Manager lifetime “leads” can be higher than Instant Form downloads. Meta only shares lead details for about 90 days; Loomrun keeps everything it has already synced plus new webhook leads.'}
            </p>
          )}

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
                title="Pulls every Instant Form lead Meta still exposes (~90 days), dedupes against what you already have. New leads also arrive via webhook; poll runs every 10 minutes."
              >
                <RefreshCw size={14} style={{ marginRight: 4 }} />
                {syncMeta.isPending ? 'Syncing…' : 'Sync now'}
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
    const google = searchParams.get('google')
    const service = searchParams.get('service')

    if (meta) {
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
      void qc.invalidateQueries({ queryKey: ['lead-connections', orgId] })
    }

    if (google) {
      const label = service === 'GMAIL' ? 'Gmail' : service === 'GOOGLE_CALENDAR' ? 'Google Calendar' : 'Google'
      if (google === 'success') {
        setBanner({ type: 'success', message: `${label} connected successfully.` })
      } else {
        setBanner({ type: 'error', message: `${label} connection failed. Please try again.` })
      }
      void qc.invalidateQueries({ queryKey: ['google-connections', orgId] })
    }

    if (meta || google) setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams, qc, orgId])

  const q = useQuery({
    queryKey: ['lead-connections', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: ConnectionItem[] }>(`/v1/orgs/${orgId}/lead-connections`),
  })

  const automationsQ = useQuery({
    queryKey: ['automation-connections', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: AutomationItem[]; n8n_url: string | null }>(
      `/v1/orgs/${orgId}/automation-connections`,
    ),
  })

  const googleQ = useQuery({
    queryKey: ['google-connections', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: GoogleConnectionItem[]; google_configured: boolean }>(
      `/v1/orgs/${orgId}/google/connections`,
    ),
  })

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['lead-connections', orgId] })
  }

  function refreshAutomations() {
    void qc.invalidateQueries({ queryKey: ['automation-connections', orgId] })
  }

  function refreshGoogle() {
    void qc.invalidateQueries({ queryKey: ['google-connections', orgId] })
  }

  if (!orgId) return (
    <><div className="page-header"><h1>Integrations</h1></div></>
  )

  const items = q.data?.items ?? []
  const automations = automationsQ.data?.items ?? []
  const n8nUrl = automationsQ.data?.n8n_url ?? null
  const automationItem: AutomationItem | undefined = automations[0]
    ? { ...automations[0], workflows: automations[0].workflows ?? [] }
    : undefined
  const automationsForRender = automationItem ? [automationItem] : []
  const googleItems = googleQ.data?.items ?? []
  const googleConfigured = googleQ.data?.google_configured ?? false
  const connectedCount = items.filter((c) => c.status === 'connected').length
  const automationsConnectedCount = automationsForRender.filter((c) => c.status === 'connected').length
  const googleConnectedCount = googleItems.filter((c) => c.status === 'connected').length

  return (
    <>
      <div className="page-header">
        <h1>Integrations</h1>
        <p>
          {connectedCount} lead source{connectedCount !== 1 ? 's' : ''} · {googleConnectedCount} Google service{googleConnectedCount !== 1 ? 's' : ''} connected
        </p>
      </div>

      <div className="page-body stack" style={{ gap: '2rem' }}>
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

        <section className="stack" style={{ gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Lead Sources</h2>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem', marginBottom: 0 }}>
              Connect ad platforms and channels to capture leads into your pipeline.
            </p>
          </div>

          <div className="card" style={{ padding: '1rem 1.25rem' }}>
            <div className="row" style={{ gap: '0.5rem' }}>
              <Zap size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.875rem', color: 'var(--muted-fg)' }}>
                All connected sources feed into a single pipeline. Duplicate leads (same phone or email) are automatically merged — the new inquiry is logged as an activity.
              </span>
            </div>
          </div>

          {q.isLoading && <p className="muted">Loading lead integrations…</p>}
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
        </section>

        <section className="stack" style={{ gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Messaging</h2>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem', marginBottom: 0 }}>
              Link the WhatsApp number your workspace sends messages, quotations, and invoices from.
            </p>
          </div>

          <div className="integration-grid">
            <WhatsAppConnectorCard orgId={orgId} />
          </div>
        </section>

        <section className="stack" style={{ gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Google Services</h2>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem', marginBottom: 0 }}>
              Connect Gmail and Google Calendar to send emails and schedule meetings directly from Loomrun.
            </p>
          </div>

          {!googleConfigured && !googleQ.isLoading && (
            <div className="card" style={{ padding: '1rem 1.25rem', background: '#fef2f2', border: '1px solid #fecaca', boxShadow: 'none' }}>
              <div className="row" style={{ gap: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem', color: '#991b1b' }}>
                  Google OAuth is not configured. Your admin must set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in the server environment.
                </span>
              </div>
            </div>
          )}

          {googleQ.isLoading && <p className="muted">Loading Google services…</p>}
          {googleQ.error && <p className="error">{(googleQ.error as Error).message}</p>}

          {googleConfigured && (
            <div className="integration-grid">
              {googleItems.map((item) => (
                <GoogleServiceCard
                  key={item.service_name}
                  item={item}
                  orgId={orgId}
                  onRefresh={refreshGoogle}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
