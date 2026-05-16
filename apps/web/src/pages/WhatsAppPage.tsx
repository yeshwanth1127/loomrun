import { useMutation, useQuery } from '@tanstack/react-query'
import { MessageCircle, Send } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type Lead = { id: string; title: string; phone: string | null }

const TEMPLATES = [
  { label: 'Follow-up', text: 'Hi {name}, following up on your quotation. Please let us know if you have any questions!' },
  { label: 'Order ready', text: 'Hi {name}, your order is ready for dispatch. Kindly clear the pending balance to proceed.' },
  { label: 'Reorder', text: 'Hi {name}, it\'s been a while since your last order. Would you like to reorder?' },
]

export function WhatsAppPage() {
  const { orgId } = useAuth()
  const [leadId, setLeadId] = useState('')
  const [message, setMessage] = useState('')

  const leadsQ = useQuery({
    queryKey: ['leads-select', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads`),
  })

  const send = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/integrations/whatsapp/outbound`, {
        method: 'POST',
        json: { lead_id: leadId, message },
      }),
    onSuccess: () => setMessage(''),
  })

  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

  if (!orgId) return (
    <>
      <div className="page-header"><h1>WhatsApp</h1><p>Select an organization.</p></div>
    </>
  )

  const leads = leadsQ.data?.items ?? []
  return (
    <>
      <div className="page-header">
        <h1>WhatsApp</h1>
        <p>Send messages and manage automated follow-ups</p>
      </div>

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>

        {/* Send message */}
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <MessageCircle size={16} style={{ color: '#25d366' }} />
            Queue Outbound Message
          </div>
          <form
            className="stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              if (leadId && message) void send.mutateAsync()
            }}
          >
            <div className="form-field">
              <label className="input-label">Lead *</label>
              <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)} style={{ width: '100%' }} required>
                <option value="">Select lead…</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>{l.title}{l.phone ? ` · ${l.phone}` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="input-label">Message</label>
              <textarea
                className="input"
                rows={5}
                placeholder="Type your message…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={{ width: '100%', resize: 'vertical' }}
                required
              />
            </div>
            {send.error && <p className="error">{(send.error as Error).message}</p>}
            {send.isSuccess && <p className="success">Message queued for delivery.</p>}
            <button type="submit" className="btn" disabled={send.isPending || !leadId || !message}>
              <Send size={14} />
              {send.isPending ? 'Queuing…' : 'Queue message'}
            </button>
          </form>
        </div>

        {/* Templates & webhook info */}
        <div className="stack" style={{ gap: '1.25rem' }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Quick Templates</div>
            <div className="stack" style={{ gap: '0.5rem' }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  className="btn btn-ghost"
                  style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '0.82rem', padding: '0.5rem 0.75rem' }}
                  onClick={() => setMessage(t.text)}
                >
                  <MessageCircle size={13} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Inbound Webhook (Meta)</div>
            <p className="muted small" style={{ marginBottom: '0.5rem' }}>Configure this URL in your Meta App dashboard:</p>
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 7,
              padding: '0.65rem 0.75rem',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '0.75rem',
              color: '#4338ca',
              wordBreak: 'break-all',
            }}>
              POST {base}/v1/hooks/whatsapp/{orgId}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
