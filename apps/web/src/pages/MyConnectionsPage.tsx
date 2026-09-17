import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Mail, MessageCircle, Phone, QrCode, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type ConnStatus = {
  status: string
  connected: boolean
  phone_number?: string | null
  connected_email?: string | null
  scope?: string
}

type MyConnections = {
  membership_id: string
  whatsapp_phone: string | null
  whatsapp: ConnStatus
  gmail: ConnStatus
  org_whatsapp: ConnStatus
  org_gmail: ConnStatus
  note: string
}

type WhatsAppLive = {
  connected: boolean
  qr: string | null
  phone_number: string | null
  status: string
  error?: string | null
  last_connected_at?: string | null
}

/**
 * Telecaller personal connections — not org Settings.
 * Each membership has its own WhatsApp Baileys session and Gmail OAuth row.
 */
export function MyConnectionsPage() {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const [phone, setPhone] = useState('')

  const q = useQuery({
    queryKey: ['my-connections', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<MyConnections>(`/v1/orgs/${orgId}/my-connections`),
  })

  const waQ = useQuery({
    queryKey: ['me-whatsapp', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<WhatsAppLive>(`/v1/orgs/${orgId}/me/connectors/whatsapp`),
    refetchInterval: (query) => (query.state.data?.connected ? false : 3000),
  })

  const gmailQ = useQuery({
    queryKey: ['me-gmail', orgId],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{
        items: { service_name: string; status: string; connected_email: string | null }[]
        google_configured: boolean
      }>(`/v1/orgs/${orgId}/me/google/connections`),
  })

  const data = q.data
  const phoneValue = phone || data?.whatsapp_phone || ''
  const gmail = gmailQ.data?.items?.[0]
  const gmailConnected = gmail?.status === 'connected'
  const wa = waQ.data

  const savePhone = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/me`, {
        method: 'PATCH',
        json: { whatsapp_phone: phoneValue || null },
      }),
    onSuccess: () => {
      toast.success('Reminder phone saved')
      void qc.invalidateQueries({ queryKey: ['my-connections', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const waConnect = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/me/connectors/whatsapp/connect`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me-whatsapp', orgId] }),
    onError: (err: Error) => toast.error(err.message),
  })

  const waDisconnect = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/me/connectors/whatsapp/disconnect`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('WhatsApp disconnected')
      void qc.invalidateQueries({ queryKey: ['me-whatsapp', orgId] })
      void qc.invalidateQueries({ queryKey: ['my-connections', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const gmailConnect = useMutation({
    mutationFn: async () => {
      const returnUrl = `${window.location.origin}/app/my-connections`
      const params = new URLSearchParams({
        return_url: returnUrl,
        service_name: 'GMAIL',
      })
      const res = await apiFetch<{ url: string }>(
        `/v1/orgs/${orgId}/me/google/oauth-url?${params.toString()}`,
      )
      window.location.href = res.url
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const gmailDisconnect = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/me/google/connections/disconnect`, {
        method: 'POST',
        json: { service_name: 'GMAIL' },
      }),
    onSuccess: () => {
      toast.success('Gmail disconnected')
      void qc.invalidateQueries({ queryKey: ['me-gmail', orgId] })
      void qc.invalidateQueries({ queryKey: ['my-connections', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <>
      <PageHeader
        title="My Connections"
        description="Connect your own WhatsApp and Gmail for calling and follow-ups. These are separate from the CEO’s organization connectors."
      />
      <div className="page-body stack" style={{ gap: '1.25rem', maxWidth: 640 }}>
        {q.isLoading && <p className="muted">Loading…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}
        {data && (
          <>
            <p className="muted small">{data.note}</p>

            <section className="card stack" style={{ gap: '0.75rem' }}>
              <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                <MessageCircle size={16} style={{ color: '#25d366' }} />
                <strong>My WhatsApp</strong>
              </div>
              {wa?.connected ? (
                <div className="muted small">
                  Linked{wa.phone_number ? `: +${wa.phone_number}` : ''}
                </div>
              ) : wa?.qr ? (
                <div className="stack" style={{ gap: '0.5rem', alignItems: 'center' }}>
                  <img
                    src={wa.qr}
                    alt="WhatsApp QR"
                    style={{ width: 200, borderRadius: 8, border: '1px solid var(--border)' }}
                  />
                  <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>
                    Scan with WhatsApp → Linked devices on your phone.
                  </p>
                </div>
              ) : wa?.status === 'connecting' ? (
                <p className="muted small" style={{ margin: 0 }}>
                  <RefreshCw size={14} className="spin" style={{ marginRight: 4 }} />
                  Waiting for QR…
                </p>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  Connect your personal WhatsApp to message leads from your number.
                </p>
              )}
              {wa?.error && <p className="error small">{wa.error}</p>}
              <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className={`badge ${wa?.connected ? 'badge-green' : 'badge-slate'}`}>
                  {wa?.connected ? 'Connected' : wa?.status === 'connecting' ? 'Connecting…' : 'Not connected'}
                </span>
                {wa?.connected ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={waDisconnect.isPending}
                    onClick={() => waDisconnect.mutate()}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={waConnect.isPending}
                    onClick={() => waConnect.mutate()}
                  >
                    <QrCode size={14} />
                    {waConnect.isPending ? 'Starting…' : 'Connect / Show QR'}
                  </button>
                )}
              </div>
            </section>

            <section className="card stack" style={{ gap: '0.75rem' }}>
              <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                <Mail size={16} />
                <strong>My Gmail</strong>
              </div>
              <div className="row" style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`badge ${gmailConnected ? 'badge-green' : 'badge-slate'}`}>
                  {gmailConnected ? 'Connected' : 'Not connected'}
                </span>
                {gmail?.connected_email && (
                  <span className="muted small">{gmail.connected_email}</span>
                )}
              </div>
              <div className="row" style={{ gap: '0.5rem' }}>
                {gmailConnected ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={gmailDisconnect.isPending}
                    onClick={() => gmailDisconnect.mutate()}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={gmailConnect.isPending || gmailQ.data?.google_configured === false}
                    onClick={() => gmailConnect.mutate()}
                  >
                    <Link2 size={14} />
                    {gmailConnect.isPending ? 'Redirecting…' : 'Connect Gmail'}
                  </button>
                )}
              </div>
              {gmailQ.data?.google_configured === false && (
                <p className="muted small" style={{ margin: 0 }}>
                  Google OAuth is not configured on this server.
                </p>
              )}
            </section>

            <section className="card stack" style={{ gap: '0.75rem' }}>
              <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                <Phone size={16} />
                <strong>Reminder phone</strong>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Used when Loomrun texts you about due follow-ups (separate from WhatsApp Web).
              </p>
              <div className="form-field">
                <label className="input-label">WhatsApp number</label>
                <input
                  className="input"
                  value={phoneValue}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91…"
                />
              </div>
              <button
                type="button"
                className="btn"
                disabled={savePhone.isPending}
                onClick={() => savePhone.mutate()}
              >
                {savePhone.isPending ? 'Saving…' : 'Save phone'}
              </button>
            </section>

            <section className="card stack" style={{ gap: '0.5rem' }}>
              <strong className="muted small">Organization connectors (CEO)</strong>
              <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                <span className={`badge ${data.org_whatsapp.connected ? 'badge-green' : 'badge-slate'}`}>
                  Org WhatsApp: {data.org_whatsapp.connected ? 'on' : 'off'}
                </span>
                <span className={`badge ${data.org_gmail.connected ? 'badge-green' : 'badge-slate'}`}>
                  Org Gmail: {data.org_gmail.connected ? 'on' : 'off'}
                </span>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Used as fallback when you have not connected a personal account. Managed in Settings.
              </p>
            </section>
          </>
        )}
      </div>
    </>
  )
}
