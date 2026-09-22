import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, History, Pencil, Save, Send, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { apiFetch, apiFetchBlob } from '../lib/api'
import { routes } from '../lib/appRoutes'
import {
  GST_PRESETS,
  computeDocumentTotals,
  type DocVersion,
  type QuotationDoc,
} from '../lib/documents'
import { fmtINR } from '../lib/format'
import { isOwnerRole, membershipForOrg } from '../lib/membership'

/**
 * Full-screen quotation / invoice document workspace.
 * Same records as Sales → Quotes and Money → Quotations/Invoices.
 */
export function DocumentWorkspacePage({
  mode = 'quotation',
  backTo,
}: {
  mode?: 'quotation' | 'invoice'
  backTo?: string
}) {
  const { quotationId } = useParams()
  const { orgId, me } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership) || !!me?.is_super_admin
  const [editing, setEditing] = useState(searchParams.get('edit') === '1')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [lines, setLines] = useState<
    Array<{ id?: string; description: string; quantity: number; unit_price: number }>
  >([])
  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxRate, setTaxRate] = useState('18')
  const [showVersions, setShowVersions] = useState(false)
  const [viewingVersion, setViewingVersion] = useState<DocVersion | null>(null)

  const detailQ = useQuery({
    queryKey: ['quotation-doc', orgId, quotationId],
    enabled: !!orgId && !!quotationId,
    queryFn: () => apiFetch<QuotationDoc>(`/v1/orgs/${orgId}/quotations/${quotationId}`),
  })

  const doc = detailQ.data
  const [syncedDocKey, setSyncedDocKey] = useState<string | null>(null)
  const isInvoice = mode === 'invoice' || !!doc?.invoice_number
  const isHistorical = viewingVersion != null && !viewingVersion.is_current

  const docSyncKey = doc
    ? `${doc.id}:${doc.version}:${doc.updated_at ?? ''}:${(doc.lines ?? []).map((l) => `${l.id}-${l.description}-${l.quantity}`).join('|')}`
    : null

  if (doc && docSyncKey && docSyncKey !== syncedDocKey) {
    setSyncedDocKey(docSyncKey)
    setTitle(doc.title ?? '')
    setLines(
      (doc.lines ?? []).map((l) => ({
        id: l.id,
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
      })),
    )
    setTaxEnabled(!!doc.tax_enabled)
    setTaxRate(doc.tax_rate != null ? String(doc.tax_rate) : '18')
    setViewingVersion(null)
  }

  const liveTotals = useMemo(
    () =>
      computeDocumentTotals({
        lines,
        taxEnabled,
        taxRate: taxRate === '' ? 0 : Number(taxRate),
      }),
    [lines, taxEnabled, taxRate],
  )

  const displayTotals = isHistorical && viewingVersion
    ? {
        subtotal: viewingVersion.subtotal,
        tax: viewingVersion.tax,
        total: viewingVersion.total,
        taxRate: viewingVersion.tax_rate,
        taxEnabled: viewingVersion.tax_enabled,
      }
    : {
        subtotal: liveTotals.subtotal,
        tax: liveTotals.tax,
        total: liveTotals.total,
        taxRate: liveTotals.taxRate,
        taxEnabled,
      }

  useEffect(() => {
    let revoked: string | null = null
    async function loadPreview() {
      if (!orgId || !quotationId || !doc?.pdf_url || isHistorical) {
        setPreviewUrl(null)
        return
      }
      setPreviewError(null)
      try {
        const blob = await apiFetchBlob(
          `/v1/orgs/${orgId}/quotations/${quotationId}/pdf-file${
            isInvoice ? '?variant=invoice' : '?variant=quotation'
          }`,
        )
        const url = URL.createObjectURL(blob)
        revoked = url
        setPreviewUrl(url)
      } catch (err) {
        setPreviewError((err as Error).message || 'Failed to load PDF')
        setPreviewUrl(null)
      }
    }
    void loadPreview()
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [orgId, quotationId, doc?.pdf_url, isInvoice, detailQ.dataUpdatedAt, isHistorical])

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ message?: string; version?: number }>(
        `/v1/orgs/${orgId}/quotations/${quotationId}`,
        {
          method: 'PATCH',
          json: {
            lead_id: doc!.lead_id,
            title: title || null,
            tax_enabled: taxEnabled,
            tax_rate: taxEnabled ? Number(taxRate || 0) : null,
            lines: lines.map((l) => ({
              description: l.description,
              quantity: Number(l.quantity),
              unit_price: Number(l.unit_price),
            })),
          },
        },
      ),
    onSuccess: async (data) => {
      toast.success(data.message || 'Document saved')
      await qc.invalidateQueries({ queryKey: ['quotation-doc', orgId, quotationId] })
      await qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      await qc.invalidateQueries({ queryKey: ['invoices', orgId] })
      setEditing(false)
      setViewingVersion(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const generatePdf = useMutation({
    mutationFn: () =>
      apiFetch<{ status: string; pdf_url?: string }>(
        `/v1/orgs/${orgId}/quotations/${quotationId}/generate-pdf`,
        {
          method: 'POST',
          json: {},
        },
      ),
    onSuccess: async () => {
      toast.success('PDF ready')
      await qc.invalidateQueries({ queryKey: ['quotation-doc', orgId, quotationId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // Auto-build preview when a document opens without a PDF (or after save clears it).
  const autoPdfTried = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!orgId || !quotationId || !doc || isHistorical || editing) return
    if (doc.pdf_url) return
    const key = `${doc.id}:${doc.updated_at ?? doc.version ?? ''}`
    if (autoPdfTried.current.has(key) || generatePdf.isPending) return
    autoPdfTried.current.add(key)
    generatePdf.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, quotationId, doc?.id, doc?.pdf_url, doc?.updated_at, doc?.version, isHistorical, editing])

  const send = useMutation({
    mutationFn: (channel: 'whatsapp' | 'email') =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${quotationId}/send`, {
        method: 'POST',
        json: {
          channel,
          doc_type: isInvoice ? 'invoice' : 'quotation',
        },
      }),
    onSuccess: async (_d, channel) => {
      toast.success(`Sent via ${channel}`)
      await qc.invalidateQueries({ queryKey: ['quotation-doc', orgId, quotationId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const createInvoice = useMutation({
    mutationFn: () =>
      apiFetch<{ quotation_id?: string; id?: string; invoice_number: string }>(
        `/v1/orgs/${orgId}/quotations/${quotationId}/generate-invoice`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      const id = data.quotation_id || data.id
      toast.success(`Invoice ${data.invoice_number} created`)
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
      if (id) navigate(routes.moneyInvoiceDoc(id))
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function downloadPdf() {
    if (!orgId || !quotationId || !doc) return
    try {
      const blob = await apiFetchBlob(
        `/v1/orgs/${orgId}/quotations/${quotationId}/pdf-file${
          isInvoice ? '?variant=invoice' : '?variant=quotation'
        }`,
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${doc.invoice_number || doc.number}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function openVersion(v: DocVersion) {
    if (v.is_current || v.version_number === doc?.version) {
      setViewingVersion(null)
      setShowVersions(false)
      return
    }
    if (!orgId || !quotationId) return
    try {
      const full = await apiFetch<DocVersion>(
        `/v1/orgs/${orgId}/quotations/${quotationId}/versions/${v.version_number}`,
      )
      setViewingVersion({ ...full, is_current: false })
      setShowVersions(false)
      setEditing(false)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const fallbackBack =
    backTo ??
    (isInvoice
      ? routes.moneyInvoices(doc?.lead_id)
      : routes.moneyQuotations(doc?.lead_id))

  if (!orgId) return <p className="muted">Select an organization.</p>
  if (detailQ.isLoading) {
    return <p className="muted" style={{ padding: '1.5rem' }}>Loading document…</p>
  }
  if (detailQ.error || !doc) {
    return (
      <div className="page-body">
        <p className="error">{(detailQ.error as Error)?.message ?? 'Document not found'}</p>
        <Link to={fallbackBack} className="btn btn-ghost">
          Back
        </Link>
      </div>
    )
  }

  const versions = doc.versions ?? []
  const canEdit = !isHistorical && (isInvoice ? isOwner : true)
  const canCreateInvoice = isOwner && !isInvoice && !doc.invoice_number && !doc.linked_invoice_id && doc.status !== 'INVOICED'
  const linkedInvoiceId = doc.linked_invoice_id ?? null

  return (
    <div className="doc-workspace">
      <header className="doc-workspace-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(fallbackBack)}>
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="doc-workspace-title">
          <strong>
            {isInvoice
              ? `Invoice ${doc.invoice_number ?? doc.number}`
              : `Quotation ${doc.number}`}
          </strong>
          <span className="muted small">
            {doc.lead_title ?? 'Lead'} · {doc.status} · V{doc.version}
            {isHistorical && viewingVersion
              ? ` · viewing V${viewingVersion.version_number}`
              : ''}
          </span>
          {doc.source_quotation_id && (
            <span className="muted small">
              Based on{' '}
              <Link
                to={routes.moneyQuotationDoc(doc.source_quotation_id)}
                className="link-button"
              >
                {doc.source_quotation_number || 'Quotation'}
                {doc.source_quotation_version != null
                  ? ` · V${doc.source_quotation_version}`
                  : ''}
              </Link>
            </span>
          )}
        </div>
        <div className="doc-workspace-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowVersions((v) => !v)}
          >
            <History size={14} />
            Version {doc.version}
          </button>
          {isHistorical && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setViewingVersion(null)}
            >
              Back to current
            </button>
          )}
          {canEdit && !editing ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Edit
            </button>
          ) : null}
          {editing && (
            <>
              <button
                type="button"
                className="btn btn-sm"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                <Save size={14} />
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                <X size={14} />
                Cancel
              </button>
            </>
          )}
          {canCreateInvoice && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={createInvoice.isPending}
              onClick={() => createInvoice.mutate()}
            >
              {createInvoice.isPending ? 'Creating…' : 'Create invoice'}
            </button>
          )}
          {!isInvoice && linkedInvoiceId && (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => navigate(routes.moneyInvoiceDoc(linkedInvoiceId))}
            >
              Open invoice
            </button>
          )}
          {!isHistorical && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={generatePdf.isPending}
                onClick={() => generatePdf.mutate()}
              >
                {generatePdf.isPending ? 'Building PDF…' : 'Update PDF'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!doc.pdf_url}
                onClick={() => void downloadPdf()}
              >
                <Download size={14} />
                Download
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!doc.pdf_url || send.isPending}
                onClick={() => send.mutate('whatsapp')}
              >
                <Send size={14} />
                WhatsApp
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!doc.pdf_url || send.isPending}
                onClick={() => send.mutate('email')}
              >
                <Send size={14} />
                Email
              </button>
            </>
          )}
        </div>
      </header>

      {showVersions && (
        <div className="drawer-overlay" onClick={() => setShowVersions(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <strong>Version history</strong>
            <div className="stack" style={{ gap: '0.5rem', marginTop: '0.75rem' }}>
              {versions.length === 0 && (
                <p className="muted small">No version history yet.</p>
              )}
              {versions.map((v) => (
                <button
                  key={`${v.version_number}-${v.id}`}
                  type="button"
                  className="card"
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => void openVersion(v)}
                >
                  <div className="row spread">
                    <strong>V{v.version_number}</strong>
                    {v.is_current || v.version_number === doc.version ? (
                      <span className="badge badge-green">Current</span>
                    ) : (
                      <span className="badge badge-slate">Historical</span>
                    )}
                  </div>
                  <p className="muted small" style={{ margin: '0.2rem 0 0' }}>
                    {v.created_at
                      ? new Date(v.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—'}
                    {v.note ? ` · ${v.note}` : ''}
                  </p>
                  <p className="muted small" style={{ margin: '0.15rem 0 0' }}>
                    {fmtINR(v.total)}
                    {v.tax_enabled && v.tax_rate != null ? ` · GST ${v.tax_rate}%` : ''}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={`doc-workspace-body${editing ? ' editing' : ''}`}>
        {editing && (
          <section className="doc-workspace-editor stack" style={{ gap: '0.75rem' }}>
            <div className="form-field">
              <label className="input-label">Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="input-label">Line items</label>
              <div className="stack" style={{ gap: '0.4rem' }}>
                {lines.map((line, idx) => (
                  <div key={line.id ?? idx} className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      style={{ flex: '2 1 180px' }}
                      value={line.description}
                      onChange={(e) => {
                        const next = [...lines]
                        next[idx] = { ...line, description: e.target.value }
                        setLines(next)
                      }}
                      placeholder="Description"
                    />
                    <input
                      className="input"
                      style={{ width: 80 }}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) => {
                        const next = [...lines]
                        next[idx] = { ...line, quantity: Number(e.target.value) }
                        setLines(next)
                      }}
                    />
                    <input
                      className="input"
                      style={{ width: 110 }}
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unit_price}
                      onChange={(e) => {
                        const next = [...lines]
                        next[idx] = { ...line, unit_price: Number(e.target.value) }
                        setLines(next)
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setLines([...lines, { description: '', quantity: 1, unit_price: 0 }])
                  }
                >
                  + Add line
                </button>
              </div>
            </div>

            <div className="card stack" style={{ gap: '0.55rem' }}>
              <strong style={{ fontSize: '0.88rem' }}>GST</strong>
              <label className="row small" style={{ gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={taxEnabled}
                  onChange={(e) => setTaxEnabled(e.target.checked)}
                />
                Enable GST
              </label>
              {taxEnabled && (
                <>
                  <div className="form-field" style={{ margin: 0 }}>
                    <label className="input-label">GST rate (%)</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                    />
                  </div>
                  <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                    {GST_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setTaxRate(String(p))}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="card stack" style={{ gap: '0.25rem' }}>
              <div className="row spread small">
                <span className="muted">Subtotal</span>
                <strong>{fmtINR(displayTotals.subtotal)}</strong>
              </div>
              {displayTotals.taxEnabled && (
                <div className="row spread small">
                  <span className="muted">
                    GST{displayTotals.taxRate != null ? ` (${displayTotals.taxRate}%)` : ''}
                  </span>
                  <strong>{fmtINR(displayTotals.tax)}</strong>
                </div>
              )}
              <div className="row spread">
                <strong>Grand total</strong>
                <strong>{fmtINR(displayTotals.total)}</strong>
              </div>
            </div>
          </section>
        )}

        <section className="doc-workspace-preview">
          {isHistorical && viewingVersion ? (
            <div className="card stack" style={{ gap: '0.75rem' }}>
              <div className="row spread">
                <strong>Historical V{viewingVersion.version_number}</strong>
                <span className="badge badge-slate">Read-only</span>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {viewingVersion.note || 'Snapshot'} ·{' '}
                {viewingVersion.created_at
                  ? new Date(viewingVersion.created_at).toLocaleString()
                  : ''}
              </p>
              <div className="stack" style={{ gap: '0.3rem' }}>
                {(viewingVersion.lines ?? []).map((l, i) => (
                  <div key={i} className="row spread small">
                    <span>
                      {l.description} × {l.quantity}
                    </span>
                    <span>{fmtINR(l.line_total ?? l.quantity * l.unit_price)}</span>
                  </div>
                ))}
              </div>
              <div className="stack" style={{ gap: '0.2rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                <div className="row spread small">
                  <span className="muted">Subtotal</span>
                  <span>{fmtINR(viewingVersion.subtotal)}</span>
                </div>
                {viewingVersion.tax_enabled && (
                  <div className="row spread small">
                    <span className="muted">
                      GST{viewingVersion.tax_rate != null ? ` (${viewingVersion.tax_rate}%)` : ''}
                    </span>
                    <span>{fmtINR(viewingVersion.tax)}</span>
                  </div>
                )}
                <div className="row spread">
                  <strong>Total</strong>
                  <strong>{fmtINR(viewingVersion.total)}</strong>
                </div>
              </div>
            </div>
          ) : previewUrl ? (
            <iframe title="Document preview" src={previewUrl} className="doc-workspace-frame" />
          ) : (
            <div className="card stack" style={{ gap: '0.75rem', margin: '1.5rem', maxWidth: 420 }}>
              <p className="muted" style={{ margin: 0 }}>
                {previewError ||
                  (generatePdf.isPending
                    ? 'Building PDF preview…'
                    : 'No PDF yet — click Update PDF to generate a preview.')}
              </p>
              {!previewError && !generatePdf.isPending && (
                <button type="button" className="btn" onClick={() => generatePdf.mutate()}>
                  Update PDF
                </button>
              )}
              <div className="stack" style={{ gap: '0.2rem' }}>
                <div className="row spread small">
                  <span className="muted">Subtotal</span>
                  <span>{fmtINR(displayTotals.subtotal)}</span>
                </div>
                {displayTotals.taxEnabled && (
                  <div className="row spread small">
                    <span className="muted">
                      GST{displayTotals.taxRate != null ? ` (${displayTotals.taxRate}%)` : ''}
                    </span>
                    <span>{fmtINR(displayTotals.tax)}</span>
                  </div>
                )}
                <div className="row spread">
                  <strong>Grand total</strong>
                  <strong>{fmtINR(displayTotals.total)}</strong>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
