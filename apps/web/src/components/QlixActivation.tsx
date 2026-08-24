import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquare,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { apiFetch, apiUpload } from '../lib/api'
import type { QlixDocument, QlixState } from '../lib/entitlements'

const ACCEPTED =
  '.pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusBadge(status: string): { cls: string; label: string } {
  if (status === 'ready') return { cls: 'badge-green', label: 'Ready' }
  if (status === 'failed') return { cls: 'badge-red', label: 'Failed' }
  if (status === 'uploading') return { cls: 'badge-blue', label: 'Uploading' }
  return { cls: 'badge-amber', label: 'Processing' }
}

/** Manage the documents an org has added to its Brain. */
export function QlixDocuments({ orgId, compact }: { orgId: string; compact?: boolean }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const docsQ = useQuery({
    queryKey: ['qlix-documents', orgId],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ items: QlixDocument[] }>(`/v1/orgs/${orgId}/qlix/documents`),
    // Indexing happens on Qlix's side, so poll while anything is still pending.
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? []
      return items.some((d) => d.status === 'pending' || d.status === 'uploading')
        ? 4000
        : false
    },
  })

  const upload = useMutation({
    mutationFn: (file: File) =>
      apiUpload<QlixDocument>(`/v1/orgs/${orgId}/qlix/documents`, file),
    onMutate: () => setError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['qlix-documents', orgId] })
    },
    onError: (err: Error) => setError(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/v1/orgs/${orgId}/qlix/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['qlix-documents', orgId] })
    },
    onError: (err: Error) => setError(err.message),
  })

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return
      // Upload one at a time so a rejected file reports its own error rather
      // than failing the whole batch silently.
      Array.from(files).forEach((file) => upload.mutate(file))
    },
    [upload],
  )

  const documents = docsQ.data?.items ?? []

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
        }}
        style={{
          border: `1.5px dashed ${dragging ? 'var(--primary)' : 'var(--border)'}`,
          background: dragging ? '#f0fdfa' : '#f8fafc',
          borderRadius: 12,
          padding: compact ? '20px 16px' : '28px 20px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all .15s ease',
        }}
      >
        <Upload size={compact ? 20 : 24} style={{ color: 'var(--primary)', marginBottom: 8 }} />
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          {upload.isPending ? 'Uploading…' : 'Drop files here, or click to browse'}
        </div>
        <div className="muted small" style={{ marginTop: 4 }}>
          PDF, Word, Excel, CSV, Markdown or text · up to 25MB
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPTED}
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {error && (
        <div
          className="small"
          style={{ color: '#b91c1c', marginTop: 10, display: 'flex', gap: 6 }}
        >
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {documents.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0' }}>
          {documents.map((doc) => {
            const badge = statusBadge(doc.status)
            return (
              <li
                key={doc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <FileText size={16} style={{ color: '#64748b', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {doc.title || doc.file_name}
                  </div>
                  <div className="muted small">
                    {formatBytes(doc.size_bytes)}
                    {doc.last_error ? ` · ${doc.last_error}` : ''}
                  </div>
                </div>
                <span className={`badge ${badge.cls}`}>{badge.label}</span>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  title="Remove from the knowledge base"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(doc.id)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Sync state line — reassures people their CRM data is already flowing in. */
export function QlixSyncNote({ qlix }: { qlix?: QlixState }) {
  if (!qlix?.connected) return null
  const pending = qlix.sync?.pending ?? 0
  const backfillDone = qlix.sync?.backfill_done ?? qlix.backfill_done

  if (!backfillDone) {
    return (
      <div className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Loader2 size={13} className="spin" />
        {pending > 0
          ? `CRM data is still syncing with the agent — ${pending} record${pending === 1 ? '' : 's'} left. Chat unlocks when this finishes.`
          : 'CRM data is still syncing with the agent. Chat unlocks when this finishes.'}
      </div>
    )
  }
  if (pending > 0) {
    return (
      <div className="muted small">
        Syncing {pending} recent change{pending === 1 ? '' : 's'}.
      </div>
    )
  }
  return (
    <div className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <CheckCircle2 size={13} style={{ color: '#047857' }} />
      Your leads, quotes and production data sync automatically.
    </div>
  )
}

type Props = {
  orgId: string
  qlix?: QlixState
  onStartChatting: () => void
}

/**
 * Activation, then the choice of what to do next.
 *
 * Activation asks the user for nothing — Loomrun gets the key, provisions the
 * agent and starts importing behind the button.
 */
export function QlixActivation({ orgId, qlix, onStartChatting }: Props) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const connected = !!qlix?.connected

  const activate = useMutation({
    mutationFn: () =>
      apiFetch<QlixState>(`/v1/orgs/${orgId}/qlix/activate`, { method: 'POST' }),
    onMutate: () => setError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-status', orgId] })
      void queryClient.invalidateQueries({ queryKey: ['qlix-status', orgId] })
    },
    onError: (err: Error) => setError(err.message),
  })

  if (!connected) {
    const unavailable = qlix?.configured === false
    return (
      <div className="card" style={{ maxWidth: 560, margin: '48px auto', textAlign: 'center' }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: '#ccfbf1',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 16px',
          }}
        >
          <Bot size={24} style={{ color: 'var(--primary)' }} />
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Activate your AI agent</h2>
        <p className="muted" style={{ margin: '0 auto 20px', maxWidth: 420 }}>
          Give your organisation its own assistant. It learns your leads, quotes and
          production data automatically, and can act on them with your approval.
        </p>

        {qlix?.status === 'error' && qlix.last_error && (
          <div
            className="small"
            style={{
              color: '#b91c1c',
              background: '#fef2f2',
              borderRadius: 8,
              padding: '8px 12px',
              marginBottom: 14,
              textAlign: 'left',
            }}
          >
            Last attempt failed: {qlix.last_error}
          </div>
        )}
        {error && (
          <div
            className="small"
            style={{
              color: '#b91c1c',
              background: '#fef2f2',
              borderRadius: 8,
              padding: '8px 12px',
              marginBottom: 14,
              textAlign: 'left',
            }}
          >
            {error}
          </div>
        )}

        <button
          type="button"
          className="btn"
          disabled={activate.isPending || unavailable}
          onClick={() => activate.mutate()}
        >
          {activate.isPending ? (
            <>
              <Loader2 size={16} className="spin" /> Setting things up…
            </>
          ) : (
            <>
              <Sparkles size={16} /> Activate agent
            </>
          )}
        </button>

        <p className="muted small" style={{ marginTop: 14 }}>
          {unavailable
            ? 'AI agents are not enabled on this server yet. Contact support.'
            : 'Takes a few seconds. Nothing to configure.'}
        </p>
      </div>
    )
  }

  const pending = qlix?.sync?.pending ?? 0
  const queued = qlix?.backfill?.queued ?? 0
  const backfillDone = !!(qlix?.sync?.backfill_done ?? qlix?.backfill_done)
  const imported = queued > 0 ? Math.max(0, queued - pending) : 0
  const etaMinutes = pending > 0 ? Math.max(1, Math.ceil(pending / 80)) : 1
  const pct = queued > 0 ? Math.min(100, Math.round((imported / queued) * 100)) : 0

  return (
    <div style={{ maxWidth: 860, margin: '40px auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        {backfillDone ? (
          <CheckCircle2 size={28} style={{ color: '#047857', marginBottom: 8 }} />
        ) : (
          <Loader2 size={28} className="spin" style={{ color: 'var(--primary)', marginBottom: 8 }} />
        )}
        <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>
          {backfillDone ? 'Your agent is ready' : 'Syncing CRM data with your agent'}
        </h2>
        {backfillDone ? (
          <QlixSyncNote qlix={qlix} />
        ) : (
          <p className="muted" style={{ margin: '0 auto', maxWidth: 460 }}>
            Your leads, quotes and production records are being indexed. Chat stays locked
            until this finishes so the agent does not answer from an incomplete CRM.
            {pending > 0
              ? ` About ${etaMinutes} minute${etaMinutes === 1 ? '' : 's'} left.`
              : ''}
          </p>
        )}
      </div>

      {!backfillDone && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <strong className="small">CRM import</strong>
            <span className="muted small">
              {queued > 0 ? `${imported} / ${queued} records` : `${pending} remaining`}
            </span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: '#e2e8f0',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${queued > 0 ? pct : pending > 0 ? 8 : 40}%`,
                background: 'var(--primary)',
                transition: 'width .4s ease',
              }}
            />
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <FileText size={18} style={{ color: 'var(--primary)' }} />
            <strong>Add your documents</strong>
            <span className="badge badge-slate">Optional</span>
          </div>
          <p className="muted small" style={{ marginTop: 0, marginBottom: 14 }}>
            Price lists, policies, spec sheets or contracts. Your CRM data is already
            syncing — this is for everything that lives outside Loomrun.
          </p>
          <QlixDocuments orgId={orgId} compact />
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <MessageSquare size={18} style={{ color: 'var(--primary)' }} />
            <strong>Start chatting</strong>
          </div>
          {backfillDone ? (
            <>
              <p className="muted small" style={{ marginTop: 0 }}>
                Ask about your pipeline, draft a quotation, or move a lead along. Anything that
                changes your data will ask you to confirm first.
              </p>
              <ul className="muted small" style={{ paddingLeft: 18, margin: '4px 0 18px' }}>
                <li>“How many leads are in the quotation stage?”</li>
                <li>“Draft a quote for the Acme enquiry.”</li>
                <li>“Which production orders are running late?”</li>
              </ul>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 'auto', alignSelf: 'flex-start' }}
                onClick={onStartChatting}
              >
                <MessageSquare size={16} /> Open chat
              </button>
            </>
          ) : (
            <>
              <p className="muted small" style={{ marginTop: 0 }}>
                Chat is paused until your CRM has finished syncing. You can still add documents
                on the left.
              </p>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 'auto', alignSelf: 'flex-start' }}
                disabled
              >
                <Loader2 size={16} className="spin" /> Waiting for CRM sync…
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
