import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, IndianRupee, Mail, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link , useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { DonutChart, DonutLegend, InsightCard, InsightGrid, MetricCard } from '../components/ui/dashboard'
import { apiFetch } from '../lib/api'
import { routes } from '../lib/appRoutes'
import { RowActions } from '../components/RowActions'
import { toast } from 'sonner'

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type Invoice = {
  id: string
  number: string
  title: string | null
  invoice_number: string
  status: string
  total: number
  lead_id: string
  lead_title: string | null
  lead_phone: string | null
  lead_email: string | null
  pdf_url: string | null
  sent_at: string | null
  invoiced_at: string | null
  lines: { description: string; quantity: number; unit_price: number; line_total: number }[]
}

function invoiceDisplayName(inv: Pick<Invoice, 'title' | 'invoice_number'>) {
  return inv.title?.trim() || inv.invoice_number
}

async function fetchPdfBlob(
  orgId: string,
  quotationId: string,
  variant: 'quotation' | 'invoice',
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
  variant: 'quotation' | 'invoice',
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

export function InvoicesPage() {
  const navigate = useNavigate()
  const { orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [renamingInvoice, setRenamingInvoice] = useState<Invoice | null>(null)
  const [renameTitle, setRenameTitle] = useState('')

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const q = useQuery({
    queryKey: ['invoices', orgId, dayParam],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      params.set('doc', 'invoice')
      return apiFetch<{ items: Invoice[] }>(`/v1/orgs/${orgId}/quotations?${params}`)
    },
  })

  const deleteInvoice = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Deleted')
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete'),
  })

  const sendEmail = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ message?: string }>(`/v1/orgs/${orgId}/quotations/${id}/send`, {
        method: 'POST',
        json: { channel: 'email', doc_type: 'invoice' },
      }),
    onSuccess: (data) => {
      toast.success(data.message ?? 'Email sent')
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to send email'),
  })

  const sendWhatsApp = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ message?: string }>(`/v1/orgs/${orgId}/quotations/${id}/send`, {
        method: 'POST',
        json: { channel: 'whatsapp', doc_type: 'invoice' },
      }),
    onSuccess: (data) => {
      toast.success(data.message ?? 'Sent on WhatsApp')
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to send on WhatsApp'),
  })

  const renameInvoice = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiFetch<Invoice>(`/v1/orgs/${orgId}/quotations/${id}/title`, {
        method: 'PATCH',
        json: { title },
      }),
    onSuccess: (data) => {
      toast.success(data.title ? `Renamed to “${data.title}”` : 'Name cleared')
      setRenamingInvoice(null)
      setRenameTitle('')
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to rename'),
  })

  async function openPreview(invoice: Invoice) {
    navigate(routes.moneyInvoiceDoc(invoice.id))
  }


  function closePreview() {
    setPreviewInvoice(null)
    setPreviewError(null)
    setPreviewLoading(false)
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreviewUrl(null)
  }

  if (!orgId) return (
    <PageHeader title="Invoices" description="Select an organization." />
  )

  const invoices = q.data?.items ?? []
  const totalAmount = invoices.reduce((s, x) => s + (Number(x.total) || 0), 0)
  const paidCount = invoices.filter((x) => x.status === 'ACCEPTED' || x.status === 'PAID').length
  const pendingCount = invoices.length - paidCount
  const byClient = new Map<string, number>()
  for (const inv of invoices) {
    const name = inv.lead_title ?? 'Unknown'
    byClient.set(name, (byClient.get(name) ?? 0) + Number(inv.total || 0))
  }

  return (
    <>
      <PageHeader
        title="Invoices"
        badge={`${invoices.length} total`}
        description="Create, manage and track all your invoices."
        actions={
          <Link to={routes.quotes} className="btn">
            <Plus size={15} /> New invoice
          </Link>
        }
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        <div className="metrics-grid">
          <MetricCard icon={FileText} tone="purple" label="Total invoices" value={invoices.length} hint={isAll ? 'This period' : dayParam} />
          <MetricCard icon={IndianRupee} tone="green" label="Total amount" value={`₹${totalAmount.toLocaleString('en-IN')}`} />
          <MetricCard icon={IndianRupee} tone="green" label="Paid" value={paidCount} hint={invoices.length ? `${((paidCount / invoices.length) * 100).toFixed(0)}%` : '0%'} />
        </div>
        <div className="status-strip" aria-label="Invoice status breakdown">
          <span className="status-strip-item">
            <span className="status-strip-dot paid" aria-hidden />
            Paid <strong>{paidCount}</strong>
          </span>
          <span className="status-strip-item">
            <span className="status-strip-dot pending" aria-hidden />
            Pending <strong>{pendingCount}</strong>
          </span>
        </div>
        {q.isLoading && <p className="muted">Loading invoices…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {invoices.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Lead</th>
                  <th>Total</th>
                  <th>Generated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((x) => {
                  const leadName = x.lead_title ?? x.lead_id.slice(0, 8)
                  return (
                    <tr
                      key={x.id}
                      className="invoice-row"
                      onClick={() => void openPreview(x)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div className="row" style={{ gap: '0.4rem' }}>
                          <FileText size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                          <div className="stack" style={{ gap: '0.15rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                              {invoiceDisplayName(x)}
                            </span>
                            <span className="muted small" style={{ fontFamily: 'ui-monospace, monospace' }}>
                              {x.title ? x.invoice_number : 'Click to preview'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="muted">{leadName}</td>
                      <td style={{ fontWeight: 700 }}>₹{x.total.toLocaleString('en-IN')}</td>
                      <td className="muted small">
                        {x.invoiced_at ? new Date(x.invoiced_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
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
                                  setRenamingInvoice(x)
                                  setRenameTitle(x.title ?? '')
                                  close()
                                }}
                              >
                                <Pencil size={13} />
                                Rename
                              </button>
                              {x.pdf_url && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => {
                                      downloadPdf(orgId, x.id, x.invoice_number, 'invoice')
                                      close()
                                    }}
                                  >
                                    <Download size={13} />
                                    Download Invoice
                                  </button>
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
                                </>
                              )}
                              {x.lead_phone && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  disabled={
                                    !x.pdf_url ||
                                    (sendWhatsApp.isPending && sendWhatsApp.variables === x.id)
                                  }
                                  title={
                                    !x.pdf_url
                                      ? 'Generate the invoice PDF first'
                                      : `Send invoice to ${x.lead_phone} on WhatsApp`
                                  }
                                  onClick={() => {
                                    sendWhatsApp.mutate(x.id)
                                    close()
                                  }}
                                >
                                  <MessageCircle size={13} />
                                  {sendWhatsApp.isPending && sendWhatsApp.variables === x.id
                                    ? 'Sending…'
                                    : 'Send on WhatsApp'}
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={
                                  !x.lead_email ||
                                  !x.pdf_url ||
                                  (sendEmail.isPending && sendEmail.variables === x.id)
                                }
                                title={
                                  !x.lead_email
                                    ? 'This lead has no email address'
                                    : !x.pdf_url
                                      ? 'Generate the invoice PDF first'
                                      : `Send invoice to ${x.lead_email}`
                                }
                                onClick={() => {
                                  sendEmail.mutate(x.id)
                                  close()
                                }}
                              >
                                <Mail size={13} />
                                {sendEmail.isPending && sendEmail.variables === x.id
                                  ? 'Sending…'
                                  : 'Email invoice'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-danger"
                                disabled={deleteInvoice.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete invoice ${invoiceDisplayName(x)}? This cannot be undone.`,
                                    )
                                  ) {
                                    deleteInvoice.mutate(x.id)
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
              description="No invoices yet. Accept a quotation to generate an invoice."
            />
          )
        )}

        <InsightGrid>
          <InsightCard title="Invoice summary">
            {invoices.length === 0 ? (
              <p className="muted small">No invoices yet.</p>
            ) : (
              <>
                <DonutChart
                  segments={[
                    { label: 'Paid', value: paidCount, color: '#3D7A5A' },
                    { label: 'Pending', value: pendingCount, color: '#f59e0b' },
                  ]}
                  center={{ value: invoices.length, label: 'Total' }}
                />
                <DonutLegend
                  segments={[
                    { label: 'Paid', value: paidCount, color: '#3D7A5A' },
                    { label: 'Pending', value: pendingCount, color: '#f59e0b' },
                  ]}
                  total={invoices.length}
                />
              </>
            )}
          </InsightCard>
          <InsightCard title="Top clients">
            {[...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).length === 0 ? (
              <p className="muted small">No client totals yet.</p>
            ) : (
              <div className="stack" style={{ gap: '0.4rem', fontSize: '0.82rem' }}>
                {[...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, amt]) => (
                  <div key={name} className="row spread">
                    <span>{name}</span>
                    <strong>₹{amt.toLocaleString('en-IN')}</strong>
                  </div>
                ))}
              </div>
            )}
          </InsightCard>
          <InsightCard title="Quick actions">
            <div className="quick-action-list">
              <Link to={routes.quotes}><Plus size={14} /> New invoice</Link>
              <Link to={routes.settings('documents')}><FileText size={14} /> Invoice templates</Link>
            </div>
          </InsightCard>
        </InsightGrid>
      </div>

      <Modal
        open={!!renamingInvoice}
        onClose={() => {
          setRenamingInvoice(null)
          setRenameTitle('')
        }}
        title="Rename invoice"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRenamingInvoice(null)
                setRenameTitle('')
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={renameInvoice.isPending || !renamingInvoice}
              onClick={() => {
                if (!renamingInvoice) return
                renameInvoice.mutate({ id: renamingInvoice.id, title: renameTitle })
              }}
            >
              {renameInvoice.isPending ? 'Saving…' : 'Save name'}
            </button>
          </>
        }
      >
        {renamingInvoice && (
          <div className="stack" style={{ gap: '0.75rem' }}>
            <p className="muted small">
              Invoice number <strong>{renamingInvoice.invoice_number}</strong> stays the same. This name is
              only for your list.
            </p>
            <div className="form-field">
              <label className="input-label" htmlFor="invoice-rename-title">
                Display name
              </label>
              <input
                id="invoice-rename-title"
                className="input"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                placeholder={renamingInvoice.invoice_number}
                maxLength={200}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renamingInvoice) {
                    e.preventDefault()
                    renameInvoice.mutate({ id: renamingInvoice.id, title: renameTitle })
                  }
                }}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!previewInvoice}
        onClose={closePreview}
        title={
          previewInvoice
            ? `${invoiceDisplayName(previewInvoice)}${
                previewInvoice.title ? ` · ${previewInvoice.invoice_number}` : ''
              }`
            : 'Preview'
        }
        size="xl"
        footer={
          previewInvoice ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={closePreview}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (!previewInvoice || !orgId) return
                  void downloadPdf(orgId, previewInvoice.id, previewInvoice.invoice_number, 'invoice')
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
            title="Invoice preview"
            src={previewUrl}
            className="quotation-preview-frame"
          />
        )}
      </Modal>
    </>
  )
}
