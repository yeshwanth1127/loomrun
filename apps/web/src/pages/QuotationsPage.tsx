import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Plus, Send } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type Lead = { id: string; title: string }
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
  status: string
  total: number
  lead_id: string
  pdf_url: string | null
  sent_at: string | null
  lines: { description: string; quantity: number; unit_price: number; line_total: number }[]
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT:    'badge-slate',
  SENT:     'badge-blue',
  ACCEPTED: 'badge-green',
  REJECTED: 'badge-red',
  EXPIRED:  'badge-amber',
}

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function QuotationsPage() {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [leadId, setLeadId] = useState('')
  const [lines, setLines] = useState([{ description: '', quantity: '1', unit_price: '' }])

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
    queryKey: ['quotations', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: Quotation[] }>(`/v1/orgs/${orgId}/quotations`),
  })

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
      setLines([{ description: '', quantity: '1', unit_price: '' }])
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
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/quotations/${id}/send`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['quotations', orgId] }),
  })

  if (!orgId) return (
    <>
      <div className="page-header"><h1>Quotations</h1><p>Select an organization.</p></div>
    </>
  )

  const quotations = q.data?.items ?? []
  const leads = leadsQ.data?.items ?? []

  function addLine() {
    setLines([...lines, { description: '', quantity: '1', unit_price: '' }])
  }

  function removeLine(i: number) {
    setLines(lines.filter((_, idx) => idx !== i))
  }

  function updateLine(i: number, field: string, val: string) {
    setLines(lines.map((l, idx) => idx === i ? { ...l, [field]: val } : l))
  }

  return (
    <>
      <div className="page-header">
        <h1>Quotations</h1>
        <p>{quotations.length} quotation{quotations.length !== 1 ? 's' : ''} · Generate and track quotes</p>
      </div>

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        <div className="row spread">
          <span />
          <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
            <Plus size={15} />
            New quotation
          </button>
        </div>

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
                <div className="input-label" style={{ marginBottom: '0.5rem' }}>Line items</div>

                {(catalogQ.data?.items?.length ?? 0) > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div className="muted small" style={{ marginBottom: '0.3rem' }}>Quick add from catalog</div>
                    <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                      <select
                        className="select"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) {
                            const item = catalogQ.data!.items.find((i) => i.id === e.target.value)
                            if (item) {
                              addLine()
                              const lastIdx = lines.length
                              updateLine(lastIdx, 'description', item.name)
                              updateLine(lastIdx, 'unit_price', String(item.unit_price))
                            }
                          }
                          e.target.value = ''
                        }}
                        style={{ flex: 1 }}
                      >
                        <option value="">Select item to add…</option>
                        {catalogQ.data?.items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} (₹{item.unit_price.toLocaleString('en-IN')})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="stack" style={{ gap: '0.5rem' }}>
                  {lines.map((line, i) => (
                    <div key={i} className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
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
                  ))}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={addLine}>
                  + Add line manually
                </button>
              </div>

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
                  const leadName = leads.find((l) => l.id === x.lead_id)?.title ?? x.lead_id.slice(0, 8)
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
                        <div className="row" style={{ gap: '0.35rem' }}>
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
                            <a
                              href={`${base}/v1/orgs/${orgId}/quotations/${x.id}/pdf-file`}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm"
                            >
                              <Download size={13} />
                              PDF
                            </a>
                          )}
                          {x.status === 'DRAFT' && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{ background: '#10b981' }}
                              disabled={send.isPending}
                              onClick={() => send.mutate(x.id)}
                            >
                              <Send size={13} />
                              Send
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
    </>
  )
}
