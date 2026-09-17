import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, FileText, Mail, MessageCircle, Pencil, Plus, Send, ShieldCheck, Trash2, TrendingUp } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { routes } from '../lib/appRoutes'
import { apiFetch } from '../lib/api'
import { LeadSearchSelect, type LeadOption } from '../components/LeadSearchSelect'
import { RowActions } from '../components/RowActions'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { DonutChart, DonutLegend, InsightCard, InsightGrid, MetricCard } from '../components/ui/dashboard'
import { toast } from 'sonner'

type Lead = { id: string; title: string; phone?: string | null; email?: string | null; company?: string | null }
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
  lines: { id?: string; description: string; quantity: number; unit_price: number; line_total: number }[]
}

type DocTemplate = {
  id: string
  name: string
  doc_type: string
  is_default: boolean
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

async function fetchPdfBlob(
  orgId: string,
  quotationId: string,
  variant: 'quotation' | 'invoice' = 'quotation',
): Promise<Blob> {
  const params = new URLSearchParams({ variant })
  const response = await fetch(
    `${base}/v1/orgs/${orgId}/quotations/${quotationId}/pdf-file?${params}`,
    {
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` },
    },
  )
  if (!response.ok) {
    throw new Error('Failed to load PDF')
  }
  return response.blob()
}

async function downloadPdf(
  orgId: string,
  quotationId: string,
  filename: string,
  variant: 'quotation' | 'invoice' = 'quotation',
) {
  try {
    const blob = await fetchPdfBlob(orgId, quotationId, variant)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${filename}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.error((err as Error).message || 'Failed to download PDF')
  }
}

function quotationDisplayName(q: Pick<Quotation, 'title' | 'number' | 'invoice_number'>) {
  return q.title?.trim() || q.invoice_number || q.number
}

export function QuotationsPage() {
  const { orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [leadId, setLeadId] = useState('')
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLeadId, setEditLeadId] = useState('')
  const [editLines, setEditLines] = useState<LineDraft[]>([emptyLine()])
  const [templateId, setTemplateId] = useState('')
  const [previewQuotation, setPreviewQuotation] = useState<Quotation | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [renamingQuotation, setRenamingQuotation] = useState<Quotation | null>(null)
  const [renameTitle, setRenameTitle] = useState('')

  useEffect(() => {
    const state = location.state as { leadId?: string; openForm?: boolean } | null
    if (!state?.leadId) return
    setLeadId(state.leadId)
    if (state.openForm) setShowForm(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  async function openPreview(quotation: Quotation) {
    // Full-screen document workspace (same records in Sales and Money)
    const path = location.pathname.startsWith('/app/money')
      ? routes.moneyQuotationDoc(quotation.id)
      : routes.quotationDoc(quotation.id)
    navigate(path)
  }


  function closePreview() {
    setPreviewQuotation(null)
    setPreviewError(null)
    setPreviewLoading(false)
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreviewUrl(null)
  }
  const [pdfTemplateByQuotation, setPdfTemplateByQuotation] = useState<Record<string, string>>({})
  // Last action result per quotation, shown inline beside that row's Actions dropdown.
  const [rowStatus, setRowStatus] = useState<
    Record<string, { text: string; detail?: string; ok: boolean }>
  >({})

  const markRow = (id: string, text: string, ok = true, detail?: string) =>
    setRowStatus((prev) => ({ ...prev, [id]: { text, ok, detail } }))

  const clearRow = (id: string) =>
    setRowStatus((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

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

  const templatesQ = useQuery({
    queryKey: ['document-templates', orgId, 'QUOTATION'],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ items: DocTemplate[]; default_quotation_template_id: string | null }>(
        `/v1/orgs/${orgId}/document-templates?doc_type=QUOTATION`
      ),
  })

  const quotationTemplates = templatesQ.data?.items ?? []
  const defaultTemplateId = templatesQ.data?.default_quotation_template_id ?? ''

  const q = useQuery({
    queryKey: ['quotations', orgId, dayParam],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      params.set('doc', 'quotation')
      return apiFetch<{ items: Quotation[] }>(`/v1/orgs/${orgId}/quotations?${params}`)
    },
  })

  const catalogItems = catalogQ.data?.items ?? []

  const create = useMutation({
    mutationFn: async (mode: 'draft' | 'finalize') => {
      const created = await apiFetch<{ id: string; number: string }>(`/v1/orgs/${orgId}/quotations`, {
        method: 'POST',
        json: {
          lead_id: leadId,
          template_id: templateId || null,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
          })),
        },
      })
      if (mode === 'finalize') {
        await apiFetch(`/v1/orgs/${orgId}/quotations/${created.id}/generate-pdf`, {
          method: 'POST',
          json: { template_id: templateId || null },
        })
      }
      return { created, mode }
    },
    onSuccess: ({ created, mode }) => {
      setLeadId('')
      setSelectedLead(null)
      setLines([emptyLine()])
      setShowForm(false)
      if (mode === 'finalize') {
        markRow(created.id, 'PDF generating…')
        toast.success(`Quotation ${created.number} created — PDF generating`)
      } else {
        markRow(created.id, 'Saved as draft')
        toast.success(`Draft ${created.number} saved`)
      }
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create quotation')
    },
  })

  function canSubmitForm() {
    return !!leadId && lines.every((l) => l.description && l.unit_price)
  }

  function submitCreate(mode: 'draft' | 'finalize') {
    if (!canSubmitForm() || create.isPending) return
    void create.mutateAsync(mode)
  }

  const genPdf = useMutation({
    mutationFn: ({ id, template_id }: { id: string; template_id?: string | null }) =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${id}/generate-pdf`, {
        method: 'POST',
        json: { template_id: template_id || null },
      }),
    onSuccess: (_data, vars) => {
      markRow(vars.id, 'PDF generated')
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
    onError: (err: Error, vars) => markRow(vars.id, err.message || 'PDF failed', false),
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
        json: { channel, doc_type: 'quotation' },
      }),
    onSuccess: (data) => {
      const via = data.channel === 'whatsapp' ? 'WhatsApp' : 'Email'
      markRow(
        data.id,
        `Sent via ${via}`,
        true,
        data.message ?? `Lead stage: ${data.lead_stage.replace(/_/g, ' ')}`
      )
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      void qc.invalidateQueries({ queryKey: ['leads-select', orgId] })
    },
    onError: (err: Error, vars) => markRow(vars.id, err.message || 'Send failed', false),
  })

  const edit = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; message?: string; lead_stage?: string }>(
        `/v1/orgs/${orgId}/quotations/${editingId}`,
        {
          method: 'PATCH',
          json: {
            lead_id: editLeadId,
            lines: editLines.map((l) => ({
              description: l.description,
              quantity: Number(l.quantity),
              unit_price: Number(l.unit_price),
            })),
          },
        },
      ),
    onSuccess: (data) => {
      if (editingId) {
        markRow(
          editingId,
          data.lead_stage === 'NEGOTIATION'
            ? 'Updated · lead → Negotiation'
            : 'Draft updated — regenerate PDF',
        )
      }
      setEditingId(null)
      setEditLeadId('')
      setEditLines([emptyLine()])
      toast.success(
        data.message ??
          (data.lead_stage === 'NEGOTIATION'
            ? 'Quotation updated — lead moved to Negotiation'
            : 'Draft updated — generate PDF when ready'),
      )
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      void qc.invalidateQueries({ queryKey: ['leads-select', orgId] })
    },
    onError: (err: Error) => {
      if (editingId) markRow(editingId, err.message || 'Update failed', false)
      toast.error(err.message)
    },
  })

  const genInvoice = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ invoice_number: string }>(`/v1/orgs/${orgId}/quotations/${id}/generate-invoice`, { method: 'POST' }),
    onSuccess: (data, id) => {
      markRow(id, `Invoice ${data.invoice_number} created`)
      toast.success(`Invoice ${data.invoice_number} created — PDF generating…`)
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
    },
    onError: (err: Error, id) => {
      markRow(id, err.message || 'Convert failed', false)
      toast.error(err.message)
    },
  })

  const deleteQuotation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Deleted')
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete'),
  })

  const renameQuotation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiFetch<Quotation>(`/v1/orgs/${orgId}/quotations/${id}/title`, {
        method: 'PATCH',
        json: { title },
      }),
    onSuccess: (data) => {
      markRow(data.id, 'Renamed')
      toast.success(data.title ? `Renamed to “${data.title}”` : 'Name cleared')
      setRenamingQuotation(null)
      setRenameTitle('')
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to rename'),
  })

  if (!orgId) return (
    <PageHeader title="Quotations" description="Select an organization." />
  )

  const quotations = (q.data?.items ?? []).filter((x) => !x.invoice_number)
  const leads = leadsQ.data?.items ?? []
  const draftCount = quotations.filter((x) => x.status === 'DRAFT').length
  const sentCount = quotations.filter((x) => x.status === 'SENT').length
  const acceptedCount = quotations.filter((x) => x.status === 'ACCEPTED').length
  const rejectedCount = quotations.filter((x) => x.status === 'REJECTED').length
  const totalValue = quotations.reduce((s, x) => s + (Number(x.total) || 0), 0)

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

  return (
    <>
      <PageHeader
        title="Quotations"
        badge={`${quotations.length} total`}
        description="Create, manage and track all your quotations."
        actions={
          <button type="button" className="btn" onClick={() => setShowForm(true)}>
            <Plus size={15} />
            New quotation
          </button>
        }
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        <div className="metrics-grid">
          <MetricCard icon={FileText} tone="purple" label="Total quotations" value={quotations.length} hint={isAll ? 'This period' : dayParam} />
          <MetricCard icon={ShieldCheck} tone="green" label="Accepted" value={acceptedCount} />
          <MetricCard
            icon={TrendingUp}
            tone="purple"
            label="Accepted rate"
            value={
              quotations.length
                ? `${((acceptedCount / quotations.length) * 100).toFixed(0)}%`
                : '0%'
            }
            hint="Of open quotations"
          />
        </div>
        <div className="status-strip" aria-label="Quotation status breakdown">
          <span className="status-strip-item">
            <span className="status-strip-dot draft" aria-hidden />
            Draft <strong>{draftCount}</strong>
          </span>
          <span className="status-strip-item">
            <span className="status-strip-dot sent" aria-hidden />
            Sent <strong>{sentCount}</strong>
          </span>
          <span className="status-strip-item">
            <span className="status-strip-dot rejected" aria-hidden />
            Rejected <strong>{rejectedCount}</strong>
          </span>
        </div>
        {q.isLoading && <p className="muted">Loading quotations…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {quotations.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quotation</th>
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
                    <tr
                      key={x.id}
                      className="quotation-row"
                      onClick={() => void openPreview(x)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div className="row" style={{ gap: '0.4rem' }}>
                          <FileText size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                          <div className="stack" style={{ gap: '0.15rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                              {quotationDisplayName(x)}
                            </span>
                            <span className="muted small" style={{ fontFamily: 'ui-monospace, monospace' }}>
                              {x.invoice_number
                                ? `${x.invoice_number} · from ${x.number}`
                                : x.title
                                  ? x.number
                                  : 'Click to preview'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="muted">{leadName}</td>
                      <td><span className={`badge ${STATUS_COLOR[x.status] ?? 'badge-slate'}`}>{x.status}</span></td>
                      <td style={{ fontWeight: 700 }}>₹{x.total.toLocaleString('en-IN')}</td>
                      <td className="muted small">
                        {x.sent_at ? new Date(x.sent_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                          {x.invoice_number && (
                            <span className="badge badge-green">
                              Invoice · {x.invoiced_at ? new Date(x.invoiced_at).toLocaleDateString('en-IN') : x.invoice_number}
                            </span>
                          )}
                          <RowActions>
                            {(close) => (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    void openPreview(x)
                                    close()
                                  }}
                                >
                                  <FileText size={13} />
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    setRenamingQuotation(x)
                                    setRenameTitle(x.title ?? '')
                                    close()
                                  }}
                                >
                                  <Pencil size={13} />
                                  Rename
                                </button>
                                {!x.pdf_url ? (
                                  <>
                                    {quotationTemplates.length > 0 && (
                                      <select
                                        className="select"
                                        style={{ width: '100%', fontSize: '0.8rem' }}
                                        value={pdfTemplateByQuotation[x.id] ?? x.template_id ?? defaultTemplateId}
                                        onChange={(e) =>
                                          setPdfTemplateByQuotation((prev) => ({
                                            ...prev,
                                            [x.id]: e.target.value,
                                          }))
                                        }
                                      >
                                        {quotationTemplates.map((t) => (
                                          <option key={t.id} value={t.id}>
                                            {t.name}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      disabled={genPdf.isPending}
                                      onClick={() => {
                                        genPdf.mutate({
                                          id: x.id,
                                          template_id:
                                            pdfTemplateByQuotation[x.id] ?? x.template_id ?? defaultTemplateId,
                                        })
                                        close()
                                      }}
                                    >
                                      <FileText size={13} />
                                      Generate PDF
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => {
                                        downloadPdf(orgId, x.id, x.number, 'quotation')
                                        close()
                                      }}
                                    >
                                      <Download size={13} />
                                      Download Quotation
                                    </button>
                                    {x.invoice_number && (
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => {
                                          downloadPdf(orgId, x.id, x.invoice_number!, 'invoice')
                                          close()
                                        }}
                                      >
                                        <Download size={13} />
                                        Download Invoice
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      disabled={send.isPending || !x.lead_email}
                                      title={
                                        x.lead_email
                                          ? `Send quotation to ${x.lead_email}`
                                          : 'This lead has no email address'
                                      }
                                      onClick={() => {
                                        send.mutate({ id: x.id, channel: 'email' })
                                        close()
                                      }}
                                    >
                                      <Mail size={13} />
                                      {send.isPending
                                        ? 'Sending…'
                                        : x.status === 'SENT'
                                          ? 'Resend by email'
                                          : 'Email quotation'}
                                    </button>
                                  </>
                                )}
                                {canSend && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={send.isPending}
                                    onClick={() => {
                                      send.mutate({ id: x.id, channel: 'whatsapp' })
                                      close()
                                    }}
                                  >
                                    <MessageCircle size={13} />
                                    {send.isPending ? 'Sending…' : 'Send on WhatsApp'}
                                  </button>
                                )}
                                {!x.invoice_number && !!x.pdf_url && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={genInvoice.isPending}
                                    onClick={() => {
                                      genInvoice.mutate(x.id)
                                      close()
                                    }}
                                  >
                                    <FileText size={13} />
                                    {genInvoice.isPending ? 'Converting…' : 'Convert to invoice'}
                                  </button>
                                )}
                                {!x.invoice_number && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => {
                                      openEdit(x)
                                      close()
                                    }}
                                  >
                                    {x.pdf_url
                                      ? x.status === 'SENT'
                                        ? 'Edit & Resend'
                                        : 'Edit quotation'
                                      : 'Edit draft'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm btn-danger"
                                  disabled={deleteQuotation.isPending}
                                  onClick={() => {
                                    const label = x.invoice_number
                                      ? `invoice ${x.invoice_number}`
                                      : `quotation ${quotationDisplayName(x)}`
                                    if (
                                      window.confirm(`Delete ${label}? This cannot be undone.`)
                                    ) {
                                      deleteQuotation.mutate(x.id)
                                    }
                                    close()
                                  }}
                                >
                                  <Trash2 size={13} />
                                  Delete
                                </button>
                              </>
                            )}
                          </RowActions>
                          {rowStatus[x.id] && (
                            <span
                              className={`badge ${rowStatus[x.id].ok ? 'badge-green' : 'badge-red'}`}
                              title={rowStatus[x.id].detail ?? rowStatus[x.id].text}
                              onClick={() => clearRow(x.id)}
                              style={{
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              {rowStatus[x.id].ok && <Check size={12} />}
                              {rowStatus[x.id].text}
                            </span>
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
            <EmptyState
              icon={FileText}
              description="No quotations yet. Create one from a lead."
            />
          )
        )}

        <InsightGrid>
          <InsightCard title="Top items quoted">
            {(() => {
              const counts = new Map<string, number>()
              for (const qtn of quotations) {
                for (const line of qtn.lines ?? []) {
                  const name = line.description.trim() || 'Item'
                  counts.set(name, (counts.get(name) ?? 0) + Number(line.quantity || 0))
                }
              }
              const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
              return items.length === 0 ? (
                <p className="muted small">No items quoted yet. Start creating quotations to see item insights.</p>
              ) : (
                <div className="stack" style={{ gap: '0.4rem', fontSize: '0.82rem' }}>
                  {items.map(([name, qty]) => (
                    <div key={name} className="row spread">
                      <span>{name}</span>
                      <strong>{qty}</strong>
                    </div>
                  ))}
                </div>
              )
            })()}
          </InsightCard>
          <InsightCard title="Quotation value">
            {quotations.length === 0 ? (
              <p className="muted small">No quotation value yet.</p>
            ) : (
              <>
                <DonutChart
                  segments={[
                    { label: 'Draft', value: quotations.filter((x) => x.status === 'DRAFT').reduce((s, x) => s + Number(x.total), 0), color: '#64748b' },
                    { label: 'Sent', value: quotations.filter((x) => x.status === 'SENT').reduce((s, x) => s + Number(x.total), 0), color: '#f59e0b' },
                    { label: 'Accepted', value: quotations.filter((x) => x.status === 'ACCEPTED').reduce((s, x) => s + Number(x.total), 0), color: '#3D7A5A' },
                    { label: 'Rejected', value: quotations.filter((x) => x.status === 'REJECTED').reduce((s, x) => s + Number(x.total), 0), color: '#B42318' },
                  ]}
                  center={{ value: `₹${totalValue.toLocaleString('en-IN')}`, label: 'Total' }}
                />
                <DonutLegend
                  segments={[
                    { label: 'Draft', value: draftCount, color: '#64748b' },
                    { label: 'Sent', value: sentCount, color: '#f59e0b' },
                    { label: 'Accepted', value: acceptedCount, color: '#3D7A5A' },
                    { label: 'Rejected', value: rejectedCount, color: '#B42318' },
                  ]}
                  total={quotations.length}
                />
              </>
            )}
          </InsightCard>
          <InsightCard title="Quick actions">
            <div className="quick-action-list">
              <button type="button" onClick={() => setShowForm(true)}>
                <Plus size={14} /> New quotation
              </button>
              <Link to={routes.settings('documents')}>
                <FileText size={14} /> Quotation templates
              </Link>
            </div>
          </InsightCard>
        </InsightGrid>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="New quotation" size="lg">
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            submitCreate('finalize')
          }}
        >
          {quotationTemplates.length > 0 && (
            <div className="form-field">
              <label className="input-label">PDF template</label>
              <select
                className="select"
                value={templateId || defaultTemplateId}
                onChange={(e) => setTemplateId(e.target.value)}
                style={{ minWidth: 240 }}
              >
                {quotationTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-field">
            <label className="input-label">Lead *</label>
            {orgId && (
              <LeadSearchSelect
                orgId={orgId}
                value={leadId}
                required
                onChange={(id, lead) => {
                  setLeadId(id)
                  setSelectedLead(lead)
                }}
              />
            )}
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
                  <Link to={routes.settings('brand')}>Upload CSV in Brand assets</Link>
                </p>
              )}
            </div>

            <div className="stack" style={{ gap: '0.75rem' }}>
              {lines.map((line, i) => (
                <div key={i} className="stack surface-muted" style={{ gap: '0.35rem', padding: '0.5rem' }}>
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
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="submit" className="btn" disabled={create.isPending || !canSubmitForm()}>
              {create.isPending && create.variables === 'finalize' ? 'Creating…' : 'Create quotation'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={create.isPending || !canSubmitForm()}
              onClick={() => submitCreate('draft')}
            >
              {create.isPending && create.variables === 'draft' ? 'Saving…' : 'Save as draft'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={create.isPending} onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editingId} onClose={() => setEditingId(null)} title="Edit quotation" size="lg">
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (editLeadId && editLines.every((l) => l.description && l.unit_price)) void edit.mutateAsync()
          }}
        >
          <div className="form-field">
            <label className="input-label">Lead *</label>
            {orgId && (
              <LeadSearchSelect
                orgId={orgId}
                value={editLeadId}
                required
                onChange={(id) => setEditLeadId(id)}
              />
            )}
          </div>

          <div>
            <div className="input-label" style={{ marginBottom: '0.5rem' }}>Line items</div>
            <div className="stack" style={{ gap: '0.75rem' }}>
              {editLines.map((line, i) => (
                <div key={i} className="stack surface-muted" style={{ gap: '0.35rem', padding: '0.5rem' }}>
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
      </Modal>

      <Modal
        open={!!renamingQuotation}
        onClose={() => {
          setRenamingQuotation(null)
          setRenameTitle('')
        }}
        title="Rename quotation"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRenamingQuotation(null)
                setRenameTitle('')
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={renameQuotation.isPending || !renamingQuotation}
              onClick={() => {
                if (!renamingQuotation) return
                renameQuotation.mutate({ id: renamingQuotation.id, title: renameTitle })
              }}
            >
              {renameQuotation.isPending ? 'Saving…' : 'Save name'}
            </button>
          </>
        }
      >
        {renamingQuotation && (
          <div className="stack" style={{ gap: '0.75rem' }}>
            <p className="muted small">
              Document number <strong>{renamingQuotation.number}</strong> stays the same. This name is only for
              your list.
            </p>
            <div className="form-field">
              <label className="input-label" htmlFor="quotation-rename-title">
                Display name
              </label>
              <input
                id="quotation-rename-title"
                className="input"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                placeholder={renamingQuotation.number}
                maxLength={200}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renamingQuotation) {
                    e.preventDefault()
                    renameQuotation.mutate({ id: renamingQuotation.id, title: renameTitle })
                  }
                }}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!previewQuotation}
        onClose={closePreview}
        title={
          previewQuotation
            ? `${quotationDisplayName(previewQuotation)}${
                previewQuotation.title ? ` · ${previewQuotation.number}` : ''
              }`
            : 'Preview'
        }
        size="xl"
        footer={
          previewQuotation ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={closePreview}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (!previewQuotation || !orgId) return
                  void downloadPdf(
                    orgId,
                    previewQuotation.id,
                    previewQuotation.invoice_number ?? previewQuotation.number,
                    previewQuotation.invoice_number ? 'invoice' : 'quotation',
                  )
                }}
              >
                <Download size={14} />
                Download
              </button>
            </>
          ) : undefined
        }
      >
        {previewLoading && <p className="muted" style={{ padding: '1.5rem' }}>Loading preview…</p>}
        {previewError && <p className="error" style={{ padding: '1.5rem' }}>{previewError}</p>}
        {!previewLoading && !previewError && previewUrl && (
          <iframe
            title="Quotation preview"
            src={previewUrl}
            className="quotation-preview-frame"
          />
        )}
      </Modal>
    </>
  )
}
