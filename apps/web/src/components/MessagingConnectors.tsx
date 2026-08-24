import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, MessageCircle, QrCode, RefreshCw } from 'lucide-react'
import { type ReactElement, useState } from 'react'
import { apiFetch } from '../lib/api'

export type GoogleConnectionItem = {
  service_name: string
  label: string
  description: string
  status: 'connected' | 'disconnected'
  connected_email: string | null
}

export function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function GmailIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.364l-6.545-4.636v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.273l6.545-4.636 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/>
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 3h-1V1h-2v2H8V1H6v2H5C3.9 3 3 3.9 3 5v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" fill="#4285F4"/>
      <path d="M9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z" fill="#34A853"/>
    </svg>
  )
}

const GOOGLE_SERVICE_ICONS: Record<string, ReactElement> = {
  GMAIL: <GmailIcon />,
  GOOGLE_CALENDAR: <CalendarIcon />,
}

type WhatsAppStatus = {
  connected: boolean
  qr: string | null
  phone_number: string | null
  status: string
  error?: string | null
  last_connected_at: string | null
}

export function GoogleServiceCard({
  item,
  orgId,
  onRefresh,
  returnPath = '/app/leads/connections',
}: {
  item: GoogleConnectionItem
  orgId: string
  onRefresh: () => void
  returnPath?: string
}) {
  const [error, setError] = useState('')

  const connect = useMutation({
    mutationFn: async () => {
      const returnUrl = `${window.location.origin}${returnPath}`
      const params = new URLSearchParams({ service_name: item.service_name, return_url: returnUrl })
      const data = await apiFetch<{ url: string }>(`/v1/orgs/${orgId}/google/oauth-url?${params.toString()}`)
      window.location.href = data.url
    },
    onError: (e) => setError((e as Error).message),
  })

  const disconnect = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/google/connections/disconnect`, {
        method: 'POST',
        json: { service_name: item.service_name },
      }),
    onSuccess: onRefresh,
    onError: (e) => setError((e as Error).message),
  })

  return (
    <div className="integration-card">
      <div className="integration-card-header">
        <div className="integration-icon">
          {GOOGLE_SERVICE_ICONS[item.service_name] ?? <GoogleIcon />}
        </div>
        <div>
          <div className="integration-name">{item.label}</div>
          <div className="integration-method">OAuth 2.0</div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: '0.8rem', margin: 0, lineHeight: 1.5 }}>
        {item.description}
      </p>

      {item.connected_email && (
        <div className="integration-meta">
          <span><Mail size={12} /> {item.connected_email}</span>
        </div>
      )}

      {error && <p className="error" style={{ fontSize: '0.8rem', margin: 0 }}>{error}</p>}

      <div className="integration-card-footer">
        <span className={`status-pill ${item.status}`}>
          {item.status === 'connected' ? 'Connected' : 'Not Connected'}
        </span>
        <div className="row" style={{ gap: '0.5rem' }}>
          {item.status === 'connected' ? (
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
              disabled={connect.isPending}
              onClick={() => void connect.mutateAsync()}
            >
              {connect.isPending ? 'Redirecting…' : `Connect ${item.label}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function WhatsAppConnectorCard({ orgId }: { orgId: string }) {
  const qc = useQueryClient()

  const statusQ = useQuery({
    queryKey: ['connectors-whatsapp', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<WhatsAppStatus>(`/v1/orgs/${orgId}/connectors/whatsapp`),
    refetchInterval: (query) => (query.state.data?.connected ? false : 3000),
  })

  const connect = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/connectors/whatsapp/connect`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['connectors-whatsapp', orgId] }),
  })

  const disconnect = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/connectors/whatsapp/disconnect`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['connectors-whatsapp', orgId] }),
  })

  const s = statusQ.data
  const connected = !!s?.connected

  return (
    <div className="integration-card">
      <div className="integration-card-header">
        <div className="integration-icon">
          <MessageCircle size={22} style={{ color: '#25d366' }} />
        </div>
        <div>
          <div className="integration-name">WhatsApp</div>
          <div className="integration-method">Send from your own number</div>
        </div>
      </div>

      {connected ? (
        <div className="integration-meta">
          {s?.phone_number && <span>Linked number: +{s.phone_number}</span>}
          {s?.last_connected_at && (
            <span>
              Connected since: {new Date(s.last_connected_at).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
      ) : s?.qr ? (
        <div className="stack" style={{ gap: '0.75rem', alignItems: 'center' }}>
          <img
            src={s.qr}
            alt="WhatsApp QR code"
            style={{ width: 220, maxWidth: '100%', borderRadius: 10, border: '1px solid #e2e8f0' }}
          />
          <p className="muted" style={{ fontSize: '0.8rem', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
            Open WhatsApp on your phone → <strong>Settings → Linked devices → Link a device</strong>, then
            scan this code. It refreshes automatically.
          </p>
        </div>
      ) : s?.status === 'connecting' ? (
        <p className="muted" style={{ fontSize: '0.8rem', margin: 0, lineHeight: 1.5 }}>
          <RefreshCw size={14} className="spin" style={{ marginRight: 6, verticalAlign: '-2px' }} />
          Contacting WhatsApp — the QR code will appear here in a moment.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: '0.8rem', margin: 0, lineHeight: 1.5 }}>
          Connect a WhatsApp number to send messages, quotations, and invoices to your leads directly
          from that number.
        </p>
      )}

      {!connected && s?.error && (
        <p className="error" style={{ fontSize: '0.8rem', margin: 0 }}>WhatsApp session error: {s.error}</p>
      )}
      {statusQ.error && <p className="error" style={{ fontSize: '0.8rem', margin: 0 }}>{(statusQ.error as Error).message}</p>}
      {connect.error && <p className="error" style={{ fontSize: '0.8rem', margin: 0 }}>{(connect.error as Error).message}</p>}
      {disconnect.error && <p className="error" style={{ fontSize: '0.8rem', margin: 0 }}>{(disconnect.error as Error).message}</p>}

      <div className="integration-card-footer">
        <span className={`status-pill ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : s?.status === 'connecting' ? 'Waiting for scan…' : 'Not Connected'}
        </span>
        <div className="row" style={{ gap: '0.5rem' }}>
          {connected ? (
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
              disabled={connect.isPending}
              onClick={() => void connect.mutateAsync()}
            >
              {connect.isPending ? (
                <>
                  <RefreshCw size={14} className="spin" style={{ marginRight: 4 }} /> Starting…
                </>
              ) : (
                <>
                  <QrCode size={14} style={{ marginRight: 4 }} /> Connect / Show QR
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function WhatsAppGmailIntegrations({
  orgId,
  returnPath,
  banner,
}: {
  orgId: string
  returnPath: string
  banner?: { type: 'success' | 'error'; message: string } | null
}) {
  const qc = useQueryClient()

  const googleQ = useQuery({
    queryKey: ['google-connections', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: GoogleConnectionItem[]; google_configured: boolean }>(
      `/v1/orgs/${orgId}/google/connections`,
    ),
  })

  const gmailItem = googleQ.data?.items.find((item) => item.service_name === 'GMAIL')
  const googleConfigured = googleQ.data?.google_configured ?? false

  return (
    <div className="stack" style={{ gap: '1.5rem' }}>
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
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>WhatsApp</h2>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem', marginBottom: 0 }}>
            Link the WhatsApp number used to send catalogs, quotations, and follow-ups.
          </p>
        </div>
        <div className="integration-grid">
          <WhatsAppConnectorCard orgId={orgId} />
        </div>
      </section>

      <section className="stack" style={{ gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Gmail</h2>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem', marginBottom: 0 }}>
            Connect Gmail to send emails from Loomrun.
          </p>
        </div>

        {!googleConfigured && !googleQ.isLoading && (
          <div className="card" style={{ padding: '1rem 1.25rem', background: '#fef2f2', border: '1px solid #fecaca', boxShadow: 'none' }}>
            <span style={{ fontSize: '0.875rem', color: '#991b1b' }}>
              Google OAuth is not configured. Ask your admin to set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>.
            </span>
          </div>
        )}

        {googleQ.isLoading && <p className="muted">Loading Gmail…</p>}
        {googleQ.error && <p className="error">{(googleQ.error as Error).message}</p>}

        {googleConfigured && gmailItem && (
          <div className="integration-grid">
            <GoogleServiceCard
              item={gmailItem}
              orgId={orgId}
              returnPath={returnPath}
              onRefresh={() => void qc.invalidateQueries({ queryKey: ['google-connections', orgId] })}
            />
          </div>
        )}
      </section>
    </div>
  )
}
