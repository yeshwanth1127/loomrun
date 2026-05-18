import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Mail, MessageCircle, Plus } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'
import { toast } from 'sonner'

type Lead = { id: string; title: string; phone?: string | null; email?: string | null }
type CatalogItem = {
  id: string
  name: string
  description: string | null
  unit_price: number
  sku: string | null
  created_at: string
}
type Quotation = {
  id: string
  number: string
  invoice_number: string | null
  status: string
  total: number
  lead_id: string
  lead_title: string | null
  lead_phone: string | null
  lead_email: string | null
  pdf_url: string | null
  sent_at: string | null
  invoiced_at: string | null
  lines: { id?: string; description: string; quantity: number; unit_price: number; line_total: number }[]
}

type LineDraft = { description: string; quantity: string; unit_price: string }

const STATUS_COLOR: Record<string, string> = {
  DRAFT:    'badge-slate',
  SENT:     'badge-blue',
  ACCEPTED: 'badge-green',
  REJECTED: 'badge-red',
  EXPIRED:  'badge-amber',
}

const emptyLine = (): LineDraft => ({ description: '', quantity: '1', unit_price: '' })

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

async function downloadPdf(orgId: string, quotationId: string, number: string) {
  try {
    const response = await fetch(
      `${base}/v1/orgs/${orgId}/quotations/${quotationId}/pdf-file`,
      {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` },
      }
    )
    if (!response.ok) {
      throw new Error('Failed to download PDF')
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `quotation-${number}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.error((err as Error).message || 'Failed to download PDF')
  }
}

export function QuotationsPage() {
  const { orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [leadId, setLeadId] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendNotice, setSendNotice] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLeadId, setEditLeadId] = useState('')
  const [editLines, setEditLines] = useState<LineDraft[]>([emptyLine()])

  const leadsQ = useQuery({
    queryKey: ['leads-select', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads`),
  })

  const catalogQ = useQuery({
    queryKey: ['catalog', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: CatalogItem[] }>(`/v1/orgs/${orgId}/catalog`),
  })

  const q = useQuery({
    queryKey: ['quotations', orgId, dayParam],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      return apiFetch<{ items: Quotation[] }>(`/v1/orgs/${orgId}/quotations?${params}`)
    },
  })

  const catalogItems = catalogQ.data?.items ?? []

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/quotations`, {
        method: 'POST',
        json: {
          lead_id: leadId,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
          })),
        },
      }),
    onSuccess: () => {
      setLeadId('')
      setLines([emptyLine()])
      setShowForm(false)
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
  })

  const genPdf = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${id}/generate-pdf`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['quotations', orgId] }),
  })

  const send = useMutation({
    mutationFn: ({ id, channel }: { id: string; channel: 'whatsapp' | 'email' }) =>
      apiFetch<{
        id: string
        status: string
        lead_stage: string
        channel: string
        message?: string
      }>(`/v1/orgs/${orgId}/quotations/${id}/send`, {
        method: 'POST',
        json: { channel },
      }),
    onSuccess: (data) => {
      setSendError(null)
      const via = data.channel === 'whatsapp' ? 'WhatsApp' : 'Email'
      setSendNotice(
        data.message ?? `Sent via ${via}. Lead stage: ${data.lead_stage.replace(/_/g, ' ')}`
      )
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      void qc.invalidateQueries({ queryKey: ['leads-select', orgId] })
    },
    onError: (err: Error) => {
      setSendNotice(null)
      setSendError(err.message)
    },
  })

  const edit = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${editingId}`, {
        method: 'PATCH',
        json: {
          lead_id: editLeadId,
          lines: editLines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
          })),
        },
      }),
    onSuccess: () => {
      setEditingId(null)
      setEditLeadId('')
      setEditLines([emptyLine()])
      toast.success('Quotation updated')
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const genInvoice = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${id}/generate-invoice`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Invoice generated')
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  if (!orgId) return (
    <>
      <div className="page-header"><h1>Quotations</h1><p>Select an organization.</p></div>
    </>
  )

  const quotations = q.data?.items ?? []
  const leads = leadsQ.data?.items ?? []

  function addLine() {
    setLines([...lines, emptyLine()])
  }

  function removeLine(i: number) {
    setLines(lines.filter((_, idx) => idx !== i))
  }

  function updateLine(i: number, field: keyof LineDraft, val: string) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, [field]: val } : l)))
  }

  function applyCatalogToLine(i: number, itemId: string) {
    const item = catalogItems.find((c) => c.id === itemId)
    if (!item) return
    setLines((prev) =>
      prev.map((l, idx) =>
        idx === i
          ? { ...l, description: item.name, unit_price: String(item.unit_price) }
          : l
      )
    )
  }

  function addCatalogAsNewLine(itemId: string) {
    const item = catalogItems.find((c) => c.id === itemId)
    if (!item) return
    setLines((prev) => [
      ...prev,
      { description: item.name, quantity: '1', unit_price: String(item.unit_price) },
    ])
  }

  function openEdit(quotation: Quotation) {
    setEditingId(quotation.id)
    setEditLeadId(quotation.lead_id)
    setEditLines(
      quotation.lines.map((l) => ({
        description: l.description,
        quantity: String(l.quantity),
        unit_price: String(l.unit_price),
      }))
    )
  }

  function addEditLine() {
    setEditLines([...editLines, emptyLine()])
  }

  function removeEditLine(i: number) {
    setEditLines(editLines.filter((_, idx) => idx !== i))
  }

  function updateEditLine(i: number, field: keyof LineDraft, val: string) {
    setEditLines(editLines.map((l, idx) => (idx === i ? { ...l, [field]: val } : l)))
  }

  const selectedLead = leads.find((l) => l.id === leadId)

  return (
    <>
      <div className="page-header">
        <h1>Quotations</h1>
        <p>
          {quotations.length} quotation{quotations.length !== 1 ? 's' : ''}
          {isAll ? '' : ` · Created ${dayParam}`}
          {' · '}Generate and track quotes
        </p>
      </div>

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        <div className="row spread">
          <span />
          <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
            <Plus size={15} />
            New quotation
          </button>
        </div>

        {sendNotice && <p className="success">{sendNotice}</p>}
        {sendError && <p className="error">{sendError}</p>}

        {showForm && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '1rem' }}>New Quotation</div>
            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                if (leadId && lines.every((l) => l.description && l.unit_price)) void create.mutateAsync()
              }}
            >
              <div className="form-field">
                <label className="input-label">Lead *</label>
                <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)} style={{ minWidth: 240 }} required>
                  <option value="">Select lead…</option>
                  {leads.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>

              <div>
                <div className="row spread" style={{ marginBottom: '0.5rem', alignItems: 'center' }}>
                  <div className="input-label">Line items</div>
                  {catalogItems.length > 0 ? (
                    <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                      <span className="muted small">{catalogItems.length} catalog items</span>
                      <select
                        className="select"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) addCatalogAsNewLine(e.target.value)
                          e.target.value = ''
                        }}
                        style={{ minWidth: 200 }}
                      >
                        <option value="">+ Add from catalog…</option>
                        {catalogItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} — ₹{item.unit_price.toLocaleString('en-IN')}
                            {item.sku ? ` (${item.sku})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="muted small">
                      No catalog yet.{' '}
                      <Link to="/app/brand-assets">Upload CSV in Brand assets</Link>
                    </p>
                  )}
                </div>

                <div className="stack" style={{ gap: '0.75rem' }}>
                  {lines.map((line, i) => (
                    <div key={i} className="stack" style={{ gap: '0.35rem', padding: '0.5rem', background: '#f8fafc', borderRadius: 8 }}>
                      {catalogItems.length > 0 && (
                        <select
                          className="select"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) applyCatalogToLine(i, e.target.value)
                            e.target.value = ''
                          }}
                        >
                          <option value="">Fill from catalog…</option>
                          {catalogItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} — ₹{item.unit_price.toLocaleString('en-IN')}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          className="input"
                          placeholder="Description"
                          value={line.description}
                          onChange={(e) => updateLine(i, 'description', e.target.value)}
                          style={{ flex: 3 }}
                          required
                        />
                        <input
                          className="input"
                          type="number"
                          placeholder="Qty"
                          value={line.quantity}
                          onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                          style={{ flex: 1, minWidth: 60 }}
                          min={1}
                          required
                        />
                        <input
                          className="input"
                          type="number"
                          placeholder="Unit price ₹"
                          value={line.unit_price}
                          onChange={(e) => updateLine(i, 'unit_price', e.target.value)}
                          style={{ flex: 1.5, minWidth: 100 }}
                          min={0}
                          required
                        />
                        <span style={{ minWidth: 80, fontWeight: 600, fontSize: '0.85rem' }}>
                          {line.quantity && line.unit_price
                            ? `₹${(Number(line.quantity) * Number(line.unit_price)).toLocaleString('en-IN')}`
                            : '—'}
                        </span>
                        {lines.length > 1 && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLine(i)}>✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={addLine}>
                  + Add line manually
                </button>
              </div>

              {selectedLead && (
                <p className="muted small">
                  Send later via {selectedLead.phone ? 'WhatsApp' : 'WhatsApp (no phone on lead)'}
                  {' · '}
                  {selectedLead.email ? 'Email' : 'Email (no address on lead)'}
                </p>
              )}

              {create.error && <p className="error">{(create.error as Error).message}</p>}
              <div className="row">
                <button type="submit" className="btn" disabled={create.isPending}>
                  {create.isPending ? 'Creating…' : 'Create quotation'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {q.isLoading && <p className="muted">Loading quotations…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {quotations.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Lead</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Sent</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((x) => {
                  const leadName = x.lead_title ?? leads.find((l) => l.id === x.lead_id)?.title ?? x.lead_id.slice(0, 8)
                  const canSend = x.status === 'DRAFT' && !!x.pdf_url
                  return (
                    <tr key={x.id}>
                      <td>
                        <div className="row" style={{ gap: '0.4rem' }}>
                          <FileText size={14} style={{ color: '#6366f1' }} />
                          <span style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem' }}>{x.number}</span>
                        </div>
                      </td>
                      <td className="muted">{leadName}</td>
                      <td><span className={`badge ${STATUS_COLOR[x.status] ?? 'badge-slate'}`}>{x.status}</span></td>
                      <td style={{ fontWeight: 700 }}>₹{x.total.toLocaleString('en-IN')}</td>
                      <td className="muted small">
                        {x.sent_at ? new Date(x.sent_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td>
                        <div className="stack" style={{ gap: '0.35rem', alignItems: 'flex-start' }}>
                          {!x.pdf_url ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={genPdf.isPending}
                              onClick={() => genPdf.mutate(x.id)}
                            >
                              Generate PDF
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => downloadPdf(orgId, x.id, x.number)}
                            >
                              <Download size={13} />
                              PDF
                            </button>
                          )}
                          {canSend && (
                            <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ background: '#25d366' }}
                                disabled={send.isPending}
                                title="Mark as sent via WhatsApp"
                                onClick={() => send.mutate({ id: x.id, channel: 'whatsapp' })}
                              >
                                <MessageCircle size={13} />
                                {send.isPending ? 'Sending…' : 'WhatsApp'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ background: '#6366f1' }}
                                disabled={send.isPending}
                                title="Mark as sent via email"
                                onClick={() => send.mutate({ id: x.id, channel: 'email' })}
                              >
                                <Mail size={13} />
                                {send.isPending ? 'Sending…' : 'Email'}
                              </button>
                            </div>
                          )}
                          {x.status === 'SENT' && !x.invoice_number && (
                            <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ background: '#10b981' }}
                                disabled={genInvoice.isPending}
                                onClick={() => genInvoice.mutate(x.id)}
                              >
                                Quotation Accepted
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => openEdit(x)}
                              >
                                Edit & Resend
                              </button>
                            </div>
                          )}
                          {x.invoice_number && (
                            <span className="badge badge-green">Invoice #{x.invoice_number.split('-')[1]}</span>
                          )}
                          {x.status === 'DRAFT' && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => openEdit(x)}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          !q.isLoading && (
            <div className="empty-state card">
              <p>No quotations yet. Create one from a lead.</p>
            </div>
          )
        )}
      </div>

      {editingId && (
        <div className="modal-wrap">
          <div className="modal-overlay" onClick={() => setEditingId(null)} />
          <div className="modal card" style={{ maxWidth: 600, gap: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Edit Quotation</div>
            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                if (editLeadId && editLines.every((l) => l.description && l.unit_price)) void edit.mutateAsync()
              }}
            >
              <div className="form-field">
                <label className="input-label">Lead *</label>
                <select className="select" value={editLeadId} onChange={(e) => setEditLeadId(e.target.value)} required>
                  <option value="">Select lead…</option>
                  {leads.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>

              <div>
                <div className="input-label" style={{ marginBottom: '0.5rem' }}>Line items</div>
                <div className="stack" style={{ gap: '0.75rem' }}>
                  {editLines.map((line, i) => (
                    <div key={i} className="stack" style={{ gap: '0.35rem', padding: '0.5rem', background: '#f8fafc', borderRadius: 8 }}>
                      <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          className="input"
                          placeholder="Description"
                          value={line.description}
                          onChange={(e) => updateEditLine(i, 'description', e.target.value)}
                          style={{ flex: 3 }}
                          required
                        />
                        <input
                          className="input"
                          type="number"
                          placeholder="Qty"
                          value={line.quantity}
                          onChange={(e) => updateEditLine(i, 'quantity', e.target.value)}
                          style={{ flex: 1, minWidth: 60 }}
                          min={1}
                          required
                        />
                        <input
                          className="input"
                          type="number"
                          placeholder="Unit price ₹"
                          value={line.unit_price}
                          onChange={(e) => updateEditLine(i, 'unit_price', e.target.value)}
                          style={{ flex: 1.5, minWidth: 100 }}
                          min={0}
                          required
                        />
                        <span style={{ minWidth: 80, fontWeight: 600, fontSize: '0.85rem' }}>
                          {line.quantity && line.unit_price
                            ? `₹${(Number(line.quantity) * Number(line.unit_price)).toLocaleString('en-IN')}`
                            : '—'}
                        </span>
                        {editLines.length > 1 && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeEditLine(i)}>✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={addEditLine}>
                  + Add line
                </button>
              </div>

              {edit.error && <p className="error">{(edit.error as Error).message}</p>}
              <div className="row">
                <button type="submit" className="btn" disabled={edit.isPending}>
                  {edit.isPending ? 'Updating…' : 'Update quotation'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
