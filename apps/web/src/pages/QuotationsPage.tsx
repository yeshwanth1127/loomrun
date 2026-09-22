import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, FileText, Plus, ShieldCheck, TrendingUp } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { routes } from '../lib/appRoutes'
import { apiFetch } from '../lib/api'
import { LeadSearchSelect, type LeadOption } from '../components/LeadSearchSelect'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { DonutChart, DonutLegend, InsightCard, InsightGrid, MetricCard } from '../components/ui/dashboard'
import { toast } from 'sonner'
import { groupDocsByLead, type QuotationDoc } from '../lib/documents'
import { fmtINR } from '../lib/format'

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
  version?: number
  status: string
  total: number
  subtotal?: number
  tax?: number
  tax_enabled?: boolean
  tax_rate?: number | null
  lead_id: string
  lead_title: string | null
  lead_phone: string | null
  lead_email: string | null
  lead_company?: string | null
  pdf_url: string | null
  template_id: string | null
  sent_at: string | null
  invoiced_at: string | null
  created_at?: string | null
  updated_at?: string | null
  source_quotation_id?: string | null
  source_quotation_version?: number | null
  source_quotation_number?: string | null
  linked_invoice_id?: string | null
  linked_invoice_number?: string | null
  linked_invoices?: Array<{ id: string; invoice_number: string | null }>
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
  INVOICED: 'badge-indigo',
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
  const [searchParams, setSearchParams] = useSearchParams()
  const focusLeadId = searchParams.get('leadId')
  const [search, setSearch] = useState('')
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
    const params = new URLSearchParams(searchParams)
    params.set('leadId', state.leadId)
    const openForm = !!state.openForm
    // Defer React state updates so the effect only syncs the URL/router.
    queueMicrotask(() => {
      setLeadId(state.leadId!)
      if (openForm) setShowForm(true)
    })
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true, state: null })
  }, [location, navigate, searchParams])

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
  // Inline row status was removed with the lead-centric list; keep a no-op for mutation callbacks.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept for call sites
  const markRow = (..._args: unknown[]) => undefined

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
        toast.success(`Quotation ${created.number} created`)
      } else {
        toast.success(`Draft ${created.number} saved`)
      }
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      navigate(routes.moneyQuotationDoc(created.id))
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
      apiFetch<{
        invoice_number: string
        quotation_id?: string
        id?: string
      }>(`/v1/orgs/${orgId}/quotations/${id}/generate-invoice`, { method: 'POST' }),
    onSuccess: (data, id) => {
      const invoiceId = data.quotation_id || data.id
      markRow(id, `Invoice ${data.invoice_number} created`)
      toast.success(`Invoice ${data.invoice_number} created`)
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
      if (invoiceId) navigate(routes.moneyInvoiceDoc(invoiceId))
    },
    onError: (err: Error, id) => {
      markRow(id, err.message || 'Convert failed', false)
      toast.error(err.message)
    },
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
  const searchLower = search.trim().toLowerCase()
  const filteredQuotations = quotations.filter((x) => {
    if (focusLeadId && x.lead_id !== focusLeadId) return false
    if (!searchLower) return true
    const hay = [
      x.lead_title,
      x.lead_company,
      x.number,
      x.title,
      x.lead_phone,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(searchLower)
  })
  const leadGroups = groupDocsByLead(filteredQuotations as QuotationDoc[])
  const focusLead = focusLeadId
    ? leadGroups.find((g) => g.leadId === focusLeadId) ||
      (filteredQuotations[0]
        ? {
            leadId: focusLeadId,
            leadTitle: filteredQuotations[0].lead_title || 'Lead',
            leadCompany: filteredQuotations[0].lead_company ?? null,
            count: filteredQuotations.length,
            latestAt: null,
            totalValue: filteredQuotations.reduce((s, d) => s + d.total, 0),
            docs: filteredQuotations as QuotationDoc[],
          }
        : null)
    : null
  const leads = leadsQ.data?.items ?? []
  const draftCount = quotations.filter((x) => x.status === 'DRAFT').length
  const sentCount = quotations.filter((x) => x.status === 'SENT').length
  const acceptedCount = quotations.filter((x) => x.status === 'ACCEPTED').length
  const invoicedCount = quotations.filter((x) => x.status === 'INVOICED').length
  const rejectedCount = quotations.filter((x) => x.status === 'REJECTED').length

  function openLeadQuotes(leadIdValue: string) {
    const params = new URLSearchParams(searchParams)
    params.set('leadId', leadIdValue)
    setSearchParams(params)
  }

  function clearLeadFocus() {
    const params = new URLSearchParams(searchParams)
    params.delete('leadId')
    setSearchParams(params)
  }

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
        title={focusLead ? focusLead.leadTitle : 'Quotations'}
        badge={
          focusLead
            ? `${focusLead.count} quotation${focusLead.count === 1 ? '' : 's'}`
            : `${quotations.length} total`
        }
        description={
          focusLead
            ? 'Quotations for this customer. Open one to edit, version, or create an invoice.'
            : 'Organised by customer — open a lead to manage their quotations.'
        }
        actions={
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            {focusLead && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearLeadFocus}>
                <ArrowLeft size={14} />
                Back
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (focusLeadId) {
                  setLeadId(focusLeadId)
                  const lead = leads.find((l) => l.id === focusLeadId)
                  if (lead) {
                    setSelectedLead({
                      id: lead.id,
                      title: lead.title,
                      phone: lead.phone,
                      email: lead.email,
                      company: lead.company,
                    })
                  }
                }
                setShowForm(true)
              }}
            >
              <Plus size={15} />
              New quotation
            </button>
          </div>
        }
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {!focusLead && (
          <>
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
                <span className="status-strip-dot paid" aria-hidden />
                Accepted <strong>{acceptedCount}</strong>
              </span>
              <span className="status-strip-item">
                <span className="status-strip-dot invoiced" aria-hidden />
                Invoiced <strong>{invoicedCount}</strong>
              </span>
              <span className="status-strip-item">
                <span className="status-strip-dot rejected" aria-hidden />
                Rejected <strong>{rejectedCount}</strong>
              </span>
            </div>

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
                        { label: 'Invoiced', value: quotations.filter((x) => x.status === 'INVOICED').reduce((s, x) => s + Number(x.total), 0), color: '#0F766E' },
                        { label: 'Rejected', value: quotations.filter((x) => x.status === 'REJECTED').reduce((s, x) => s + Number(x.total), 0), color: '#B42318' },
                      ]}
                      center={{ value: `₹${totalValue.toLocaleString('en-IN')}`, label: 'Total' }}
                    />
                    <DonutLegend
                      segments={[
                        { label: 'Draft', value: draftCount, color: '#64748b' },
                        { label: 'Sent', value: sentCount, color: '#f59e0b' },
                        { label: 'Accepted', value: acceptedCount, color: '#3D7A5A' },
                        { label: 'Invoiced', value: invoicedCount, color: '#0F766E' },
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
          </>
        )}

        <div className="form-field" style={{ margin: 0, maxWidth: 420 }}>
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads or quotations…"
          />
        </div>

        {q.isLoading && <p className="muted">Loading quotations…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {!focusLead && !q.isLoading && leadGroups.length === 0 && (
          <EmptyState
            icon={FileText}
            title="No quotations yet"
            description="Create a quotation for a customer to get started."
          />
        )}

        {!focusLead && leadGroups.length > 0 && (
          <div className="stack" style={{ gap: '0.65rem' }}>
            {leadGroups.map((g) => (
              <button
                key={g.leadId}
                type="button"
                className="card lead-doc-group"
                onClick={() => openLeadQuotes(g.leadId)}
                style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
              >
                <div className="row spread" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div>
                    <strong style={{ fontSize: '1rem' }}>{g.leadTitle}</strong>
                    {g.leadCompany && (
                      <p className="muted small" style={{ margin: '0.15rem 0 0' }}>
                        {g.leadCompany}
                      </p>
                    )}
                  </div>
                  <div className="stack" style={{ gap: '0.15rem', alignItems: 'flex-end' }}>
                    <span className="muted small">
                      {g.count} quotation{g.count === 1 ? '' : 's'}
                    </span>
                    <span className="muted small">
                      Latest:{' '}
                      {g.latestAt
                        ? new Date(g.latestAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {focusLead && (
          <div className="stack" style={{ gap: '0.75rem' }}>
            {focusLead.leadCompany && (
              <p className="muted small" style={{ margin: 0 }}>
                {focusLead.leadCompany}
              </p>
            )}
            <strong style={{ fontSize: '0.88rem' }}>Quotations</strong>
            {filteredQuotations.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No quotations for this lead"
                description="Create the first quotation for this customer."
              />
            ) : (
              filteredQuotations.map((x) => (
                <div key={x.id} className="card">
                  <div className="row spread" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div className="stack" style={{ gap: '0.2rem', minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <strong>{x.number}</strong>
                        <span className={`badge ${STATUS_COLOR[x.status] ?? 'badge-slate'}`}>
                          {x.status}
                        </span>
                        <span className="badge badge-slate">Version {x.version ?? 1}</span>
                      </div>
                      <span className="muted small">
                        {quotationDisplayName(x)}
                        {x.tax_enabled && x.tax_rate != null
                          ? ` · GST ${x.tax_rate}%`
                          : ''}
                      </span>
                      <strong>{fmtINR(x.total)}</strong>
                    </div>
                    <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void openPreview(x)}
                      >
                        Open
                      </button>
                      {!x.invoice_number && (x.linked_invoice_id || x.status === 'INVOICED') ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => {
                            if (x.linked_invoice_id) {
                              navigate(routes.moneyInvoiceDoc(x.linked_invoice_id))
                            }
                          }}
                          disabled={!x.linked_invoice_id}
                        >
                          Open invoice
                        </button>
                      ) : !x.invoice_number ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={genInvoice.isPending}
                          onClick={() => genInvoice.mutate(x.id)}
                        >
                          Create invoice
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
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
