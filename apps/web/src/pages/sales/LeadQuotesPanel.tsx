import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Mail, MessageCircle, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { RowActions } from '../../components/RowActions'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { apiFetch, apiFetchBlob } from '../../lib/api'
import { routes } from '../../lib/appRoutes'
import type { Lead } from '../../lib/leads'

type Quotation = {
  id: string
  number: string
  title: string | null
  invoice_number: string | null
  status: string
  total: number
  lead_id: string
  lead_title: string | null
  lead_phone: string | null
  lead_email: string | null
  pdf_url: string | null
  template_id: string | null
  sent_at: string | null
  invoiced_at: string | null
  linked_invoice_id?: string | null
  linked_invoice_number?: string | null
  lines: {
    id?: string
    description: string
    quantity: number
    unit_price: number
    line_total: number
  }[]
}

type CatalogItem = {
  id: string
  name: string
  description: string | null
  unit_price: number
  sku: string | null
}

type DocTemplate = {
  id: string
  name: string
  doc_type: string
  is_default: boolean
}

type LineDraft = { description: string; quantity: string; unit_price: string }

const emptyLine = (): LineDraft => ({
  description: '',
  quantity: '1',
  unit_price: '',
})

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'badge-slate',
  SENT: 'badge-blue',
  ACCEPTED: 'badge-green',
  INVOICED: 'badge-indigo',
  REJECTED: 'badge-red',
  EXPIRED: 'badge-amber',
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  INVOICED: 'Invoiced',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
}

function quotationName(q: Quotation): string {
  return q.title?.trim() || q.invoice_number || q.number
}

export function LeadQuotesPanel({
  lead,
  orgId,
  isOwner,
  canManageQuotes = false,
}: {
  lead: Lead
  orgId: string
  isOwner: boolean
  /** Create / edit / PDF / send — Owner, Sales, Telecaller */
  canManageQuotes?: boolean
}) {
  const canEditQuotes = canManageQuotes || isOwner

  const qc = useQueryClient()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [templateId, setTemplateId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLines, setEditLines] = useState<LineDraft[]>([])

  const quotesQ = useQuery({
    queryKey: ['lead-quotations', orgId, lead.id],
    enabled: !!orgId,
    queryFn: async () => {
      const { items } = await apiFetch<{ items: Quotation[] }>(
        `/v1/orgs/${orgId}/quotations?day=all&doc=quotation`,
      )
      return items.filter((q) => q.lead_id === lead.id)
    },
  })

  const catalogQ = useQuery({
    queryKey: ['catalog', orgId],
    enabled: !!orgId && canEditQuotes,
    queryFn: () => apiFetch<{ items: CatalogItem[] }>(`/v1/orgs/${orgId}/catalog`),
  })

  const templatesQ = useQuery({
    queryKey: ['document-templates', orgId, 'QUOTATION'],
    enabled: !!orgId && canEditQuotes,
    queryFn: () =>
      apiFetch<{
        items: DocTemplate[]
        default_quotation_template_id: string | null
      }>(`/v1/orgs/${orgId}/document-templates?doc_type=QUOTATION`),
  })

  const quotes = quotesQ.data ?? []
  const catalog = catalogQ.data?.items ?? []
  const templates = templatesQ.data?.items ?? []
  const defaultTemplateId = templatesQ.data?.default_quotation_template_id ?? ''

  function invalidate() {
    void qc.invalidateQueries({
      queryKey: ['lead-quotations', orgId, lead.id],
    })
    void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, lead.id] })
    void qc.invalidateQueries({ queryKey: ['leads', orgId] })
    void qc.invalidateQueries({ queryKey: ['home-quotations', orgId] })
  }

  const create = useMutation({
    mutationFn: async (mode: 'draft' | 'finalize') => {
      const created = await apiFetch<{ id: string; number: string }>(
        `/v1/orgs/${orgId}/quotations`,
        {
          method: 'POST',
          json: {
            lead_id: lead.id,
            template_id: templateId || null,
            lines: lines.map((l) => ({
              description: l.description,
              quantity: Number(l.quantity),
              unit_price: Number(l.unit_price),
            })),
          },
        },
      )
      if (mode === 'finalize') {
        await apiFetch(`/v1/orgs/${orgId}/quotations/${created.id}/generate-pdf`, {
          method: 'POST',
          json: { template_id: templateId || null },
        })
      }
      return { created, mode }
    },
    onSuccess: ({ created, mode }) => {
      toast.success(
        mode === 'finalize' ? `Quotation ${created.number} ready to send` : 'Saved as draft',
      )
      setLines([emptyLine()])
      setShowForm(false)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const update = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string; message?: string; lead_stage?: string }>(
        `/v1/orgs/${orgId}/quotations/${id}`,
        {
          method: 'PATCH',
          json: {
            lead_id: lead.id,
            lines: editLines.map((l) => ({
              description: l.description,
              quantity: Number(l.quantity),
              unit_price: Number(l.unit_price),
            })),
          },
        },
      ),
    onSuccess: (data) => {
      toast.success(
        data.lead_stage === 'NEGOTIATION'
          ? 'Updated · lead moved to Negotiation'
          : 'Updated — regenerate the PDF to send the new version',
      )
      setEditingId(null)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const genPdf = useMutation({
    mutationFn: (p: { id: string; template_id: string | null }) =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${p.id}/generate-pdf`, {
        method: 'POST',
        json: { template_id: p.template_id },
      }),
    onSuccess: () => {
      toast.success('PDF ready')
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const send = useMutation({
    mutationFn: (p: { id: string; channel: 'whatsapp' | 'email' }) =>
      apiFetch<{ message?: string; channel: string }>(`/v1/orgs/${orgId}/quotations/${p.id}/send`, {
        method: 'POST',
        json: { channel: p.channel, doc_type: 'quotation' },
      }),
    onSuccess: (data, p) => {
      toast.success(data.message ?? `Sent via ${p.channel === 'whatsapp' ? 'WhatsApp' : 'email'}`)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const genInvoice = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ invoice_number: string; id?: string; quotation_id?: string }>(
        `/v1/orgs/${orgId}/quotations/${id}/generate-invoice`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      const invoiceId = data.quotation_id || data.id
      toast.success(`Invoice ${data.invoice_number} created`)
      invalidate()
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
      if (invoiceId) navigate(routes.moneyInvoiceDoc(invoiceId))
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const rename = useMutation({
    mutationFn: (p: { id: string; title: string }) =>
      apiFetch<Quotation>(`/v1/orgs/${orgId}/quotations/${p.id}/title`, {
        method: 'PATCH',
        json: { title: p.title },
      }),
    onSuccess: () => {
      toast.success('Renamed')
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Deleted')
      invalidate()
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function openPdf(q: Quotation, variant: 'quotation' | 'invoice', download: boolean) {
    if (!download) {
      navigate(routes.quotationDoc(q.id))
      return
    }
    try {
      const blob = await apiFetchBlob(
        `/v1/orgs/${orgId}/quotations/${q.id}/pdf-file?variant=${variant}`,
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${variant === 'invoice' ? q.invoice_number : q.number}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load PDF')
    }
  }

  const canSubmit = lines.every((l) => l.description && l.unit_price)
  const canSubmitEdit =
    editLines.length > 0 && editLines.every((l) => l.description && l.unit_price)
  const editing = quotes.find((q) => q.id === editingId) ?? null

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="row" style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="drawer-section-title" style={{ margin: 0 }}>
          Quotations for this lead
        </div>
        <div className="row" style={{ gap: '0.5rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {isOwner && (
            <Link to={routes.quotes} className="btn btn-ghost btn-sm">
              All quotations
            </Link>
          )}
          {canEditQuotes && (
            <button type="button" className="btn btn-sm" onClick={() => setShowForm(true)}>
              <Plus size={14} />
              New quotation
            </button>
          )}
        </div>
      </div>

      {quotesQ.isLoading ? (
        <p className="muted small">Loading quotations…</p>
      ) : quotes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No quotation yet"
          description={
            canEditQuotes
              ? 'Create one from your catalog and send it on WhatsApp or email.'
              : 'Ask a CEO to create a quotation for this lead.'
          }
          action={
            canEditQuotes ? (
              <button type="button" className="btn btn-sm" onClick={() => setShowForm(true)}>
                <Plus size={14} />
                New quotation
              </button>
            ) : null
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Quotation</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Do</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const canSendWhatsApp = q.status === 'DRAFT' && !!q.pdf_url
                const effectiveTemplate = q.template_id ?? defaultTemplateId
                return (
                  <tr key={q.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{quotationName(q)}</div>
                      <div className="muted small mono">{q.number}</div>
                      {q.invoice_number && (
                        <div className="muted small">Invoice {q.invoice_number}</div>
                      )}
                    </td>
                    <td>₹{q.total.toLocaleString('en-IN')}</td>
                    <td>
                      <span className={`badge ${STATUS_COLOR[q.status] ?? 'badge-slate'}`}>
                        {STATUS_LABEL[q.status] ?? q.status}
                      </span>
                      {!q.pdf_url && <div className="muted small">PDF not made yet</div>}
                    </td>
                    <td>
                      <RowActions>
                        {(close) => (
                          <>
                            {!q.pdf_url && canEditQuotes && (
                              <button
                                type="button"
                                className="row-actions-menu-item"
                                disabled={genPdf.isPending}
                                onClick={() => {
                                  genPdf.mutate({
                                    id: q.id,
                                    template_id: effectiveTemplate || null,
                                  })
                                  close()
                                }}
                              >
                                <FileText size={14} />
                                Make the PDF
                              </button>
                            )}
                            {q.pdf_url && (
                              <>
                                <button
                                  type="button"
                                  className="row-actions-menu-item"
                                  onClick={() => {
                                    void openPdf(
                                      q,
                                      q.invoice_number ? 'invoice' : 'quotation',
                                      false,
                                    )
                                    close()
                                  }}
                                >
                                  <FileText size={14} />
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  className="row-actions-menu-item"
                                  onClick={() => {
                                    void openPdf(q, 'quotation', true)
                                    close()
                                  }}
                                >
                                  <Download size={14} />
                                  Download quotation
                                </button>
                                {q.invoice_number && (
                                  <button
                                    type="button"
                                    className="row-actions-menu-item"
                                    onClick={() => {
                                      void openPdf(q, 'invoice', true)
                                      close()
                                    }}
                                  >
                                    <Download size={14} />
                                    Download invoice
                                  </button>
                                )}
                                {canSendWhatsApp && (
                                  <button
                                    type="button"
                                    className="row-actions-menu-item"
                                    disabled={send.isPending}
                                    onClick={() => {
                                      send.mutate({
                                        id: q.id,
                                        channel: 'whatsapp',
                                      })
                                      close()
                                    }}
                                  >
                                    <MessageCircle size={14} />
                                    Send on WhatsApp
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="row-actions-menu-item"
                                  disabled={send.isPending || !q.lead_email}
                                  title={q.lead_email ?? 'This lead has no email address'}
                                  onClick={() => {
                                    send.mutate({ id: q.id, channel: 'email' })
                                    close()
                                  }}
                                >
                                  <Mail size={14} />
                                  {q.status === 'SENT' ? 'Resend by email' : 'Send by email'}
                                </button>
                              </>
                            )}
                            {isOwner && !q.invoice_number && (q.linked_invoice_id || q.status === 'INVOICED') ? (
                              <button
                                type="button"
                                className="row-actions-menu-item"
                                disabled={!q.linked_invoice_id}
                                onClick={() => {
                                  if (q.linked_invoice_id) {
                                    navigate(routes.moneyInvoiceDoc(q.linked_invoice_id))
                                  }
                                  close()
                                }}
                              >
                                <FileText size={14} />
                                Open invoice
                              </button>
                            ) : isOwner && !q.invoice_number && q.pdf_url ? (
                              <button
                                type="button"
                                className="row-actions-menu-item"
                                disabled={genInvoice.isPending}
                                onClick={() => {
                                  genInvoice.mutate(q.id)
                                  close()
                                }}
                              >
                                <FileText size={14} />
                                Turn into invoice
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="row-actions-menu-item"
                              onClick={() => {
                                const next = window.prompt('Name this quotation', q.title ?? '')
                                if (next !== null) rename.mutate({ id: q.id, title: next })
                                close()
                              }}
                            >
                              Rename
                            </button>
                            {canEditQuotes && !q.invoice_number && (
                              <button
                                type="button"
                                className="row-actions-menu-item"
                                onClick={() => {
                                  setEditingId(q.id)
                                  setEditLines(
                                    q.lines.map((l) => ({
                                      description: l.description,
                                      quantity: String(l.quantity),
                                      unit_price: String(l.unit_price),
                                    })),
                                  )
                                  close()
                                }}
                              >
                                {q.pdf_url
                                  ? q.status === 'SENT'
                                    ? 'Edit & resend'
                                    : 'Edit quotation'
                                  : 'Edit draft'}
                              </button>
                            )}
                            {isOwner && (
                              <button
                                type="button"
                                className="row-actions-menu-item"
                                disabled={remove.isPending}
                                onClick={() => {
                                  if (window.confirm(`Delete ${quotationName(q)}?`)) {
                                    remove.mutate(q.id)
                                  }
                                  close()
                                }}
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            )}
                          </>
                        )}
                      </RowActions>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={`New quotation for ${lead.title}`}
        size="lg"
      >
        <div className="stack" style={{ gap: '0.85rem' }}>
          {templates.length > 0 && (
            <div className="form-field">
              <label className="input-label">PDF design</label>
              <select
                className="select"
                value={templateId || defaultTemplateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <LineEditor lines={lines} catalog={catalog} onChange={setLines} />

          <p className="muted small" style={{ margin: 0 }}>
            Send later on {lead.phone ? 'WhatsApp' : 'WhatsApp (no phone on this lead)'} ·{' '}
            {lead.email ? 'email' : 'email (no address on this lead)'}
          </p>
        </div>

        <div
          className="row"
          style={{
            gap: '0.5rem',
            justifyContent: 'flex-end',
            marginTop: '1rem',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowForm(false)}
            disabled={create.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => create.mutate('draft')}
            disabled={create.isPending || !canSubmit}
          >
            Save as draft
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => create.mutate('finalize')}
            disabled={create.isPending || !canSubmit}
          >
            {create.isPending ? 'Creating…' : 'Create quotation'}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditingId(null)}
        title={editing ? `Edit ${quotationName(editing)}` : 'Edit quotation'}
        size="lg"
      >
        <LineEditor lines={editLines} onChange={setEditLines} />
        <div
          className="row"
          style={{
            gap: '0.5rem',
            justifyContent: 'flex-end',
            marginTop: '1rem',
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={update.isPending || !canSubmitEdit}
            onClick={() => editingId && update.mutate(editingId)}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function LineEditor({
  lines,
  catalog = [],
  onChange,
}: {
  lines: LineDraft[]
  catalog?: CatalogItem[]
  onChange: (next: LineDraft[]) => void
}) {
  function update(i: number, field: keyof LineDraft, value: string) {
    onChange(lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  const total = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0),
    0,
  )

  return (
    <div className="stack" style={{ gap: '0.6rem' }}>
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <label className="input-label" style={{ margin: 0 }}>
          What are you quoting?
        </label>
        {catalog.length > 0 && (
          <select
            className="select"
            value=""
            style={{ marginLeft: 'auto', maxWidth: 240 }}
            onChange={(e) => {
              const item = catalog.find((c) => c.id === e.target.value)
              if (!item) return
              onChange([
                ...lines,
                {
                  description: item.name,
                  quantity: '1',
                  unit_price: String(item.unit_price),
                },
              ])
            }}
          >
            <option value="">Add from catalog…</option>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — ₹{c.unit_price.toLocaleString('en-IN')}
                {c.sku ? ` (${c.sku})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {lines.map((l, i) => (
        <div key={i} className="row quote-line-row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <div className="form-field" style={{ flex: '2 1 200px' }}>
            <input
              className="input"
              placeholder="Item description"
              required
              value={l.description}
              onChange={(e) => update(i, 'description', e.target.value)}
            />
          </div>
          <div className="form-field" style={{ flex: '0 1 90px' }}>
            <input
              className="input"
              type="number"
              min={1}
              placeholder="Qty"
              required
              value={l.quantity}
              onChange={(e) => update(i, 'quantity', e.target.value)}
            />
          </div>
          <div className="form-field" style={{ flex: '0 1 120px' }}>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="Rate ₹"
              required
              value={l.unit_price}
              onChange={(e) => update(i, 'unit_price', e.target.value)}
            />
          </div>
          <div className="muted small" style={{ minWidth: 90, alignSelf: 'center' }}>
            {l.quantity && l.unit_price
              ? `₹${(Number(l.quantity) * Number(l.unit_price)).toLocaleString('en-IN')}`
              : '—'}
          </div>
          {catalog.length > 0 && (
            <select
              className="select"
              value=""
              style={{ flex: '0 1 150px' }}
              onChange={(e) => {
                const item = catalog.find((c) => c.id === e.target.value)
                if (!item) return
                onChange(
                  lines.map((row, idx) =>
                    idx === i
                      ? {
                          ...row,
                          description: item.name,
                          unit_price: String(item.unit_price),
                        }
                      : row,
                  ),
                )
              }}
            >
              <option value="">Fill from catalog…</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {lines.length > 1 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
              aria-label="Remove line"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}

      <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...lines, emptyLine()])}
        >
          <Plus size={14} />
          Add line
        </button>
        <strong style={{ marginLeft: 'auto' }}>Total ₹{total.toLocaleString('en-IN')}</strong>
      </div>
    </div>
  )
}
