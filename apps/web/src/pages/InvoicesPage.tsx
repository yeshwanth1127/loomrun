import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Mail, MessageCircle, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'
import { RowActions } from '../components/RowActions'
import { toast } from 'sonner'

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type Invoice = {
  id: string
  number: string
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

async function downloadPdf(
  orgId: string,
  quotationId: string,
  filename: string,
  variant: 'quotation' | 'invoice',
) {
  try {
    const params = new URLSearchParams({ variant })
    const response = await fetch(
      `${base}/v1/orgs/${orgId}/quotations/${quotationId}/pdf-file?${params}`,
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
  const { orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()

  const q = useQuery({
    queryKey: ['invoices', orgId, dayParam],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
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

  if (!orgId) return (
    <>
      <div className="page-header"><h1>Invoices</h1><p>Select an organization.</p></div>
    </>
  )

  const invoices = (q.data?.items ?? []).filter((x) => x.invoice_number)

  return (
    <>
      <div className="page-header">
        <h1>Invoices</h1>
        <p>
          {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
          {isAll ? '' : ` · Generated ${dayParam}`}
          {' · '}Track and deliver invoices to customers
        </p>
      </div>

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {q.isLoading && <p className="muted">Loading invoices…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {invoices.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
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
                    <tr key={x.id}>
                      <td>
                        <div className="row" style={{ gap: '0.4rem' }}>
                          <FileText size={14} style={{ color: '#6366f1' }} />
                          <span style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem' }}>
                            {x.invoice_number}
                          </span>
                        </div>
                      </td>
                      <td className="muted">{leadName}</td>
                      <td style={{ fontWeight: 700 }}>₹{x.total.toLocaleString('en-IN')}</td>
                      <td className="muted small">
                        {x.invoiced_at ? new Date(x.invoiced_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td>
                        <RowActions>
                          {(close) => (
                            <>
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
                                      `Delete invoice ${x.invoice_number}? This cannot be undone.`,
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
            <div className="empty-state card">
              <p>No invoices yet. Accept a quotation to generate an invoice.</p>
            </div>
          )
        )}
      </div>
    </>
  )
}
