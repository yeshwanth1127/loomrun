import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, IndianRupee, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { DonutChart, DonutLegend, InsightCard, InsightGrid, MetricCard } from '../components/ui/dashboard'
import { apiFetch } from '../lib/api'
import { routes } from '../lib/appRoutes'
import { groupDocsByLead, type QuotationDoc } from '../lib/documents'
import { fmtINR } from '../lib/format'
import { isOwnerRole, membershipForOrg } from '../lib/membership'
import { LeadSearchSelect, type LeadOption } from '../components/LeadSearchSelect'
import { toast } from 'sonner'

type Invoice = {
  id: string
  number: string
  title: string | null
  invoice_number: string
  version?: number
  status: string
  total: number
  tax_enabled?: boolean
  tax_rate?: number | null
  lead_id: string
  lead_title: string | null
  lead_phone: string | null
  lead_email: string | null
  lead_company?: string | null
  pdf_url: string | null
  sent_at: string | null
  invoiced_at: string | null
  created_at?: string | null
  updated_at?: string | null
  source_quotation_id?: string | null
  source_quotation_version?: number | null
  source_quotation_number?: string | null
  lines: { description: string; quantity: number; unit_price: number; line_total: number }[]
}

type DocTemplate = {
  id: string
  name: string
  is_default?: boolean
}

/** Invoice commercial status used by Money → Invoices (no per-invoice ledger yet). */
function isInvoicePaid(status: string) {
  return status === 'ACCEPTED' || status === 'PAID'
}

function isInvoiceUnpaid(status: string) {
  return status === 'SENT' || status === 'DRAFT'
}

export function InvoicesPage() {
  const navigate = useNavigate()
  const { orgId, me } = useAuth()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership) || !!me?.is_super_admin
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const focusLeadId = searchParams.get('leadId')
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newLead, setNewLead] = useState<LeadOption | null>(null)
  const [sourceQuoteId, setSourceQuoteId] = useState('')

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

  const templatesQ = useQuery({
    queryKey: ['document-templates', orgId, 'INVOICE'],
    enabled: !!orgId && !focusLeadId,
    queryFn: () =>
      apiFetch<{ items: DocTemplate[]; default_invoice_template_id?: string | null }>(
        `/v1/orgs/${orgId}/document-templates?doc_type=INVOICE`,
      ),
  })
  const invoiceTemplates = templatesQ.data?.items ?? []

  const leadQuotesQ = useQuery({
    queryKey: ['quotations', orgId, 'for-invoice', newLead?.id],
    enabled: !!orgId && !!newLead?.id && showNew,
    queryFn: () =>
      apiFetch<{ items: QuotationDoc[] }>(
        `/v1/orgs/${orgId}/quotations?doc=quotation&lead_id=${newLead!.id}&day=all`,
      ),
  })

  const createInvoice = useMutation({
    mutationFn: async () => {
      if (!newLead) throw new Error('Select a lead')
      if (sourceQuoteId) {
        return apiFetch<{ quotation_id?: string; id?: string; invoice_number: string }>(
          `/v1/orgs/${orgId}/quotations/${sourceQuoteId}/generate-invoice`,
          { method: 'POST' },
        )
      }
      return apiFetch<{ id: string; invoice_number: string }>(`/v1/orgs/${orgId}/quotations`, {
        method: 'POST',
        json: {
          lead_id: newLead.id,
          as_invoice: true,
          lines: [{ description: 'Services', quantity: 1, unit_price: 0 }],
        },
      })
    },
    onSuccess: (data) => {
      const id = (data as { quotation_id?: string; id?: string }).quotation_id || data.id
      toast.success(`Invoice ${data.invoice_number} created`)
      setShowNew(false)
      setNewLead(null)
      setSourceQuoteId('')
      void qc.invalidateQueries({ queryKey: ['invoices', orgId] })
      if (id) navigate(routes.moneyInvoiceDoc(id))
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (!orgId) return (
    <PageHeader title="Invoices" description="Select an organization." />
  )

  const invoices = q.data?.items ?? []
  const searchLower = search.trim().toLowerCase()
  const filtered = invoices.filter((x) => {
    if (focusLeadId && x.lead_id !== focusLeadId) return false
    if (!searchLower) return true
    const hay = [x.lead_title, x.lead_company, x.invoice_number, x.title, x.number]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(searchLower)
  })
  const leadGroups = groupDocsByLead(filtered as unknown as QuotationDoc[])
  const focusLead = focusLeadId
    ? leadGroups.find((g) => g.leadId === focusLeadId) ||
      (filtered[0]
        ? {
            leadId: focusLeadId,
            leadTitle: filtered[0].lead_title || 'Lead',
            leadCompany: filtered[0].lead_company ?? null,
            count: filtered.length,
            latestAt: null as string | null,
            totalValue: filtered.reduce((s, d) => s + d.total, 0),
            docs: filtered as unknown as QuotationDoc[],
          }
        : null)
    : null

  const totalAmount = invoices.reduce((s, x) => s + (Number(x.total) || 0), 0)
  const paidInvoices = invoices.filter((x) => isInvoicePaid(x.status))
  const unpaidInvoices = invoices.filter((x) => isInvoiceUnpaid(x.status))
  const paidCount = paidInvoices.length
  const collectedAmount = paidInvoices.reduce((s, x) => s + (Number(x.total) || 0), 0)
  const outstandingAmount = unpaidInvoices.reduce((s, x) => s + (Number(x.total) || 0), 0)
  // Partially paid / overdue are not tracked on invoice documents yet.
  const partiallyPaidAmount = 0
  const overdueAmount = 0

  function clearLeadFocus() {
    const p = new URLSearchParams(searchParams)
    p.delete('leadId')
    setSearchParams(p)
  }

  return (
    <>
      <PageHeader
        title={focusLead ? focusLead.leadTitle : 'Invoices'}
        badge={
          focusLead
            ? `${focusLead.count} invoice${focusLead.count === 1 ? '' : 's'}`
            : `${invoices.length} total`
        }
        description={
          focusLead
            ? 'Invoices for this customer, with quotation lineage when available.'
            : 'Organised by customer — open a lead to manage their invoices.'
        }
        actions={
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            {focusLead && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearLeadFocus}>
                <ArrowLeft size={14} />
                Back
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShowNew(true)
                  if (focusLeadId) {
                    setNewLead({
                      id: focusLeadId,
                      title: focusLead?.leadTitle || 'Lead',
                      company: focusLead?.leadCompany,
                    })
                  }
                }}
              >
                <Plus size={15} /> New invoice
              </button>
            )}
          </div>
        }
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {!focusLead && (
          <>
            <div className="metrics-grid">
              <MetricCard
                icon={FileText}
                tone="purple"
                label="Total invoices"
                value={invoices.length}
                hint={isAll ? 'This period' : dayParam}
              />
              <MetricCard
                icon={IndianRupee}
                tone="green"
                label="Total amount"
                value={`₹${totalAmount.toLocaleString('en-IN')}`}
              />
              <MetricCard
                icon={IndianRupee}
                tone="green"
                label="Paid"
                value={paidCount}
                hint={invoices.length ? `${((paidCount / invoices.length) * 100).toFixed(0)}%` : '0%'}
              />
            </div>
            <div className="status-strip" aria-label="Invoice status breakdown">
              <span className="status-strip-item">
                <span className="status-strip-dot paid" aria-hidden />
                Paid <strong>{paidCount}</strong>
              </span>
              <span className="status-strip-item">
                <span className="status-strip-dot pending" aria-hidden />
                Partially Paid <strong>0</strong>
              </span>
              <span className="status-strip-item">
                <span className="status-strip-dot pending" aria-hidden />
                Unpaid <strong>{unpaidInvoices.length}</strong>
              </span>
              <span className="status-strip-item">
                <span className="status-strip-dot rejected" aria-hidden />
                Overdue <strong>0</strong>
              </span>
            </div>

            <InsightGrid>
              <InsightCard title="Payment overview">
                {invoices.length === 0 ? (
                  <p className="muted small">No invoices yet.</p>
                ) : (
                  <div className="stack" style={{ gap: '0.45rem', fontSize: '0.85rem' }}>
                    <div className="row spread">
                      <span className="muted">Total invoiced</span>
                      <strong>{fmtINR(totalAmount)}</strong>
                    </div>
                    <div className="row spread">
                      <span className="muted">Collected</span>
                      <strong>{fmtINR(collectedAmount)}</strong>
                    </div>
                    <div className="row spread">
                      <span className="muted">Outstanding</span>
                      <strong>{fmtINR(outstandingAmount)}</strong>
                    </div>
                    <p className="muted small" style={{ margin: '0.35rem 0 0' }}>
                      Collected = accepted invoices · Outstanding = draft/sent
                    </p>
                  </div>
                )}
              </InsightCard>

              <InsightCard title="Invoice value">
                {invoices.length === 0 ? (
                  <p className="muted small">No invoice value yet.</p>
                ) : (
                  <>
                    <DonutChart
                      segments={[
                        { label: 'Paid', value: collectedAmount, color: '#3D7A5A' },
                        { label: 'Partially Paid', value: partiallyPaidAmount, color: '#0F766E' },
                        { label: 'Unpaid', value: outstandingAmount, color: '#f59e0b' },
                        { label: 'Overdue', value: overdueAmount, color: '#B42318' },
                      ]}
                      center={{
                        value: `₹${totalAmount.toLocaleString('en-IN')}`,
                        label: 'Total invoiced',
                      }}
                    />
                    <DonutLegend
                      segments={[
                        { label: 'Paid', value: paidCount, color: '#3D7A5A' },
                        { label: 'Partially Paid', value: 0, color: '#0F766E' },
                        { label: 'Unpaid', value: unpaidInvoices.length, color: '#f59e0b' },
                        { label: 'Overdue', value: 0, color: '#B42318' },
                      ]}
                      total={invoices.length}
                    />
                  </>
                )}
              </InsightCard>

              <InsightCard title="Quick actions">
                <div className="quick-action-list">
                  {isOwner && (
                    <button type="button" onClick={() => setShowNew(true)}>
                      <Plus size={14} /> New invoice
                    </button>
                  )}
                  <Link to={routes.moneyQuotations()}>
                    <FileText size={14} /> View quotations
                  </Link>
                  {invoiceTemplates.length > 0 && (
                    <Link to={routes.settings('documents')}>
                      <FileText size={14} /> Invoice templates
                    </Link>
                  )}
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
            placeholder="Search leads or invoices…"
          />
        </div>

        {q.isLoading && <p className="muted">Loading invoices…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {!focusLead && !q.isLoading && leadGroups.length === 0 && (
          <EmptyState
            icon={FileText}
            description="No invoices yet. Accept a quotation to generate an invoice."
          />
        )}

        {!focusLead && leadGroups.length > 0 && (
          <div className="stack" style={{ gap: '0.65rem' }}>
            {leadGroups.map((g) => (
              <button
                key={g.leadId}
                type="button"
                className="card"
                style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
                onClick={() => {
                  const p = new URLSearchParams(searchParams)
                  p.set('leadId', g.leadId)
                  setSearchParams(p)
                }}
              >
                <div className="row spread" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '1rem' }}>{g.leadTitle}</strong>
                  <div className="stack" style={{ gap: '0.1rem', alignItems: 'flex-end' }}>
                    <span className="muted small">
                      {g.count} invoice{g.count === 1 ? '' : 's'}
                    </span>
                    <strong>{fmtINR(g.totalValue)}</strong>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {focusLead && (
          <div className="stack" style={{ gap: '0.75rem' }}>
            <strong style={{ fontSize: '0.88rem' }}>Invoices</strong>
            {filtered.length === 0 ? (
              <EmptyState
                icon={FileText}
                description="No invoices for this lead yet."
              />
            ) : (
              filtered.map((inv) => (
                <div key={inv.id} className="card">
                  <div className="row spread" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div className="stack" style={{ gap: '0.2rem', flex: 1 }}>
                      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                        <strong>{inv.invoice_number}</strong>
                        <span className="badge badge-slate">V{inv.version ?? 1}</span>
                      </div>
                      <strong>{fmtINR(inv.total)}</strong>
                      {inv.source_quotation_number && (
                        <span className="muted small">
                          Based on{' '}
                          {inv.source_quotation_id ? (
                            <Link to={routes.moneyQuotationDoc(inv.source_quotation_id)}>
                              {inv.source_quotation_number}
                              {inv.source_quotation_version != null
                                ? ` · V${inv.source_quotation_version}`
                                : ''}
                            </Link>
                          ) : (
                            inv.source_quotation_number
                          )}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => navigate(routes.moneyInvoiceDoc(inv.id))}
                    >
                      Open
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {showNew && isOwner && (
          <div className="drawer-overlay" onClick={() => setShowNew(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <strong>New invoice</strong>
              <div className="stack" style={{ gap: '0.65rem', marginTop: '0.75rem' }}>
                <LeadSearchSelect
                  orgId={orgId}
                  value={newLead?.id ?? ''}
                  onChange={(_id, lead) => {
                    setNewLead(lead)
                    setSourceQuoteId('')
                  }}
                />
                {newLead && (leadQuotesQ.data?.items?.length ?? 0) > 0 && (
                  <select
                    className="select"
                    value={sourceQuoteId}
                    onChange={(e) => setSourceQuoteId(e.target.value)}
                  >
                    <option value="">Direct invoice (no quotation)</option>
                    {leadQuotesQ.data!.items.map((qq) => (
                      <option key={qq.id} value={qq.id}>
                        {qq.number} · V{qq.version} · {fmtINR(qq.total)}
                      </option>
                    ))}
                  </select>
                )}
                <div className="row" style={{ gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={!newLead || createInvoice.isPending}
                    onClick={() => createInvoice.mutate()}
                  >
                    {createInvoice.isPending ? 'Creating…' : 'Create'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
