import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Pencil, Save, Send, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { apiFetch, apiFetchBlob } from '../lib/api'
import { routes } from '../lib/appRoutes'

type QuotationLine = {
  id?: string
  description: string
  quantity: number
  unit_price: number
  line_total?: number
}

type QuotationDetail = {
  id: string
  number: string
  title: string | null
  status: string
  lead_id: string
  lead_title?: string | null
  lead_email?: string | null
  lead_phone?: string | null
  pdf_url: string | null
  invoice_number?: string | null
  notes?: string | null
  terms?: string | null
  total?: number
  lines?: QuotationLine[]
}

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
  const { orgId } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(searchParams.get('edit') === '1')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [lines, setLines] = useState<QuotationLine[]>([])

  const detailQ = useQuery({
    queryKey: ['quotation-doc', orgId, quotationId],
    enabled: !!orgId && !!quotationId,
    queryFn: () => apiFetch<QuotationDetail>(`/v1/orgs/${orgId}/quotations/${quotationId}`),
  })

  const doc = detailQ.data
  const [syncedDocId, setSyncedDocId] = useState<string | null>(null)

  // Sync local edit draft when a different document loads (React-recommended render-time reset).
  if (doc && doc.id !== syncedDocId) {
    setSyncedDocId(doc.id)
    setTitle(doc.title ?? '')
    setLines(
      (doc.lines ?? []).map((l) => ({
        id: l.id,
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
      })),
    )
  }

  useEffect(() => {
    let revoked: string | null = null
    async function loadPreview() {
      if (!orgId || !quotationId || !doc?.pdf_url) {
        setPreviewUrl(null)
        return
      }
      setPreviewError(null)
      try {
        const blob = await apiFetchBlob(
          `/v1/orgs/${orgId}/quotations/${quotationId}/pdf-file${
            mode === 'invoice' || doc.invoice_number ? '?doc_type=invoice' : ''
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
  }, [orgId, quotationId, doc?.pdf_url, doc?.invoice_number, mode, detailQ.dataUpdatedAt])

  const runningTotal = useMemo(
    () => lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_price || 0), 0),
    [lines],
  )

  const save = useMutation({
    mutationFn: () =>
      Promise.all([
        apiFetch(`/v1/orgs/${orgId}/quotations/${quotationId}`, {
          method: 'PATCH',
          json: {
            lead_id: doc!.lead_id,
            lines: lines.map((l) => ({
              description: l.description,
              quantity: Number(l.quantity),
              unit_price: Number(l.unit_price),
            })),
          },
        }),
        apiFetch(`/v1/orgs/${orgId}/quotations/${quotationId}/title`, {
          method: 'PATCH',
          json: { title: title || '' },
        }),
      ]),
    onSuccess: async () => {
      toast.success('Document saved')
      await qc.invalidateQueries({ queryKey: ['quotation-doc', orgId, quotationId] })
      await qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      setEditing(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const generatePdf = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${quotationId}/generate-pdf`, {
        method: 'POST',
        json: { doc_type: mode === 'invoice' || doc?.invoice_number ? 'invoice' : 'quotation' },
      }),
    onSuccess: async () => {
      toast.success('PDF updated')
      await qc.invalidateQueries({ queryKey: ['quotation-doc', orgId, quotationId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const send = useMutation({
    mutationFn: (channel: 'whatsapp' | 'email') =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${quotationId}/send`, {
        method: 'POST',
        json: {
          channel,
          doc_type: mode === 'invoice' || doc?.invoice_number ? 'invoice' : 'quotation',
        },
      }),
    onSuccess: (_d, channel) => toast.success(`Sent via ${channel}`),
    onError: (err: Error) => toast.error(err.message),
  })

  async function downloadPdf() {
    if (!orgId || !quotationId || !doc) return
    try {
      const blob = await apiFetchBlob(
        `/v1/orgs/${orgId}/quotations/${quotationId}/pdf-file${
          mode === 'invoice' || doc.invoice_number ? '?doc_type=invoice' : ''
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

  const fallbackBack =
    backTo ??
    (mode === 'invoice' ? routes.money('invoices') : routes.money('quotations'))

  if (!orgId) return <p className="muted">Select an organization.</p>
  if (detailQ.isLoading) return <p className="muted" style={{ padding: '1.5rem' }}>Loading document…</p>
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

  return (
    <div className="doc-workspace">
      <header className="doc-workspace-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(fallbackBack)}>
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="doc-workspace-title">
          <strong>
            {mode === 'invoice' || doc.invoice_number
              ? `Invoice ${doc.invoice_number ?? doc.number}`
              : `Quotation ${doc.number}`}
          </strong>
          <span className="muted small">
            {doc.lead_title ?? 'Lead'} · {doc.status}
          </span>
        </div>
        <div className="doc-workspace-actions">
          {!editing ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Edit
            </button>
          ) : (
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
        </div>
      </header>

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
                  Add line
                </button>
              </div>
              <p className="muted small">Running total: ₹{runningTotal.toLocaleString('en-IN')}</p>
            </div>
            <p className="muted small">
              Save, then Update PDF to refresh the preview with your changes.
            </p>
          </section>
        )}

        <section className="doc-workspace-preview">
          {!doc.pdf_url && (
            <div className="empty-state">
              <p>No PDF yet. Click Update PDF to generate one.</p>
            </div>
          )}
          {previewError && <p className="error">{previewError}</p>}
          {previewUrl && (
            <iframe title="Document preview" src={previewUrl} className="doc-workspace-frame" />
          )}
        </section>
      </div>
    </div>
  )
}
