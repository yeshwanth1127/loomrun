import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart2,
  Columns,
  Plus,
  Settings,
  Table2,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { KanbanSkeleton, TableSkeleton } from '../components/ui/Skeleton'
import {
  BarList,
  FunnelChart,
  InsightCard,
  InsightGrid,
  MetricCard,
} from '../components/ui/dashboard'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { routes } from '../lib/appRoutes'
import { fmtINR, timeAgo } from '../lib/format'
import type { Pipeline, PipelineStage } from './PipelinesPage'

type WorkspaceTab = 'overview' | 'board' | 'table' | 'settings'

type PipelineLead = {
  id: string
  title: string
  stage: string
  source: string
  company: string | null
  product_interest: string | null
  city: string | null
  lead_score: number
  estimated_value: number | null
  pipeline_id: string | null
  pipeline_stage_id: string | null
  pipeline_stage_name?: string | null
  pipeline_stage_kind?: string | null
  updated_at: string
}

type RoutingRule = {
  id?: string
  pipeline_id: string
  priority: number
  is_active: boolean
  source: string | null
  campaign_id: string | null
  campaign_name: string | null
  region: string | null
  product_interest: string | null
  sector: string | null
  pipeline_name?: string | null
}

type StageDraft = {
  id?: string
  name: string
  kind: string
  probability: string
  system_key?: string | null
}

type OverviewResponse = {
  pipeline: Pipeline
  kpis: {
    total_leads: number
    open_leads: number
    won_leads: number
    lost_leads: number
    avg_lead_age_hours: number
    conversion_rate: number
    in_progress: number
    closed: number
  }
  funnel: Array<PipelineStage & { count: number; percent: number }>
  values: {
    total_pipeline_value: number
    weighted_pipeline_value: number
    won_value: number
    lost_value: number
    conversion_rate: number
  }
  sources: Array<{ source: string; label: string; leads_count: number }>
  recent_activity: Array<{
    id: string
    body: string
    lead_title: string | null
    user_name: string | null
    created_at: string | null
  }>
}

const SOURCE_OPTIONS = [
  'META_ADS',
  'GOOGLE_ADS',
  'INDIAMART',
  'WHATSAPP',
  'INSTAGRAM',
  'WEB',
  'WEBSITE',
  'REFERRAL',
  'TELECALLER',
  'MANUAL',
  'OTHER',
] as const

const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  TELECALLER: 'Telecaller',
  INSTAGRAM: 'Instagram',
  WEB: 'Website',
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  META_ADS: 'Meta Ads',
  GOOGLE_ADS: 'Google Ads',
  INDIAMART: 'IndiaMART',
  MANUAL: 'Manual',
  OTHER: 'Other',
}

const FUNNEL_COLORS = ['#0F766E', '#2563eb', '#7c3aed', '#ea580c', '#0891b2', '#B07A2E', '#10b981', '#ef4444']

const STAGE_KINDS = ['OPEN', 'WON', 'LOST'] as const

function scoreClass(score: number) {
  if (score >= 70) return 'green'
  if (score >= 40) return 'amber'
  return 'red'
}

function invalidateWorkspace(qc: ReturnType<typeof useQueryClient>, orgId: string, pipelineId: string) {
  void qc.invalidateQueries({ queryKey: ['pipeline-overview', orgId, pipelineId] })
  void qc.invalidateQueries({ queryKey: ['pipeline-leads', orgId, pipelineId] })
  void qc.invalidateQueries({ queryKey: ['pipelines', orgId] })
  void qc.invalidateQueries({ queryKey: ['pipeline-routing-rules', orgId] })
}

function stageToDraft(stage: PipelineStage): StageDraft {
  return {
    id: stage.id,
    name: stage.name,
    kind: stage.kind,
    probability: stage.probability != null ? String(stage.probability) : '',
    system_key: stage.system_key,
  }
}

function emptyRule(pipelineId: string, priority: number): RoutingRule {
  return {
    pipeline_id: pipelineId,
    priority,
    is_active: true,
    source: null,
    campaign_id: null,
    campaign_name: null,
    region: null,
    product_interest: null,
    sector: null,
  }
}

type AttributionCampaign = {
  source: string
  campaign_id: string
  campaign_name: string
  lead_count: number
  last_seen_at: string | null
}


type MatchPreview = {
  matched: number
  already_in_target: number
  movable: number
  pipeline_id: string | null
}

type ApplyResult = {
  matched: number
  moved: number
  already_in_target: number
  failed: number
  stages_preserved?: number
  pipeline_id: string
  pipeline_name: string
  pipeline_stage_id: string
  pipeline_stage_name: string
}

type ReplacePreview = {
  move_outs: Array<{
    pipeline_id: string
    pipeline_name: string
    campaign_id: string | null
    campaign_name: string | null
    campaign_label: string
    count: number
    default_pipeline_name: string
  }>
  move_ins: Array<{
    pipeline_id: string
    pipeline_name: string
    campaign_id: string | null
    campaign_name: string | null
    campaign_label: string
    matched: number
    already_in_target: number
    movable: number
  }>
  moved_out: number
  moved_in: number
  already_in_target: number
  is_replacement: boolean
  default_pipeline_name: string
}

type RoutingSaveResult = {
  items: RoutingRule[]
  migrations?: ApplyResult[]
  move_outs?: Array<{
    moved: number
    failed: number
    campaign_name?: string | null
    campaign_id?: string | null
    target_pipeline_name?: string
  }>
  replacement?: {
    moved_out: number
    moved_in: number
    already_in_target: number
    failed: number
  }
}

function ruleHasMatchFields(rule: Pick<RoutingRule, 'source' | 'campaign_id' | 'campaign_name' | 'region' | 'product_interest' | 'sector'>) {
  return Boolean(
    rule.source
    || rule.campaign_id?.trim()
    || rule.campaign_name?.trim()
    || rule.region?.trim()
    || rule.product_interest?.trim()
    || rule.sector?.trim(),
  )
}

function RuleMatchActions({
  orgId,
  rule,
  pipelineName,
  onApplied,
}: {
  orgId: string
  rule: RoutingRule
  pipelineName: string
  onApplied: (result: ApplyResult) => void
}) {
  const qc = useQueryClient()
  const canPreview = ruleHasMatchFields(rule)
  const isCampaignRule = Boolean(rule.campaign_id?.trim() || rule.campaign_name?.trim())
  const previewKey = useMemo(
    () =>
      JSON.stringify({
        pipeline_id: rule.pipeline_id,
        source: rule.source,
        campaign_id: rule.campaign_id,
        campaign_name: rule.campaign_name,
        region: rule.region,
        product_interest: rule.product_interest,
        sector: rule.sector,
      }),
    [rule],
  )

  const previewQ = useQuery({
    queryKey: ['routing-rule-preview', orgId, previewKey],
    enabled: !!orgId && canPreview,
    queryFn: () =>
      apiFetch<MatchPreview>(`/v1/orgs/${orgId}/pipelines/routing-rules/preview-matches`, {
        method: 'POST',
        json: {
          pipeline_id: rule.pipeline_id,
          source: rule.source,
          campaign_id: rule.campaign_id,
          campaign_name: rule.campaign_name,
          region: rule.region,
          product_interest: rule.product_interest,
          sector: rule.sector,
        },
      }),
  })

  const applyMutation = useMutation({
    mutationFn: () =>
      apiFetch<ApplyResult>(
        rule.id
          ? `/v1/orgs/${orgId}/pipelines/routing-rules/${rule.id}/apply`
          : `/v1/orgs/${orgId}/pipelines/routing-rules/apply`,
        {
          method: 'POST',
          json: rule.id
            ? {}
            : {
                pipeline_id: rule.pipeline_id,
                source: rule.source,
                campaign_id: rule.campaign_id,
                campaign_name: rule.campaign_name,
                region: rule.region,
                product_interest: rule.product_interest,
                sector: rule.sector,
              },
        },
      ),
    onSuccess: (result) => {
      toast.success(
        `Moved ${result.moved} lead${result.moved === 1 ? '' : 's'} to ${result.pipeline_name}`
        + (result.already_in_target ? ` · ${result.already_in_target} already there` : '')
        + (result.failed ? ` · ${result.failed} failed` : ''),
      )
      onApplied(result)
      void qc.invalidateQueries({ queryKey: ['routing-rule-preview', orgId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to apply rule'),
  })

  function confirmAndApply() {
    const matched = previewQ.data?.matched ?? 0
    const movable = previewQ.data?.movable ?? matched
    if (!movable) {
      toast.message('No matching leads to move')
      return
    }
    const ok = window.confirm(
      `${matched} existing lead${matched === 1 ? '' : 's'} currently match this rule. `
      + `Move ${movable} to "${pipelineName}"?`,
    )
    if (!ok) return
    applyMutation.mutate()
  }

  if (!canPreview) {
    return (
      <p className="muted small" style={{ marginTop: '0.5rem' }}>
        Set at least one match field to see existing lead matches.
      </p>
    )
  }

  const matched = previewQ.data?.matched
  const movable = previewQ.data?.movable
  const already = previewQ.data?.already_in_target
  const campaignLabel = rule.campaign_name || rule.campaign_id || 'this campaign'

  return (
    <div className="stack" style={{ gap: '0.45rem', marginTop: '0.65rem' }}>
      <div className="muted small">
        {previewQ.isFetching && !previewQ.data
          ? 'Counting matching leads…'
          : matched == null
            ? '—'
            : (
              <>
                <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                  {campaignLabel}
                </div>
                <div>
                  {matched} existing lead{matched === 1 ? '' : 's'}
                  {already ? ` · ${already} already on ${pipelineName}` : ''}
                  {movable != null && movable > 0 ? ` · ${movable} will move here` : ''}
                </div>
              </>
            )}
      </div>
      {isCampaignRule && (movable ?? 0) > 0 ? (
        <p className="small" style={{ margin: 0, color: 'var(--foreground)' }}>
          {(movable ?? 0)} existing lead{(movable ?? 0) === 1 ? '' : 's'} will be moved into this
          pipeline on Save. Changing the campaign replaces this pipeline&apos;s population — previous
          campaign leads on this pipeline return to the default pipeline.
        </p>
      ) : null}
      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={applyMutation.isPending || !movable}
          onClick={confirmAndApply}
          title="Re-run migration for matching leads (also runs automatically on Save for campaign rules)"
        >
          {applyMutation.isPending ? 'Applying…' : 'Re-apply to existing leads'}
        </button>
      </div>
    </div>
  )
}

function RuleCampaignFields({
  orgId,
  source,
  campaignId,
  campaignName,
  onChange,
}: {
  orgId: string
  source: string | null
  campaignId: string | null
  campaignName: string | null
  onChange: (patch: { campaign_id: string | null; campaign_name: string | null }) => void
}) {
  const [manual, setManual] = useState(false)
  const campaignsQ = useQuery({
    queryKey: ['lead-attribution-campaigns', orgId, source ?? 'ALL'],
    enabled: !!orgId,
    queryFn: () => {
      const qs = source ? `?source=${encodeURIComponent(source)}` : ''
      return apiFetch<{ items: AttributionCampaign[] }>(
        `/v1/orgs/${orgId}/lead-attribution/campaigns${qs}`,
      )
    },
  })

  const items = campaignsQ.data?.items ?? []
  const selectedInList = Boolean(campaignId && items.some((c) => c.campaign_id === campaignId))
  const selected =
    campaignId == null
      ? null
      : items.find((c) => c.campaign_id === campaignId) ?? {
          source: source ?? '',
          campaign_id: campaignId,
          campaign_name: campaignName || campaignId,
          lead_count: 0,
          last_seen_at: null,
        }
  // Don't flip into manual mode while the list is still loading — that made
  // selections look like they "didn't stick" right after picking a campaign.
  const showManual = manual || Boolean(campaignId && !selectedInList && !campaignsQ.isLoading)

  return (
    <div className="stack" style={{ gap: '0.4rem', minWidth: '18rem', flex: '1 1 18rem' }}>
      <select
        className="select"
        value={showManual ? '__manual__' : selectedInList && campaignId ? campaignId : ''}
        disabled={campaignsQ.isLoading}
        onChange={(e) => {
          const v = e.target.value
          if (v === '__manual__') {
            setManual(true)
            return
          }
          setManual(false)
          if (!v) {
            onChange({ campaign_id: null, campaign_name: null })
            return
          }
          const hit = items.find((c) => c.campaign_id === v)
          onChange({
            campaign_id: v,
            campaign_name: hit?.campaign_name ?? null,
          })
        }}
        title="Pick a campaign already seen on leads"
      >
        <option value="">
          {campaignsQ.isLoading
            ? 'Loading campaigns…'
            : items.length
              ? 'Any campaign'
              : source
                ? 'No campaigns seen for this source yet'
                : 'No campaigns seen yet'}
        </option>
        {items.map((c) => (
          <option key={`${c.source}:${c.campaign_id}`} value={c.campaign_id}>
            {c.campaign_name}
          </option>
        ))}
        <option value="__manual__">Enter campaign manually…</option>
      </select>

      {selected && !showManual ? (
        <div
          className="card"
          style={{
            padding: '0.55rem 0.7rem',
            background: 'var(--surface, var(--bg))',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>
            {selected.campaign_name}
          </div>
          <div className="muted small" style={{ marginTop: '0.15rem' }}>
            ID {selected.campaign_id}
            {selected.lead_count ? ` · ${selected.lead_count} leads` : ''}
          </div>
        </div>
      ) : null}

      {showManual ? (
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Campaign ID (required for match)"
            value={campaignId ?? ''}
            onChange={(e) =>
              onChange({
                campaign_id: e.target.value.trim() || null,
                campaign_name: campaignName,
              })
            }
            style={{ flex: '1 1 10rem' }}
          />
          <input
            className="input"
            placeholder="Campaign name (optional)"
            value={campaignName ?? ''}
            onChange={(e) =>
              onChange({
                campaign_id: campaignId,
                campaign_name: e.target.value.trim() || null,
              })
            }
            style={{ flex: '1 1 10rem' }}
          />
          {items.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setManual(false)
                if (!selectedInList) onChange({ campaign_id: null, campaign_name: null })
              }}
            >
              Use list
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ── Kanban ────────────────────────────────────────────────────────────────────

function PipelineKanbanCard({
  lead,
  onDragStart,
  onDragEnd,
}: {
  lead: PipelineLead
  onDragStart: (id: string) => void
  onDragEnd: () => void
}) {
  const sc = scoreClass(lead.lead_score)
  const meta = lead.company || lead.product_interest || null
  return (
    <div
      className={`kanban-card score-${sc}`}
      draggable
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(lead.id)
      }}
      onDragEnd={onDragEnd}
    >
      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)', marginBottom: '0.35rem', lineHeight: 1.3 }}>
        {lead.title}
      </div>
      {meta && <div className="kanban-card-meta">{meta}</div>}
      <div className="row" style={{ gap: '0.35rem', marginBottom: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="source-pill">{SOURCE_LABELS[lead.source] ?? lead.source}</span>
        <span className={`score-badge ${sc}`} style={{ fontSize: '0.65rem' }}>{lead.lead_score}</span>
      </div>
      <div className="muted small" style={{ fontSize: '0.7rem' }}>
        {[lead.city, timeAgo(lead.updated_at)].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

function PipelineBoard({
  stages,
  leads,
  onStageChange,
}: {
  stages: PipelineStage[]
  leads: PipelineLead[]
  onStageChange: (leadId: string, stageId: string) => void
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const openStages = stages.filter((s) => s.kind === 'OPEN')
  const closedStages = stages.filter((s) => s.kind === 'WON' || s.kind === 'LOST')
  const visibleStages = showClosed ? stages : openStages
  const closedCount = leads.filter((l) => {
    const stage = stages.find((s) => s.id === l.pipeline_stage_id)
    return stage?.kind === 'WON' || stage?.kind === 'LOST'
  }).length

  function handleDrop(stageId: string) {
    if (draggedId) {
      const lead = leads.find((l) => l.id === draggedId)
      if (lead && lead.pipeline_stage_id !== stageId) onStageChange(draggedId, stageId)
    }
    setDraggedId(null)
    setDragOverStageId(null)
  }

  return (
    <div className="kanban-wrap">
      {closedStages.length > 0 && (
        <div className="kanban-closed-toggle">
          <button
            type="button"
            className={`btn btn-sm ${showClosed ? 'btn-secondary' : 'btn-ghost'}`}
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? 'Hide closed' : `Show closed (${closedCount})`}
          </button>
        </div>
      )}
      <div className="kanban-board">
        {visibleStages.map((stage) => {
          const colLeads = leads.filter((l) => l.pipeline_stage_id === stage.id)
          const est = colLeads.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0)
          return (
            <div className="kanban-col" key={stage.id}>
              <div className="kanban-col-header">
                <span className="kanban-col-title">{stage.name}</span>
                <span className="kanban-col-count">{colLeads.length}</span>
                {est > 0 && <span className="kanban-col-est">{fmtINR(est)}</span>}
              </div>
              <div
                className={`kanban-col-body${dragOverStageId === stage.id ? ' drag-over' : ''}`}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault()
                  setDragOverStageId(stage.id)
                }}
                onDragLeave={() => setDragOverStageId(null)}
                onDrop={() => handleDrop(stage.id)}
              >
                {colLeads.map((lead) => (
                  <PipelineKanbanCard
                    key={lead.id}
                    lead={lead}
                    onDragStart={setDraggedId}
                    onDragEnd={() => {
                      setDraggedId(null)
                      setDragOverStageId(null)
                    }}
                  />
                ))}
                {colLeads.length === 0 && (
                  <div className="muted" style={{ fontSize: '0.75rem', textAlign: 'center', padding: '1.5rem 0.5rem', opacity: 0.55 }}>
                    Drop leads here
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PipelineWorkspacePage() {
  const { orgId } = useAuth()
  const { pipelineId } = useParams<{ pipelineId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<WorkspaceTab>('overview')
  const [stageDrafts, setStageDrafts] = useState<StageDraft[]>([])
  const [ruleDrafts, setRuleDrafts] = useState<RoutingRule[]>([])
  const [rulesDirty, setRulesDirty] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [moveLeadsTo, setMoveLeadsTo] = useState('')

  const overviewQ = useQuery({
    queryKey: ['pipeline-overview', orgId, pipelineId],
    enabled: !!orgId && !!pipelineId,
    queryFn: () =>
      apiFetch<OverviewResponse>(`/v1/orgs/${orgId}/pipelines/${pipelineId}/overview`),
  })

  const leadsQ = useQuery({
    queryKey: ['pipeline-leads', orgId, pipelineId],
    enabled: !!orgId && !!pipelineId && (tab === 'board' || tab === 'table'),
    queryFn: () => {
      const params = new URLSearchParams({ pipeline_id: pipelineId!, day: 'all' })
      return apiFetch<{ items: PipelineLead[] }>(`/v1/orgs/${orgId}/leads?${params}`)
    },
  })

  const pipelinesQ = useQuery({
    queryKey: ['pipelines', orgId, true],
    enabled: !!orgId && tab === 'settings',
    queryFn: () =>
      apiFetch<{ items: Pipeline[] }>(`/v1/orgs/${orgId}/pipelines?include_archived=false`),
  })

  const rulesQ = useQuery({
    queryKey: ['pipeline-routing-rules', orgId],
    enabled: !!orgId && tab === 'settings',
    queryFn: () =>
      apiFetch<{ items: RoutingRule[] }>(`/v1/orgs/${orgId}/pipelines/routing-rules`),
  })

  const pipeline = overviewQ.data?.pipeline
  const stages = pipeline?.stages ?? []

  useEffect(() => {
    if (tab !== 'settings') return
    const currentStages = overviewQ.data?.pipeline.stages ?? []
    if (currentStages.length > 0) {
      setStageDrafts(currentStages.map(stageToDraft))
    }
  }, [tab, pipelineId, overviewQ.data?.pipeline.id])

  useEffect(() => {
    setRulesDirty(false)
  }, [tab, pipelineId])

  useEffect(() => {
    if (tab !== 'settings' || !rulesQ.data || rulesDirty) return
    setRuleDrafts(rulesQ.data.items)
  }, [tab, pipelineId, rulesQ.data, rulesDirty])

  const updateStage = useMutation({
    mutationFn: ({ leadId, stageId }: { leadId: string; stageId: string }) =>
      apiFetch(`/v1/orgs/${orgId}/leads/${leadId}`, {
        method: 'PATCH',
        json: { pipeline_stage_id: stageId },
      }),
    onMutate: async ({ leadId, stageId }) => {
      await qc.cancelQueries({ queryKey: ['pipeline-leads', orgId, pipelineId] })
      const prev = qc.getQueryData<{ items: PipelineLead[] }>(['pipeline-leads', orgId, pipelineId])
      const stage = stages.find((s) => s.id === stageId)
      qc.setQueryData<{ items: PipelineLead[] }>(['pipeline-leads', orgId, pipelineId], (old) =>
        old
          ? {
              items: old.items.map((l) =>
                l.id === leadId
                  ? {
                      ...l,
                      pipeline_stage_id: stageId,
                      pipeline_stage_name: stage?.name ?? l.pipeline_stage_name,
                      pipeline_stage_kind: stage?.kind ?? l.pipeline_stage_kind,
                    }
                  : l,
              ),
            }
          : old,
      )
      return { prev }
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['pipeline-leads', orgId, pipelineId], ctx.prev)
      toast.error(err.message || 'Failed to move lead')
    },
    onSettled: () => {
      if (orgId && pipelineId) invalidateWorkspace(qc, orgId, pipelineId)
    },
  })

  const saveStages = useMutation({
    mutationFn: () =>
      apiFetch<Pipeline>(`/v1/orgs/${orgId}/pipelines/${pipelineId}/stages`, {
        method: 'PUT',
        json: {
          stages: stageDrafts.map((s) => ({
            id: s.id,
            name: s.name.trim(),
            kind: s.kind,
            probability: s.probability.trim() ? Number(s.probability) : null,
            system_key: s.system_key ?? undefined,
          })),
        },
      }),
    onSuccess: (data) => {
      toast.success('Stages saved')
      setStageDrafts((data.stages ?? []).map(stageToDraft))
      if (orgId && pipelineId) invalidateWorkspace(qc, orgId, pipelineId)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save stages'),
  })

  const saveRules = useMutation({
    mutationFn: async () => {
      const payload = ruleDrafts.map((r, idx) => ({
        pipeline_id: r.pipeline_id,
        priority: idx,
        is_active: r.is_active,
        source: r.source || null,
        campaign_id: r.campaign_id?.trim() || null,
        campaign_name: r.campaign_name?.trim() || null,
        region: r.region?.trim() || null,
        product_interest: r.product_interest?.trim() || null,
        sector: r.sector?.trim() || null,
      }))

      const preview = await apiFetch<ReplacePreview>(
        `/v1/orgs/${orgId}/pipelines/routing-rules/preview-replace`,
        { method: 'POST', json: { rules: payload } },
      )

      if (preview.is_replacement || preview.moved_in > 0 || preview.moved_out > 0) {
        const lines: string[] = []
        if (preview.is_replacement) {
          lines.push('Changing campaign will replace the leads in this pipeline.')
          lines.push('')
        }
        for (const out of preview.move_outs) {
          if (out.count <= 0) continue
          lines.push(
            `${out.count} lead${out.count === 1 ? '' : 's'} from ${out.campaign_label}`
            + ` will move back to ${out.default_pipeline_name}.`,
          )
        }
        for (const inn of preview.move_ins) {
          if (inn.movable <= 0) continue
          lines.push(
            `${inn.movable} lead${inn.movable === 1 ? '' : 's'} from ${inn.campaign_label}`
            + ` will move into ${inn.pipeline_name}.`,
          )
        }
        if (preview.already_in_target > 0 && !preview.is_replacement) {
          lines.push(
            `${preview.already_in_target} matching lead${preview.already_in_target === 1 ? '' : 's'}`
            + ' already on the target pipeline.',
          )
        }
        if (!preview.is_replacement && preview.moved_in > 0 && preview.moved_out === 0) {
          lines.push('Future leads from this campaign will also route here.')
        }
        lines.push('', 'Continue?')
        const ok = window.confirm(lines.join('\n'))
        if (!ok) throw new Error('Save cancelled')
      }

      return apiFetch<RoutingSaveResult>(`/v1/orgs/${orgId}/pipelines/routing-rules`, {
        method: 'PUT',
        json: { rules: payload },
      })
    },
    onSuccess: (data) => {
      setRuleDrafts(data.items)
      setRulesDirty(false)
      void qc.invalidateQueries({ queryKey: ['pipeline-routing-rules', orgId] })
      void qc.invalidateQueries({ queryKey: ['routing-rule-preview', orgId] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      if (orgId && pipelineId) invalidateWorkspace(qc, orgId, pipelineId)
      const rep = data.replacement
      if (rep && (rep.moved_out > 0 || rep.moved_in > 0 || rep.failed > 0)) {
        toast.success(
          `Routing saved · ${rep.moved_out} moved out · ${rep.moved_in} moved in`
          + (rep.already_in_target ? ` · ${rep.already_in_target} already assigned` : '')
          + (rep.failed ? ` · ${rep.failed} failed` : ''),
        )
      } else {
        const moved = (data.migrations ?? []).reduce((n, r) => n + r.moved, 0)
        if (moved > 0) {
          toast.success(`Routing saved · moved ${moved} existing lead${moved === 1 ? '' : 's'}`)
        } else {
          toast.success('Routing rules saved')
        }
      }
    },
    onError: (err: Error) => {
      if (err.message === 'Save cancelled') return
      toast.error(err.message || 'Failed to save routing rules')
    },
  })

  const archivePipeline = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/pipelines/${pipelineId}`, {
        method: 'PATCH',
        json: { is_active: false },
      }),
    onSuccess: () => {
      toast.success('Pipeline archived')
      if (orgId && pipelineId) invalidateWorkspace(qc, orgId, pipelineId)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to archive pipeline'),
  })

  const deletePipeline = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/pipelines/${pipelineId}`, {
        method: 'DELETE',
        json: moveLeadsTo ? { move_leads_to_pipeline_id: moveLeadsTo } : undefined,
      }),
    onSuccess: () => {
      toast.success('Pipeline deleted')
      void qc.invalidateQueries({ queryKey: ['pipelines', orgId] })
      navigate(routes.salesOrganize)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete pipeline'),
  })

  function moveStage(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= stageDrafts.length) return
    setStageDrafts((rows) => {
      const copy = [...rows]
      const [row] = copy.splice(idx, 1)
      copy.splice(next, 0, row)
      return copy
    })
  }

  function updateRule(idx: number, patch: Partial<RoutingRule>) {
    setRulesDirty(true)
    setRuleDrafts((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  if (!orgId || !pipelineId) {
    return <PageHeader title="Pipeline" description="Select an organization." />
  }

  if (overviewQ.isLoading) {
    return <p className="muted center" style={{ padding: '2rem' }}>Loading pipeline…</p>
  }

  if (overviewQ.error || !pipeline) {
    return (
      <div className="page">
        <PageHeader
          title="Pipeline not found"
          description={(overviewQ.error as Error)?.message ?? 'This pipeline may have been deleted.'}
          actions={
            <Link to={routes.salesOrganize} className="btn btn-secondary">
              <ArrowLeft size={15} /> Back to pipelines
            </Link>
          }
        />
      </div>
    )
  }

  const leads = leadsQ.data?.items ?? []
  const overview = overviewQ.data
  const otherPipelines = (pipelinesQ.data?.items ?? []).filter((p) => p.id !== pipelineId)

  return (
    <div className={tab === 'board' ? 'leads-page leads-page--board' : 'page'}>
      <PageHeader
        title={pipeline.name}
        badge={pipeline.is_default ? 'Default' : undefined}
        description={
          <>
            {pipeline.type} workspace · {overview?.kpis.total_leads ?? 0} lead{(overview?.kpis.total_leads ?? 0) === 1 ? '' : 's'}
          </>
        }
        actions={
          <Link to={routes.salesOrganize} className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} /> All pipelines
          </Link>
        }
      />

      {!pipeline.is_active && (
        <div
          className="trial-banner trial-banner--expired"
          style={{ margin: '0 1.5rem 0.75rem', borderRadius: 'var(--radius)' }}
        >
          This pipeline is archived. New leads will not be routed here.
        </div>
      )}

      <div className="panel-tabs" style={{ margin: '0 1.5rem' }}>
        {([
          ['overview', 'Overview', BarChart2],
          ['board', 'Board', Columns],
          ['table', 'Table', Table2],
          ['settings', 'Settings', Settings],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            className={`panel-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            <span className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
              <Icon size={14} /> {label}
            </span>
          </button>
        ))}
      </div>

      {tab === 'overview' && overview && (
        <div className="page-body stack" style={{ gap: '1.25rem' }}>
          <div className="metrics-grid">
            <MetricCard icon={BarChart2} tone="purple" label="Total leads" value={overview.kpis.total_leads} />
            <MetricCard icon={BarChart2} tone="blue" label="In progress" value={overview.kpis.open_leads} />
            <MetricCard icon={BarChart2} tone="green" label="Won" value={overview.kpis.won_leads} />
            <MetricCard icon={BarChart2} tone="amber" label="Conversion" value={`${overview.kpis.conversion_rate}%`} />
            <MetricCard
              icon={BarChart2}
              tone="purple"
              label="Pipeline value"
              value={fmtINR(overview.values.total_pipeline_value)}
            />
            <MetricCard
              icon={BarChart2}
              tone="blue"
              label="Weighted value"
              value={fmtINR(overview.values.weighted_pipeline_value)}
            />
          </div>

          <InsightGrid>
            <InsightCard title="Funnel by stage">
              {overview.funnel.length === 0 ? (
                <p className="muted small">No stages configured.</p>
              ) : (
                <FunnelChart
                  steps={overview.funnel.map((s, i) => ({
                    label: s.name,
                    value: s.count,
                    color: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                  }))}
                />
              )}
            </InsightCard>
            <InsightCard title="Lead sources">
              {overview.sources.length === 0 ? (
                <p className="muted small">No leads yet.</p>
              ) : (
                <BarList
                  items={overview.sources.map((s, i) => ({
                    label: s.label,
                    value: s.leads_count,
                    color: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                  }))}
                />
              )}
            </InsightCard>
          </InsightGrid>

          {overview.recent_activity.length > 0 && (
            <div className="card" style={{ padding: '1rem' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>Recent stage changes</h3>
              <ul className="stack" style={{ gap: '0.5rem', listStyle: 'none', padding: 0, margin: 0 }}>
                {overview.recent_activity.map((a) => (
                  <li key={a.id} className="muted small">
                    <strong style={{ color: 'var(--foreground)' }}>{a.lead_title ?? 'Lead'}</strong>
                    {' — '}{a.body}
                    {a.user_name ? ` · ${a.user_name}` : ''}
                    {a.created_at ? ` · ${timeAgo(a.created_at)}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'board' && (
        <div className="page-body page-body--board">
          {leadsQ.isLoading && <KanbanSkeleton />}
          {!leadsQ.isLoading && stages.length === 0 && (
            <EmptyState title="No stages" description="Add stages in Settings to use the board." />
          )}
          {!leadsQ.isLoading && stages.length > 0 && (
            <PipelineBoard
              stages={stages}
              leads={leads}
              onStageChange={(leadId, stageId) => updateStage.mutate({ leadId, stageId })}
            />
          )}
        </div>
      )}

      {tab === 'table' && (
        <div className="page-body">
          {leadsQ.isLoading && <TableSkeleton rows={8} />}
          {!leadsQ.isLoading && leads.length === 0 && (
            <EmptyState title="No leads in this pipeline" description="Leads routed here will appear in this table." />
          )}
          {!leadsQ.isLoading && leads.length > 0 && (
            <div className="table-wrap card">
              <table>
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Stage</th>
                    <th>Source</th>
                    <th>Score</th>
                    <th>Value</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{lead.title}</div>
                        {lead.company && <div className="muted small">{lead.company}</div>}
                      </td>
                      <td>
                        <span className="badge badge-purple">
                          {lead.pipeline_stage_name ?? '—'}
                        </span>
                      </td>
                      <td className="muted">{SOURCE_LABELS[lead.source] ?? lead.source}</td>
                      <td>{lead.lead_score}</td>
                      <td>{lead.estimated_value ? fmtINR(lead.estimated_value) : '—'}</td>
                      <td className="muted small">{timeAgo(lead.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="page-body stack" style={{ gap: '1.5rem' }}>
          <section className="card stack" style={{ gap: '0.75rem', padding: '1rem' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Stages</h3>
              <div className="row" style={{ gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    setStageDrafts((rows) => [
                      ...rows,
                      { name: 'New stage', kind: 'OPEN', probability: '10' },
                    ])
                  }
                >
                  <Plus size={14} /> Add stage
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={saveStages.isPending || stageDrafts.length === 0}
                  onClick={() => saveStages.mutate()}
                >
                  {saveStages.isPending ? 'Saving…' : 'Save stages'}
                </button>
              </div>
            </div>

            <div className="stack" style={{ gap: '0.5rem' }}>
              {stageDrafts.map((stage, idx) => (
                <div key={stage.id ?? `new-${idx}`} className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveStage(idx, -1)} disabled={idx === 0}>
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => moveStage(idx, 1)}
                    disabled={idx === stageDrafts.length - 1}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <input
                    className="input"
                    value={stage.name}
                    onChange={(e) =>
                      setStageDrafts((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)),
                      )
                    }
                    style={{ flex: '1 1 160px' }}
                  />
                  <select
                    className="select"
                    value={stage.kind}
                    onChange={(e) =>
                      setStageDrafts((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, kind: e.target.value } : r)),
                      )
                    }
                  >
                    {STAGE_KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="Prob %"
                    value={stage.probability}
                    onChange={(e) =>
                      setStageDrafts((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, probability: e.target.value } : r)),
                      )
                    }
                    style={{ width: 90 }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setStageDrafts((rows) => rows.filter((_, i) => i !== idx))}
                    disabled={stageDrafts.length <= 1}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="card stack" style={{ gap: '0.75rem', padding: '1rem' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Routing rules</h3>
                <p className="muted small" style={{ margin: '0.25rem 0 0' }}>
                  Org-wide rules evaluated in priority order. Set at least one match field per rule.
                  Click <strong>Save rules</strong> to keep changes. Campaign rules automatically
                  move matching historical leads into the target pipeline and route future leads here.
                </p>
              </div>
              <div className="row" style={{ gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setRulesDirty(true)
                    setRuleDrafts((rows) => [...rows, emptyRule(pipelineId, rows.length)])
                  }}
                >
                  <Plus size={14} /> Add rule
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={saveRules.isPending}
                  onClick={() => saveRules.mutate()}
                >
                  {saveRules.isPending ? 'Saving…' : 'Save rules'}
                </button>
              </div>
            </div>

            {rulesQ.isLoading && <p className="muted small">Loading rules…</p>}

            <div className="stack" style={{ gap: '0.75rem' }}>
              {ruleDrafts.map((rule, idx) => (
                <div key={rule.id ?? `rule-${idx}`} className="card" style={{ padding: '0.75rem', background: 'var(--bg)' }}>
                  <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    <span className="badge badge-slate">Priority {idx + 1}</span>
                    <label className="row small muted" style={{ gap: '0.35rem' }}>
                      <input
                        type="checkbox"
                        checked={rule.is_active}
                        onChange={(e) => updateRule(idx, { is_active: e.target.checked })}
                      />
                      Active
                    </label>
                    <select
                      className="select"
                      value={rule.pipeline_id}
                      onChange={(e) => updateRule(idx, { pipeline_id: e.target.value })}
                    >
                      {(pipelinesQ.data?.items ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setRulesDirty(true)
                        setRuleDrafts((rows) => rows.filter((_, i) => i !== idx))
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <select
                      className="select"
                      value={rule.source ?? ''}
                      onChange={(e) => {
                        const next = e.target.value || null
                        updateRule(idx, {
                          source: next,
                          // Avoid orphan campaign matches when source changes.
                          campaign_id: null,
                          campaign_name: null,
                        })
                      }}
                    >
                      <option value="">Any source</option>
                      {SOURCE_OPTIONS.map((s) => (
                        <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>
                      ))}
                    </select>
                    <RuleCampaignFields
                      orgId={orgId!}
                      source={rule.source}
                      campaignId={rule.campaign_id}
                      campaignName={rule.campaign_name}
                      onChange={(patch) => updateRule(idx, patch)}
                    />
                    <input
                      className="input"
                      placeholder="Region"
                      value={rule.region ?? ''}
                      onChange={(e) => updateRule(idx, { region: e.target.value || null })}
                    />
                    <input
                      className="input"
                      placeholder="Product interest"
                      value={rule.product_interest ?? ''}
                      onChange={(e) => updateRule(idx, { product_interest: e.target.value || null })}
                    />
                    <input
                      className="input"
                      placeholder="Sector"
                      value={rule.sector ?? ''}
                      onChange={(e) => updateRule(idx, { sector: e.target.value || null })}
                    />
                  </div>
                  <RuleMatchActions
                    orgId={orgId}
                    rule={rule}
                    pipelineName={
                      (pipelinesQ.data?.items ?? []).find((p) => p.id === rule.pipeline_id)?.name
                      ?? pipeline.name
                    }
                    onApplied={() => {
                      if (orgId && pipelineId) invalidateWorkspace(qc, orgId, pipelineId)
                      void qc.invalidateQueries({ queryKey: ['routing-rule-preview', orgId] })
                      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
                    }}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="card stack" style={{ gap: '0.75rem', padding: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Pipeline status</h3>
            {pipeline.is_active ? (
              <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pipeline.is_default || archivePipeline.isPending}
                  onClick={() => archivePipeline.mutate()}
                >
                  <Archive size={15} /> Archive pipeline
                </button>
                {pipeline.is_default && (
                  <p className="muted small">Set another pipeline as default before archiving.</p>
                )}
              </div>
            ) : (
              <p className="muted small">This pipeline is archived. Reactivate it from the pipelines list.</p>
            )}

            {!pipeline.is_default && (
              <div style={{ marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                <p className="muted small" style={{ marginBottom: '0.5rem' }}>
                  Permanently delete this pipeline. Leads must be moved to another pipeline first.
                </p>
                <button type="button" className="btn btn-ghost btn-sm error" onClick={() => setShowDeleteModal(true)}>
                  <Trash2 size={14} /> Delete pipeline
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete pipeline"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={
                deletePipeline.isPending
                || ((overview?.kpis.total_leads ?? 0) > 0 && !moveLeadsTo)
              }
              onClick={() => deletePipeline.mutate()}
            >
              {deletePipeline.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="muted small">
          {overview?.kpis.total_leads
            ? `This pipeline has ${overview.kpis.total_leads} lead(s). Choose where to move them.`
            : 'This will permanently delete the pipeline.'}
        </p>
        {(overview?.kpis.total_leads ?? 0) > 0 && (
          <select
            className="select"
            value={moveLeadsTo}
            onChange={(e) => setMoveLeadsTo(e.target.value)}
            style={{ marginTop: '0.75rem', width: '100%' }}
          >
            <option value="">Select target pipeline…</option>
            {otherPipelines.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </Modal>
    </div>
  )
}
