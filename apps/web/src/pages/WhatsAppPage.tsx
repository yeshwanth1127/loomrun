import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'
import { membershipForOrg } from '../lib/membership'

type Lead = { id: string; title: string; company: string | null; phone: string | null }

type OutboundMessage = {
  id: string
  lead_id: string | null
  lead_title: string | null
  status: string
  message: string | null
  created_at: string
}

type Template = {
  id: string
  category: string
  name: string
  body: string
  is_default: boolean
  created_at: string
  updated_at: string
}

type CategoryOpt = { value: string; label: string }

type TemplatesResponse = { items: Template[]; categories: CategoryOpt[] }

/** Replace {name}, {company} and {org} placeholders with the chosen lead / org. */
function applyVars(body: string, lead: Lead | undefined, orgName: string): string {
  const name = lead?.title ?? 'there'
  return body
    .replace(/\{name\}/g, name)
    .replace(/\{company\}/g, lead?.company || name)
    .replace(/\{org\}/g, orgName || 'our team')
}

export function WhatsAppPage() {
  const { me, orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const [leadId, setLeadId] = useState('')
  const [message, setMessage] = useState('')
  const [composeCategory, setComposeCategory] = useState('')
  const [composeTemplateId, setComposeTemplateId] = useState('')

  const membership = membershipForOrg(me, orgId)
  const orgName = membership?.organization.name ?? ''
  const canManage = membership?.role === 'OWNER' || membership?.role === 'SALES'

  const leadsQ = useQuery({
    queryKey: ['leads-select', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads`),
  })

  const messagesQ = useQuery({
    queryKey: ['whatsapp-messages', orgId, dayParam],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      return apiFetch<{ items: OutboundMessage[] }>(`/v1/orgs/${orgId}/integrations/whatsapp/messages?${params}`)
    },
  })

  const templatesQ = useQuery({
    queryKey: ['whatsapp-templates', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<TemplatesResponse>(`/v1/orgs/${orgId}/integrations/whatsapp/templates`),
  })

  const send = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; status: string; sent: boolean }>(`/v1/orgs/${orgId}/integrations/whatsapp/outbound`, {
        method: 'POST',
        json: { lead_id: leadId, message },
      }),
    onSuccess: () => {
      setMessage('')
      setComposeTemplateId('')
      void qc.invalidateQueries({ queryKey: ['whatsapp-messages', orgId] })
    },
  })

  const leads = leadsQ.data?.items ?? []
  const templates = templatesQ.data?.items ?? []
  const categories = useMemo(() => templatesQ.data?.categories ?? [], [templatesQ.data])
  const categoryLabel = useMemo(() => {
    const map = new Map(categories.map((c) => [c.value, c.label]))
    return (value: string) => map.get(value) ?? value
  }, [categories])

  const selectedLead = leads.find((l) => l.id === leadId)
  const composerTemplates = composeCategory ? templates.filter((t) => t.category === composeCategory) : templates

  function applyTemplate(templateId: string) {
    setComposeTemplateId(templateId)
    const tmpl = templates.find((t) => t.id === templateId)
    if (tmpl) setMessage(applyVars(tmpl.body, selectedLead, orgName))
  }

  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

  if (!orgId)
    return (
      <div className="page-header">
        <h1>WhatsApp</h1>
        <p>Select an organization.</p>
      </div>
    )

  const messages = messagesQ.data?.items ?? []
  return (
    <>
      <div className="page-header">
        <h1>WhatsApp</h1>
        <p>
          Send messages, build reusable templates and manage automated follow-ups
          {!isAll && ` · Showing ${messages.length} from ${dayParam}`}
          {isAll && messages.length > 0 && ` · ${messages.length} message${messages.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      <div className="page-body page-grid-2">
        {/* Compose */}
        <div className="stack" style={{ gap: '1.25rem' }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <MessageCircle size={16} style={{ color: '#25d366' }} />
              Send WhatsApp Message
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
                    <option key={l.id} value={l.id}>
                      {l.title}
                      {l.phone ? ` · ${l.phone}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="row" style={{ gap: '0.5rem' }}>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Template category</label>
                  <select
                    className="select"
                    value={composeCategory}
                    onChange={(e) => {
                      setComposeCategory(e.target.value)
                      setComposeTemplateId('')
                    }}
                    style={{ width: '100%' }}
                  >
                    <option value="">All categories</option>
                    {categories.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Use template</label>
                  <select
                    className="select"
                    value={composeTemplateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    style={{ width: '100%' }}
                    disabled={composerTemplates.length === 0}
                  >
                    <option value="">Select template…</option>
                    {composerTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
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
                <span className="muted small">Tip: templates fill in {'{name}'}, {'{company}'} and {'{org}'} automatically.</span>
              </div>
              {send.error && <p className="error">{(send.error as Error).message}</p>}
              {send.isSuccess && (
                <p className="success">
                  {send.data?.sent ? 'Message sent ✓' : 'WhatsApp not connected — queued, will retry shortly.'}
                </p>
              )}
              <button type="submit" className="btn" disabled={send.isPending || !leadId || !message}>
                <Send size={14} />
                {send.isPending ? 'Sending…' : 'Send message'}
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Message Log</div>
            {messagesQ.isLoading && <p className="muted small">Loading…</p>}
            {!messagesQ.isLoading && messages.length === 0 && (
              <p className="muted small">{isAll ? 'No messages queued yet.' : 'No messages on this date.'}</p>
            )}
            <div className="stack" style={{ gap: '0.5rem', maxHeight: 280, overflow: 'auto' }}>
              {messages.map((m) => (
                <div key={m.id} style={{ padding: '0.4rem 0', borderBottom: '1px solid #f8fafc' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{m.lead_title ?? '—'}</div>
                  <div className="muted small" style={{ marginTop: '0.15rem' }}>
                    {m.message ?? '—'}
                  </div>
                  <div className="row spread" style={{ marginTop: '0.25rem' }}>
                    <span className="badge badge-slate">{m.status}</span>
                    <span className="muted small">
                      {new Date(m.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Templates & webhook */}
        <div className="stack" style={{ gap: '1.25rem' }}>
          <AutoGreetCard orgId={orgId} canManage={canManage} />

          <TemplateManager
            orgId={orgId}
            canManage={canManage}
            templates={templates}
            categories={categories}
            categoryLabel={categoryLabel}
            isLoading={templatesQ.isLoading}
          />

          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Inbound Webhook (Meta)</div>
            <p className="muted small" style={{ marginBottom: '0.5rem' }}>
              Configure this URL in your Meta App dashboard:
            </p>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 7,
                padding: '0.65rem 0.75rem',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.75rem',
                color: '#4338ca',
                wordBreak: 'break-all',
              }}
            >
              POST {base}/v1/hooks/whatsapp/{orgId}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function AutoGreetCard({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const qc = useQueryClient()
  const settingsQ = useQuery({
    queryKey: ['whatsapp-settings', orgId],
    queryFn: () => apiFetch<{ auto_greet_new_leads: boolean }>(`/v1/orgs/${orgId}/integrations/whatsapp/settings`),
  })
  const update = useMutation({
    mutationFn: (value: boolean) =>
      apiFetch<{ auto_greet_new_leads: boolean }>(`/v1/orgs/${orgId}/integrations/whatsapp/settings`, {
        method: 'PATCH',
        json: { auto_greet_new_leads: value },
      }),
    onSuccess: (data) => qc.setQueryData(['whatsapp-settings', orgId], data),
  })

  const enabled = settingsQ.data?.auto_greet_new_leads ?? false

  return (
    <div className="card">
      <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Automation</div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', cursor: canManage ? 'pointer' : 'default' }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!canManage || settingsQ.isLoading || update.isPending}
          onChange={(e) => update.mutate(e.target.checked)}
          style={{ marginTop: '0.2rem' }}
        />
        <span>
          <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Automatically greet new leads</span>
          <span className="muted small" style={{ display: 'block', marginTop: '0.15rem' }}>
            When a new lead with a phone number is added (any source), send them your{' '}
            <strong>Greeting</strong> template on WhatsApp.
          </span>
        </span>
      </label>
      {update.error && <p className="error" style={{ marginTop: '0.5rem' }}>{(update.error as Error).message}</p>}
    </div>
  )
}

function TemplateManager({
  orgId,
  canManage,
  templates,
  categories,
  categoryLabel,
  isLoading,
}: {
  orgId: string
  canManage: boolean
  templates: Template[]
  categories: CategoryOpt[]
  categoryLabel: (value: string) => string
  isLoading: boolean
}) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const defaultCategory = categories[0]?.value ?? 'GREETING'
  const [form, setForm] = useState<{ category: string; name: string; body: string }>({
    category: defaultCategory,
    name: '',
    body: '',
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['whatsapp-templates', orgId] })

  function startAdd() {
    setEditingId(null)
    setForm({ category: defaultCategory, name: '', body: '' })
    setAdding(true)
  }

  function startEdit(t: Template) {
    setAdding(false)
    setEditingId(t.id)
    setForm({ category: t.category, name: t.name, body: t.body })
  }

  function cancel() {
    setAdding(false)
    setEditingId(null)
  }

  const save = useMutation({
    mutationFn: () => {
      if (editingId) {
        return apiFetch(`/v1/orgs/${orgId}/integrations/whatsapp/templates/${editingId}`, {
          method: 'PATCH',
          json: form,
        })
      }
      return apiFetch(`/v1/orgs/${orgId}/integrations/whatsapp/templates`, { method: 'POST', json: form })
    },
    onSuccess: () => {
      cancel()
      void invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/integrations/whatsapp/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => void invalidate(),
  })

  const editing = adding || editingId !== null
  const grouped = categories
    .map((c) => ({ category: c, items: templates.filter((t) => t.category === c.value) }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="card">
      <div className="row spread" style={{ alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 700 }}>Message Templates</div>
        {canManage && !editing && (
          <button type="button" className="btn btn-ghost" style={{ padding: '0.35rem 0.6rem' }} onClick={startAdd}>
            <Plus size={14} /> New
          </button>
        )}
      </div>

      {editing && (
        <form
          className="stack"
          style={{ gap: '0.6rem', marginBottom: '1rem', padding: '0.75rem', background: '#f8fafc', borderRadius: 8 }}
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (form.name.trim() && form.body.trim()) void save.mutateAsync()
          }}
        >
          <div className="row" style={{ gap: '0.5rem' }}>
            <div className="form-field" style={{ flex: 1 }}>
              <label className="input-label">Category</label>
              <select
                className="select"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                style={{ width: '100%' }}
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ flex: 2 }}>
              <label className="input-label">Template name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Diwali greeting"
                style={{ width: '100%' }}
                required
              />
            </div>
          </div>
          <div className="form-field">
            <label className="input-label">Body</label>
            <textarea
              className="input"
              rows={4}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="Hi {name}, …"
              style={{ width: '100%', resize: 'vertical' }}
              required
            />
            <span className="muted small">Use {'{name}'}, {'{company}'} and {'{org}'} as placeholders.</span>
          </div>
          {save.error && <p className="error">{(save.error as Error).message}</p>}
          <div className="row" style={{ gap: '0.5rem' }}>
            <button type="submit" className="btn" disabled={save.isPending || !form.name.trim() || !form.body.trim()}>
              {save.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Add template'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={cancel}>
              <X size={14} /> Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="muted small">Loading templates…</p>}
      {!isLoading && templates.length === 0 && <p className="muted small">No templates yet.</p>}

      <div className="stack" style={{ gap: '1rem' }}>
        {grouped.map((g) => (
          <div key={g.category.value}>
            <div className="muted small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.4rem' }}>
              {categoryLabel(g.category.value)}
            </div>
            <div className="stack" style={{ gap: '0.5rem' }}>
              {g.items.map((t) => (
                <div key={t.id} style={{ padding: '0.5rem 0.65rem', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <div className="row spread" style={{ alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t.name}</div>
                      <div className="muted small" style={{ marginTop: '0.2rem', whiteSpace: 'pre-wrap' }}>{t.body}</div>
                    </div>
                    {canManage && (
                      <div className="row" style={{ gap: '0.25rem', flexShrink: 0 }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.3rem' }}
                          title="Edit"
                          onClick={() => startEdit(t)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.3rem', color: '#dc2626' }}
                          title="Delete"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`Delete template "${t.name}"?`)) void remove.mutate(t.id)
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {remove.error && <p className="error" style={{ marginTop: '0.5rem' }}>{(remove.error as Error).message}</p>}
    </div>
  )
}
