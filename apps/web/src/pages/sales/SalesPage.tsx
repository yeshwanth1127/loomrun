import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  Columns,
  MessageCircle,
  Phone,
  Plus,
  Settings2,
  Table2,
  Upload,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AddLeadModal, ImportCsvModal } from '../../components/LeadCreateModals'
import { EmptyState } from '../../components/ui/EmptyState'
import { FilterToolbar } from '../../components/ui/FilterToolbar'
import { PageHeader } from '../../components/ui/PageHeader'
import { KanbanSkeleton, TableSkeleton } from '../../components/ui/Skeleton'
import { MetricCard } from '../../components/ui/dashboard'
import { useAuth } from '../../context/AuthContext'
import { useDateFilter } from '../../context/DateFilterContext'
import { apiFetch } from '../../lib/api'
import { routes } from '../../lib/appRoutes'
import { CALL_STATUS_MAP } from '../../lib/callStatus'
import {
  activeFollowUpAt,
  fmtDateTime,
  fmtFollowUpRelative,
  followUpBucket,
  isFollowUpOverdue,
  type FollowUpBucket,
} from '../../lib/followUp'
import { fmtINR, fmtPct, timeAgo } from '../../lib/format'
import {
  CALL_OUTCOME_LABELS,
  OPEN_STAGES,
  QUOTED_STAGES,
  SOURCES,
  SOURCE_LABELS,
  STAGES,
  STAGE_COLOR,
  STAGE_LABELS,
  fmtLeadDate,
  scoreClass,
  type Lead,
  type PipelineSummary,
} from '../../lib/leads'
import { isOwnerRole, isTelecallerRole, membershipForOrg } from '../../lib/membership'
import { CallingView } from './CallingView'

type ViewKey = 'all' | 'new' | 'follow-ups' | 'quoted' | 'won' | 'lost' | 'calling'

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'follow-ups', label: 'Follow-ups' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
  { key: 'calling', label: 'Calls' },
]

function isViewKey(v: string | null): v is ViewKey {
  return !!v && VIEWS.some((x) => x.key === v)
}

function statusLabel(bucket: FollowUpBucket): { text: string; cls: string } {
  if (bucket === 'overdue') return { text: 'Overdue', cls: 'badge-red' }
  if (bucket === 'due_now') return { text: 'Due now', cls: 'badge-red' }
  if (bucket === 'later_today') return { text: 'Due today', cls: 'badge-green' }
  if (bucket === 'upcoming') return { text: 'Scheduled', cls: 'badge-blue' }
  return { text: 'Unscheduled', cls: 'badge-slate' }
}

function followUpReason(lead: Lead): string | null {
  if (lead.last_call_notes?.trim()) return lead.last_call_notes.trim()
  if (lead.notes?.trim()) return lead.notes.trim()
  if (lead.last_call_outcome) {
    return CALL_OUTCOME_LABELS[lead.last_call_outcome] ?? lead.last_call_outcome
  }
  return null
}

export function SalesPage() {
  const { me, orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership) || !!me?.is_super_admin
  const isTelecaller = isTelecallerRole(membership)
  const canOrganize = isOwner || membership?.role === 'SALES'

  const viewParam = searchParams.get('view')
  const view: ViewKey = isViewKey(viewParam) ? viewParam : isTelecaller ? 'calling' : 'all'
  const pipelineId = searchParams.get('pipeline') ?? ''
  const layoutParam = searchParams.get('layout')
  const layout: 'board' | 'list' = layoutParam === 'list' ? 'list' : 'board'

  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const [scoreMin, setScoreMin] = useState('')
  const [scoreMax, setScoreMax] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams)
    if (!value) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const pipelinesQ = useQuery({
    queryKey: ['pipelines', orgId, 'sales'],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ items: PipelineSummary[] }>(`/v1/orgs/${orgId}/pipelines?include_archived=false`),
  })
  const pipelines = pipelinesQ.data?.items ?? []

  const qs = useMemo(() => {
    const params = new URLSearchParams()
    if (source) params.set('source', source)
    if (pipelineId) params.set('pipeline_id', pipelineId)
    if (search) params.set('search', search)
    if (scoreMin) params.set('score_min', scoreMin)
    if (scoreMax) params.set('score_max', scoreMax)
    appendDay(params)
    return params.toString()
  }, [source, pipelineId, search, scoreMin, scoreMax, appendDay])

  const leadsQ = useQuery({
    queryKey: ['leads', orgId, qs, dayParam],
    enabled: !!orgId,
    refetchInterval: 10_000,
    queryFn: () => apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads?${qs}`),
  })

  // Follow-ups keep their own always-current query (day-independent), matching the
  // behaviour of the standalone Follow ups page.
  const followUpsQs = useMemo(() => {
    const params = new URLSearchParams({
      last_call_outcome: 'FOLLOW_UP,FOLLOW_UP_DATE_SET,FOLLOW_UP_AFTER_SAMPLE,CALL_BACK_LATER,CALLBACK_SCHEDULED',
      day: 'all',
    })
    if (pipelineId) params.set('pipeline_id', pipelineId)
    return params.toString()
  }, [pipelineId])

  const followUpsQ = useQuery({
    queryKey: ['follow-ups', orgId, followUpsQs],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: () => apiFetch<{ items: Lead[] }>(`/v1/orgs/${orgId}/leads?${followUpsQs}`),
  })

  useEffect(() => {
    if (leadsQ.error) toast.error((leadsQ.error as Error).message)
  }, [leadsQ.error])
  useEffect(() => {
    if (followUpsQ.error) toast.error((followUpsQ.error as Error).message)
  }, [followUpsQ.error])

  const updateStage = useMutation({
    mutationFn: (p: { id: string; stage: string }) =>
      apiFetch(`/v1/orgs/${orgId}/leads/${p.id}`, {
        method: 'PATCH',
        json: { stage: p.stage },
      }),
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ['leads', orgId] })
      const snapshots = qc.getQueriesData<{ items: Lead[] }>({
        queryKey: ['leads', orgId],
      })
      for (const [key, data] of snapshots) {
        if (!data) continue
        qc.setQueryData(key, {
          ...data,
          items: data.items.map((l) => (l.id === p.id ? { ...l, stage: p.stage } : l)),
        })
      }
      return { snapshots }
    },
    onError: (err: Error, _p, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data)
      toast.error(err.message)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      void qc.invalidateQueries({ queryKey: ['lead-detail', orgId] })
    },
  })

  if (!orgId) {
    return (
      <div className="page">
        <PageHeader title="Sales" description="Select an organization to view sales." />
      </div>
    )
  }

  const allLeads = leadsQ.data?.items ?? []
  const followUpLeads = followUpsQ.data?.items ?? []

  const counts = {
    all: allLeads.length,
    new: allLeads.filter((l) => l.stage === 'NEW').length,
    'follow-ups': followUpLeads.length,
    quoted: allLeads.filter((l) => QUOTED_STAGES.includes(l.stage)).length,
    won: allLeads.filter((l) => l.stage === 'WON').length,
    lost: allLeads.filter((l) => l.stage === 'LOST').length,
    calling: 0,
  }

  const viewLeads =
    view === 'new'
      ? allLeads.filter((l) => l.stage === 'NEW')
      : view === 'quoted'
        ? allLeads.filter((l) => QUOTED_STAGES.includes(l.stage))
        : view === 'won'
          ? allLeads.filter((l) => l.stage === 'WON')
          : view === 'lost'
            ? allLeads.filter((l) => l.stage === 'LOST')
            : allLeads

  const boardable = view === 'all' || view === 'new' || view === 'quoted'
  const effectiveLayout = boardable && layout === 'board' ? 'board' : 'list'
  const filtersActive = !!(source || scoreMin || scoreMax || search)
  const isBoardPage = view !== 'follow-ups' && view !== 'calling' && effectiveLayout === 'board'

  function openLead(leadId: string, tab?: 'call') {
    navigate(tab ? `/app/sales/${leadId}?tab=${tab}` : `/app/sales/${leadId}`)
  }

  return (
    <div className={isBoardPage ? 'leads-page leads-page--board' : 'leads-page'}>
      <PageHeader
        title="Sales"
        description={
          view === 'calling'
            ? 'Work through your calls and log every outcome.'
            : `${viewLeads.length} lead${viewLeads.length === 1 ? '' : 's'}${isAll ? '' : ` · added ${dayParam}`}`
        }
        actions={
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => setShowAdd(true)}>
              <Plus size={14} />
              Add lead
            </button>
            {isOwner && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setShowImport(true)}
              >
                <Upload size={14} />
                Import
              </button>
            )}
            {isOwner && (
              <Link to={routes.quotes} className="btn btn-sm btn-secondary">
                Quotations
              </Link>
            )}
            {canOrganize && (
              <Link to={routes.salesOrganize} className="btn btn-sm btn-secondary">
                <Settings2 size={14} />
                Organize
              </Link>
            )}
          </div>
        }
        toolbar={
          <div className="sales-toolbar">
            <div className="sales-views" role="tablist" aria-label="Sales views">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={view === v.key}
                  className={`sales-view-tab${view === v.key ? ' active' : ''}`}
                  onClick={() => setParam('view', v.key === 'all' ? null : v.key)}
                >
                  {v.label}
                  {v.key !== 'calling' && counts[v.key] > 0 && (
                    <span className="sales-view-count">{counts[v.key]}</span>
                  )}
                </button>
              ))}
            </div>

            {view !== 'calling' && (
              <div className="sales-toolbar-right">
                {pipelines.length > 0 && (
                  <select
                    className="select"
                    value={pipelineId}
                    onChange={(e) => setParam('pipeline', e.target.value || null)}
                    aria-label="Pipeline"
                  >
                    <option value="">All pipelines</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {boardable && (
                  <div className="view-toggle" role="group" aria-label="Layout">
                    <button
                      type="button"
                      className={`view-toggle-btn${effectiveLayout === 'board' ? ' active' : ''}`}
                      onClick={() => setParam('layout', null)}
                      title="Board"
                    >
                      <Columns size={14} />
                    </button>
                    <button
                      type="button"
                      className={`view-toggle-btn${effectiveLayout === 'list' ? ' active' : ''}`}
                      onClick={() => setParam('layout', 'list')}
                      title="List"
                    >
                      <Table2 size={14} />
                    </button>
                  </div>
                )}
                <FilterToolbar
                  collapsible={false}
                  trailing={
                    filtersActive ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setSearch('')
                          setSource('')
                          setScoreMin('')
                          setScoreMax('')
                        }}
                      >
                        Clear
                      </button>
                    ) : null
                  }
                >
                  <input
                    className="input"
                    type="search"
                    placeholder="Name, phone, company…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <select
                    className="select"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    aria-label="Source"
                  >
                    <option value="">Any source</option>
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {SOURCE_LABELS[s] ?? s}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    type="number"
                    placeholder="Min score"
                    value={scoreMin}
                    onChange={(e) => setScoreMin(e.target.value)}
                  />
                  <input
                    className="input"
                    type="number"
                    placeholder="Max score"
                    value={scoreMax}
                    onChange={(e) => setScoreMax(e.target.value)}
                  />
                </FilterToolbar>
              </div>
            )}
          </div>
        }
      />

      <div className={isBoardPage ? 'page-body page-body--board' : 'page-body'}>
        {view === 'calling' ? (
          <CallingView orgId={orgId} />
        ) : view === 'follow-ups' ? (
          <FollowUpsView leads={followUpLeads} loading={followUpsQ.isLoading} onOpen={openLead} />
        ) : leadsQ.isLoading ? (
          effectiveLayout === 'board' ? (
            <KanbanSkeleton />
          ) : (
            <TableSkeleton />
          )
        ) : viewLeads.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No leads here yet"
            description={
              filtersActive
                ? 'No leads match these filters. Clear them to see everything.'
                : 'Add your first lead, import a spreadsheet, or connect a lead source.'
            }
            action={
              <div
                className="row"
                style={{
                  gap: '0.5rem',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <button type="button" className="btn btn-sm" onClick={() => setShowAdd(true)}>
                  <Plus size={14} />
                  Add lead
                </button>
                {isOwner && (
                  <Link to={routes.settings('connections')} className="btn btn-sm btn-secondary">
                    Connect a source
                  </Link>
                )}
              </div>
            }
          />
        ) : effectiveLayout === 'board' ? (
          <SalesBoard
            leads={viewLeads}
            showClosed={showClosed}
            onToggleClosed={() => setShowClosed((v) => !v)}
            onSelect={(id) => openLead(id)}
            onStageChange={(id, stage) => updateStage.mutate({ id, stage })}
          />
        ) : (
          <SalesTable leads={viewLeads} onSelect={(id) => openLead(id)} />
        )}
      </div>

      <AddLeadModal
        orgId={orgId}
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['leads', orgId] })}
      />
      <ImportCsvModal
        orgId={orgId}
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => void qc.invalidateQueries({ queryKey: ['leads', orgId] })}
      />
    </div>
  )
}

function SalesBoard({
  leads,
  showClosed,
  onToggleClosed,
  onSelect,
  onStageChange,
}: {
  leads: Lead[]
  showClosed: boolean
  onToggleClosed: () => void
  onSelect: (leadId: string) => void
  onStageChange: (leadId: string, stage: string) => void
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)

  const closedCount = leads.filter((l) => l.stage === 'WON' || l.stage === 'LOST').length
  const wonCount = leads.filter((l) => l.stage === 'WON').length
  const visibleStages = showClosed ? STAGES : OPEN_STAGES

  function handleDrop(stage: string) {
    if (draggedId) {
      const lead = leads.find((l) => l.id === draggedId)
      if (lead && lead.stage !== stage) onStageChange(draggedId, stage)
    }
    setDraggedId(null)
    setDragOverStage(null)
  }

  return (
    <div className="kanban-wrap">
      <div className="row kanban-closed-toggle">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleClosed}>
          {showClosed ? 'Hide closed' : `Show closed (${closedCount})`}
        </button>
        {!showClosed && closedCount > 0 && (
          <span className="muted small">
            Won {wonCount} · Lost {closedCount - wonCount}
          </span>
        )}
      </div>

      <div className="kanban-board">
        {visibleStages.map((stage) => {
          const colLeads = leads.filter((l) => l.stage === stage)
          const est = colLeads.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0)
          return (
            <div key={stage} className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-title">{STAGE_LABELS[stage] ?? stage}</span>
                <span className="kanban-col-count">{colLeads.length}</span>
                {est > 0 && <span className="kanban-col-est">{fmtINR(est)}</span>}
              </div>
              <div
                className={`kanban-col-body${dragOverStage === stage ? ' drag-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOverStage(stage)
                }}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={() => handleDrop(stage)}
              >
                {colLeads.length === 0 ? (
                  <p className="muted small" style={{ padding: '0.5rem' }}>
                    Drop leads here
                  </p>
                ) : (
                  colLeads.map((lead) => {
                    const followUp = activeFollowUpAt(
                      lead.next_follow_up_at,
                      lead.last_call_outcome,
                    )
                    const outcome = lead.last_call_outcome
                      ? CALL_STATUS_MAP[lead.last_call_outcome]
                      : null
                    return (
                      <div
                        key={lead.id}
                        role="button"
                        tabIndex={0}
                        draggable
                        className={`kanban-card score-${scoreClass(lead.lead_score)}`}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggedId(lead.id)
                        }}
                        onDragEnd={() => {
                          setDraggedId(null)
                          setDragOverStage(null)
                        }}
                        onClick={() => onSelect(lead.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onSelect(lead.id)
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{lead.title}</div>
                        {(lead.company || lead.product_interest) && (
                          <div className="kanban-card-meta">
                            {lead.company || lead.product_interest}
                          </div>
                        )}
                        <div
                          className="row"
                          style={{
                            gap: '0.3rem',
                            flexWrap: 'wrap',
                            marginTop: '0.35rem',
                          }}
                        >
                          <span className="source-pill">
                            {SOURCE_LABELS[lead.source] ?? lead.source}
                          </span>
                          {lead.pipeline_name && (
                            <span className="badge badge-indigo">{lead.pipeline_name}</span>
                          )}
                          <span className={`score-badge ${scoreClass(lead.lead_score)}`}>
                            {lead.lead_score}
                          </span>
                          {outcome && (
                            <span className={`badge ${outcome.color}`}>{outcome.label}</span>
                          )}
                        </div>
                        <div className="muted small" style={{ marginTop: '0.3rem' }}>
                          {[lead.city, timeAgo(lead.updated_at)].filter(Boolean).join(' · ')}
                        </div>
                        {followUp && (
                          <div
                            className={`row small ${isFollowUpOverdue(lead.next_follow_up_at, lead.last_call_outcome) ? 'error' : 'muted'}`}
                            style={{ gap: '0.25rem', marginTop: '0.3rem' }}
                          >
                            <Calendar size={12} />
                            {fmtLeadDate(followUp)}
                            {isFollowUpOverdue(lead.next_follow_up_at, lead.last_call_outcome)
                              ? ' · overdue'
                              : ''}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const SORTABLE_COLUMNS: readonly [string, keyof Lead][] = [
  ['Name', 'title'],
  ['Company', 'company'],
  ['Pipeline', 'pipeline_name'],
  ['Stage', 'stage'],
  ['Interest', 'lead_score'],
  ['Value', 'estimated_value'],
  ['Follow-up', 'next_follow_up_at'],
]

function SortTh({
  label,
  sortBy,
  active,
  dir,
  onSort,
}: {
  label: string
  sortBy: keyof Lead
  active: boolean
  dir: 'asc' | 'desc'
  onSort: (key: keyof Lead) => void
}) {
  return (
    <th scope="col">
      <button type="button" className="table-sort" onClick={() => onSort(sortBy)}>
        {label}
        {active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )
}

function SalesTable({ leads, onSelect }: { leads: Lead[]; onSelect: (leadId: string) => void }) {
  const [sortKey, setSortKey] = useState<keyof Lead>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: keyof Lead) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = [...leads].sort((a, b) => {
    const cmp = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), undefined, {
      numeric: true,
    })
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {SORTABLE_COLUMNS.map(([label, key]) => (
              <SortTh
                key={key}
                label={label}
                sortBy={key}
                active={sortKey === key}
                dir={sortDir}
                onSort={toggleSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const followUp = activeFollowUpAt(l.next_follow_up_at, l.last_call_outcome)
            const overdue = isFollowUpOverdue(l.next_follow_up_at, l.last_call_outcome)
            return (
              <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(l.id)}>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.title}</div>
                  {l.phone && <div className="muted small">{l.phone}</div>}
                </td>
                <td className="muted">{l.company ?? '—'}</td>
                <td>
                  <span className="badge badge-indigo">{l.pipeline_name ?? '—'}</span>
                </td>
                <td>
                  <span className={`badge ${STAGE_COLOR[l.stage] ?? 'badge-slate'}`}>
                    {STAGE_LABELS[l.stage] ?? l.stage}
                  </span>
                </td>
                <td>
                  <span className={`score-badge ${scoreClass(l.lead_score)}`}>{l.lead_score}</span>
                </td>
                <td>{l.estimated_value ? fmtINR(l.estimated_value) : '—'}</td>
                <td className={overdue ? 'error' : undefined}>
                  {followUp ? `${fmtDateTime(followUp)}${overdue ? ' · overdue' : ''}` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FollowUpsView({
  leads,
  loading,
  onOpen,
}: {
  leads: Lead[]
  loading: boolean
  onOpen: (leadId: string, tab?: 'call') => void
}) {
  const [tab, setTab] = useState<'all' | 'today' | 'overdue'>('all')
  const [search, setSearch] = useState('')

  const grouped = useMemo(() => {
    const g: Record<FollowUpBucket, Lead[]> = {
      overdue: [],
      due_now: [],
      later_today: [],
      upcoming: [],
      unscheduled: [],
    }
    for (const l of leads) g[followUpBucket(l.next_follow_up_at)].push(l)
    return g
  }, [leads])

  const dueToday = grouped.due_now.length + grouped.later_today.length
  const overdue = grouped.overdue.length
  const quoted = leads.filter((l) =>
    ['QUOTATION', 'NEGOTIATION', 'SAMPLE', 'WON'].includes(l.stage),
  ).length
  const won = leads.filter((l) => l.stage === 'WON').length

  const qtext = search.trim().toLowerCase()
  const rows = leads
    .filter((l) => {
      const bucket = followUpBucket(l.next_follow_up_at)
      if (tab === 'today') return bucket === 'due_now' || bucket === 'later_today'
      if (tab === 'overdue') return bucket === 'overdue' || bucket === 'due_now'
      return true
    })
    .filter((l) => {
      if (!qtext) return true
      return [l.title, l.phone, l.company, l.notes].some((f) =>
        (f ?? '').toLowerCase().includes(qtext),
      )
    })
    .sort((a, b) => (a.next_follow_up_at ?? '').localeCompare(b.next_follow_up_at ?? ''))

  if (loading) return <TableSkeleton />

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="metrics-grid">
        <MetricCard tone="purple" label="Total follow-ups" value={leads.length} hint="Scheduled" />
        <MetricCard tone="green" label="Due today" value={dueToday} hint="High priority" />
        <MetricCard tone="red" label="Overdue" value={overdue} hint="Requires action" />
        <MetricCard
          tone="blue"
          label="Upcoming"
          value={grouped.upcoming.length}
          hint="Later dates"
        />
        <MetricCard
          tone="amber"
          label="Turning into quotes"
          value={fmtPct(quoted, leads.length)}
          hint={`${quoted} to quotes · ${won} orders`}
        />
      </div>

      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="panel-tabs" style={{ marginBottom: 0 }}>
          {(
            [
              { key: 'all', label: `All follow-ups (${leads.length})` },
              { key: 'today', label: `Due today (${dueToday})` },
              { key: 'overdue', label: `Overdue (${overdue})` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              className={`panel-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="input"
          type="search"
          placeholder="Search follow-ups…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: 'auto', maxWidth: 260 }}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No follow-ups here"
          description="Set a call outcome of Follow Up on a lead to schedule one."
        />
      ) : (
        <div className="table-wrap">
          <table className="follow-ups-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Stage</th>
                <th scope="col">Next follow-up</th>
                <th scope="col">Status</th>
                <th scope="col">Why</th>
                <th scope="col">Owner</th>
                <th scope="col">Last contact</th>
                <th scope="col">Do</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const bucket = followUpBucket(l.next_follow_up_at)
                const status = statusLabel(bucket)
                const late = bucket === 'overdue' || bucket === 'due_now'
                return (
                  <tr key={l.id} onClick={() => onOpen(l.id)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.title}</div>
                      {l.phone && <div className="muted small">{l.phone}</div>}
                      {l.company && <div className="muted small">{l.company}</div>}
                    </td>
                    <td>
                      <span className={`badge ${STAGE_COLOR[l.stage] ?? 'badge-slate'}`}>
                        {STAGE_LABELS[l.stage] ?? l.stage}
                      </span>
                    </td>
                    <td>
                      <div>{fmtDateTime(l.next_follow_up_at)}</div>
                      {l.next_follow_up_at && (
                        <div className={late ? 'error small' : 'muted small'}>
                          {fmtFollowUpRelative(l.next_follow_up_at)}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${status.cls}`}>{status.text}</span>
                    </td>
                    <td style={{ maxWidth: 220 }} className="muted small">
                      {followUpReason(l) ?? '—'}
                    </td>
                    <td className="muted small">{l.last_call_logged_by ?? '—'}</td>
                    <td className="muted small">
                      {l.last_call_at ? fmtDateTime(l.last_call_at) : '—'}
                    </td>
                    <td>
                      <div className="row" style={{ gap: '0.35rem' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpen(l.id, 'call')
                          }}
                        >
                          <Phone size={13} />
                          Call
                        </button>
                        {l.phone && (
                          <a
                            className="btn btn-ghost btn-sm"
                            href={`https://wa.me/${l.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MessageCircle size={13} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
