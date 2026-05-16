import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Plus, User } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type Lead = {
  id: string
  title: string
  stage: string
  source: string
  company: string | null
  phone: string | null
  next_follow_up_at: string | null
  estimated_value: number | null
}

const STAGE_COLOR: Record<string, string> = {
  NEW:           'badge-slate',
  CONTACTED:     'badge-blue',
  QUALIFICATION: 'badge-indigo',
  QUOTATION:     'badge-purple',
  NEGOTIATION:   'badge-amber',
  SAMPLE:        'badge-amber',
  WON:           'badge-green',
  LOST:          'badge-red',
}

const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP:  'WhatsApp',
  TELECALLER:'Telecaller',
  INSTAGRAM: 'Instagram',
  WEBSITE:   'Website',
  REFERRAL:  'Referral',
  OTHER:     'Other',
}

const STAGES = ['NEW','CONTACTED','QUALIFICATION','QUOTATION','NEGOTIATION','SAMPLE','WON','LOST']
const SOURCES = ['WHATSAPP','TELECALLER','INSTAGRAM','WEBSITE','REFERRAL','OTHER']

function isOverdue(dt: string | null) {
  if (!dt) return false
  return new Date(dt) < new Date()
}

export function LeadsPage() {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [stageFilter, setStageFilter] = useState('')
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('OTHER')
  const [value, setValue] = useState('')

  const q = useQuery({
    queryKey: ['leads', orgId, stageFilter],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ items: Lead[] }>(
        `/v1/orgs/${orgId}/leads${stageFilter ? `?stage=${stageFilter}` : ''}`,
      ),
  })

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/leads`, {
        method: 'POST',
        json: {
          title,
          source,
          stage: 'NEW',
          company: company || undefined,
          phone: phone || undefined,
          estimated_value: value ? Number(value) : undefined,
        },
      }),
    onSuccess: () => {
      setTitle(''); setCompany(''); setPhone(''); setValue('')
      setShowForm(false)
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
    },
  })

  const updateStage = useMutation({
    mutationFn: (p: { id: string; stage: string }) =>
      apiFetch(`/v1/orgs/${orgId}/leads/${p.id}`, { method: 'PATCH', json: { stage: p.stage } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['leads', orgId] }),
  })

  if (!orgId) return (
    <>
      <div className="page-header"><h1>Leads</h1><p>Select an organization to view leads.</p></div>
    </>
  )

  const leads = q.data?.items ?? []

  return (
    <>
      <div className="page-header">
        <h1>Leads</h1>
        <p>{leads.length} lead{leads.length !== 1 ? 's' : ''} · Manage your sales pipeline</p>
      </div>

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {/* Toolbar */}
        <div className="row spread">
          <div className="row">
            <select
              className="select"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              style={{ minWidth: 140 }}
            >
              <option value="">All stages</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
            <Plus size={15} />
            Add lead
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: '1rem' }}>New Lead</div>
            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                if (title.trim()) void create.mutateAsync()
              }}
            >
              <div className="row" style={{ gap: '0.75rem', alignItems: 'flex-end' }}>
                <div className="form-field" style={{ flex: 2 }}>
                  <label className="input-label">Lead title *</label>
                  <input className="input" placeholder="e.g. ABC Uniforms - 200 pcs" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ width: '100%' }} />
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Company</label>
                  <input className="input" placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>
              <div className="row" style={{ gap: '0.75rem', alignItems: 'flex-end' }}>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Phone</label>
                  <input className="input" placeholder="+91 9000000000" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Source</label>
                  <select className="select" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: '100%' }}>
                    {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
                  </select>
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="input-label">Est. value (₹)</label>
                  <input className="input" type="number" placeholder="0" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>
              {create.error && <p className="error">{(create.error as Error).message}</p>}
              <div className="row">
                <button type="submit" className="btn" disabled={create.isPending}>
                  {create.isPending ? 'Creating…' : 'Create lead'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Leads table */}
        {q.isLoading && <p className="muted">Loading leads…</p>}
        {q.error && <p className="error">{(q.error as Error).message}</p>}

        {leads.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Source</th>
                  <th>Stage</th>
                  <th>Value</th>
                  <th>Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.title}</div>
                      {(l.company || l.phone) && (
                        <div className="muted small row" style={{ gap: '0.5rem', marginTop: '0.15rem' }}>
                          {l.company && <span><User size={11} style={{ verticalAlign: 'middle' }} /> {l.company}</span>}
                          {l.phone && <span>{l.phone}</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-slate">{SOURCE_LABELS[l.source] ?? l.source}</span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: '0.35rem', flexWrap: 'nowrap' }}>
                        <span className={`badge ${STAGE_COLOR[l.stage] ?? 'badge-slate'}`}>{l.stage}</span>
                        <div style={{ position: 'relative' }}>
                          <select
                            className="select"
                            value={l.stage}
                            style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', minWidth: 0, width: 'auto', paddingRight: '1.2rem' }}
                            onChange={(e) => updateStage.mutate({ id: l.id, stage: e.target.value })}
                            aria-label="Change stage"
                          >
                            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                    </td>
                    <td>
                      {l.estimated_value != null
                        ? <span style={{ fontWeight: 600 }}>₹{l.estimated_value.toLocaleString('en-IN')}</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      {l.next_follow_up_at ? (
                        <span className={`row ${isOverdue(l.next_follow_up_at) ? 'error' : 'muted'}`} style={{ gap: '0.3rem', fontSize: '0.8rem' }}>
                          <Calendar size={12} />
                          {new Date(l.next_follow_up_at).toLocaleDateString('en-IN')}
                          {isOverdue(l.next_follow_up_at) && ' · overdue'}
                        </span>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !q.isLoading && (
            <div className="empty-state card">
              <p>No leads found. Add your first lead to get started.</p>
            </div>
          )
        )}
      </div>
    </>
  )
}
