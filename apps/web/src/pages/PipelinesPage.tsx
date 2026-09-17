import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, GitBranch, Plus, Star } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState } from '../components/ui/EmptyState'
import { FilterToolbar } from '../components/ui/FilterToolbar'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { routes } from '../lib/appRoutes'
import { timeAgo } from '../lib/format'

export type PipelineStage = {
  id: string
  pipeline_id: string
  name: string
  slug: string
  sort_order: number
  kind: string
  probability: number | null
  system_key: string | null
}

export type Pipeline = {
  id: string
  organization_id: string
  name: string
  type: string
  is_default: boolean
  is_active: boolean
  sort_order: number
  created_at: string | null
  updated_at: string | null
  stages?: PipelineStage[]
}

const PIPELINE_TYPES = [
  'GENERAL',
  'CAMPAIGN',
  'REGION',
  'PRODUCT',
  'SECTOR',
  'TEAM',
  'CUSTOM',
] as const

const TYPE_LABELS: Record<string, string> = {
  GENERAL: 'General',
  CAMPAIGN: 'Campaign',
  REGION: 'Region',
  PRODUCT: 'Product',
  SECTOR: 'Sector',
  TEAM: 'Team',
  CUSTOM: 'Custom',
}

function invalidatePipelines(qc: ReturnType<typeof useQueryClient>, orgId: string) {
  void qc.invalidateQueries({ queryKey: ['pipelines', orgId] })
}

export function PipelinesPage() {
  const { orgId } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<string>('GENERAL')
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')

  const q = useQuery({
    queryKey: ['pipelines', orgId, showArchived],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ items: Pipeline[] }>(
        `/v1/orgs/${orgId}/pipelines?include_archived=${showArchived ? 'true' : 'false'}`,
      ),
  })

  const createPipeline = useMutation({
    mutationFn: () =>
      apiFetch<Pipeline>(`/v1/orgs/${orgId}/pipelines`, {
        method: 'POST',
        json: { name: name.trim(), type, copy_default_stages: true },
      }),
    onSuccess: (pipeline) => {
      toast.success(`Pipeline "${pipeline.name}" created`)
      setName('')
      setType('GENERAL')
      setShowCreate(false)
      invalidatePipelines(qc, orgId!)
      navigate(routes.pipeline(pipeline.id))
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create pipeline'),
  })

  const updatePipeline = useMutation({
    mutationFn: (args: { id: string; json: Record<string, unknown> }) =>
      apiFetch<Pipeline>(`/v1/orgs/${orgId}/pipelines/${args.id}`, {
        method: 'PATCH',
        json: args.json,
      }),
    onSuccess: () => {
      invalidatePipelines(qc, orgId!)
      toast.success('Pipeline updated')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update pipeline'),
  })

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Pipeline name is required')
      return
    }
    createPipeline.mutate()
  }

  if (!orgId) {
    return <PageHeader title="Pipelines" description="Select an organization." />
  }

  const items = q.data?.items ?? []
  const qtext = search.trim().toLowerCase()
  const visible = items.filter(
    (p) =>
      !qtext ||
      p.name.toLowerCase().includes(qtext) ||
      p.type.toLowerCase().includes(qtext),
  )
  const activeCount = items.filter((p) => p.is_active).length
  const archivedCount = items.filter((p) => !p.is_active).length

  return (
    <div className="page">
      <PageHeader
        title="Pipelines"
        badge={`${activeCount} active`}
        description="Organize leads into separate workspaces with custom stages and routing rules."
        actions={
          <button type="button" className="btn" onClick={() => setShowCreate((v) => !v)}>
            <Plus size={15} /> New pipeline
          </button>
        }
        toolbar={
          <FilterToolbar collapsible={false}>
            <input
              className="input"
              placeholder="Search pipelines…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <label className="row small muted" style={{ gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived ({archivedCount})
            </label>
          </FilterToolbar>
        }
      />

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {showCreate && (
          <form className="card stack" style={{ gap: '0.75rem', padding: '1rem' }} onSubmit={handleCreate}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Create pipeline</h3>
            <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
              <input
                className="input"
                placeholder="Pipeline name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ flex: '1 1 200px' }}
                autoFocus
              />
              <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
                {PIPELINE_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
                ))}
              </select>
              <button type="submit" className="btn" disabled={createPipeline.isPending}>
                {createPipeline.isPending ? 'Creating…' : 'Create'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {q.isLoading && <p className="muted">Loading pipelines…</p>}

        {visible.length > 0 ? (
          <div className="table-wrap card">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Stages</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th style={{ width: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr
                    key={p.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(routes.pipeline(p.id))}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      {p.is_default && (
                        <span className="badge badge-amber" style={{ marginTop: '0.25rem' }}>
                          Default
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-purple">{TYPE_LABELS[p.type] ?? p.type}</span>
                    </td>
                    <td className="muted">{p.stages?.length ?? 0}</td>
                    <td>
                      {p.is_active ? (
                        <span className="badge badge-green">Active</span>
                      ) : (
                        <span className="badge badge-slate">Archived</span>
                      )}
                    </td>
                    <td className="muted small">{timeAgo(p.updated_at)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ gap: '0.35rem' }}>
                        {p.is_active && !p.is_default && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Set as default"
                            onClick={() => updatePipeline.mutate({ id: p.id, json: { is_default: true } })}
                          >
                            <Star size={14} />
                          </button>
                        )}
                        {p.is_active ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Archive"
                            disabled={p.is_default}
                            onClick={() => updatePipeline.mutate({ id: p.id, json: { is_active: false } })}
                          >
                            <Archive size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Reactivate"
                            onClick={() => updatePipeline.mutate({ id: p.id, json: { is_active: true } })}
                          >
                            <ArchiveRestore size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !q.isLoading && (
            <EmptyState
              icon={GitBranch}
              title="No pipelines yet"
              description="Create a pipeline workspace to organize leads with custom stages."
              action={
                <button type="button" className="btn" onClick={() => setShowCreate(true)}>
                  <Plus size={15} /> New pipeline
                </button>
              }
            />
          )
        )}
      </div>
    </div>
  )
}
