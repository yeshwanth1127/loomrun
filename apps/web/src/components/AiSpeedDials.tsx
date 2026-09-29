import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings2, Trash2, Zap } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { Modal } from './ui/Modal'

type AiSpeedDial = {
  id: string
  slot: number
  label: string
  prompt: string
  is_enabled: boolean
}

type SpeedDialDraft = {
  slot: number
  label: string
  prompt: string
  is_enabled: boolean
}

type AiSpeedDialsProps = {
  orgId: string
  disabled?: boolean
  onSend: (prompt: string) => void
}

const EMPTY_DRAFTS: SpeedDialDraft[] = Array.from({ length: 9 }, (_, index) => ({
  slot: index + 1,
  label: '',
  prompt: '',
  is_enabled: true,
}))

export function AiSpeedDials({ orgId, disabled = false, onSend }: AiSpeedDialsProps) {
  const queryClient = useQueryClient()
  const [managerOpen, setManagerOpen] = useState(false)
  const [drafts, setDrafts] = useState<SpeedDialDraft[]>(EMPTY_DRAFTS)

  const speedDialsQ = useQuery({
    queryKey: ['ai-speed-dials', orgId],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ items: AiSpeedDial[] }>(`/v1/orgs/${orgId}/ai/speed-dials`),
  })

  const items = useMemo(
    () => (speedDialsQ.data?.items ?? []).slice().sort((a, b) => a.slot - b.slot),
    [speedDialsQ.data?.items],
  )
  const enabledItems = items.filter((item) => item.is_enabled)

  useEffect(() => {
    if (!managerOpen) return
    const bySlot = new Map(items.map((item) => [item.slot, item]))
    setDrafts(
      EMPTY_DRAFTS.map((empty) => {
        const item = bySlot.get(empty.slot)
        return item
          ? {
              slot: item.slot,
              label: item.label,
              prompt: item.prompt,
              is_enabled: item.is_enabled,
            }
          : { ...empty }
      }),
    )
  }, [managerOpen, items])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || disabled || managerOpen) return
      const slot = Number(event.key)
      if (!Number.isInteger(slot) || slot < 1 || slot > 9) return
      const item = enabledItems.find((entry) => entry.slot === slot)
      if (!item) return
      event.preventDefault()
      onSend(item.prompt)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [disabled, enabledItems, managerOpen, onSend])

  const saveMutation = useMutation({
    mutationFn: async (nextDrafts: SpeedDialDraft[]) => {
      const existingSlots = new Set(items.map((item) => item.slot))
      const operations: Promise<unknown>[] = []
      for (const draft of nextDrafts) {
        const label = draft.label.trim()
        const prompt = draft.prompt.trim()
        if ((label && !prompt) || (!label && prompt)) {
          throw new Error(`Shortcut ${draft.slot} needs both a name and a question.`)
        }
        if (label && prompt) {
          operations.push(
            apiFetch(`/v1/orgs/${orgId}/ai/speed-dials/${draft.slot}`, {
              method: 'PUT',
              json: { label, prompt, is_enabled: draft.is_enabled },
            }),
          )
        } else if (existingSlots.has(draft.slot)) {
          operations.push(
            apiFetch(`/v1/orgs/${orgId}/ai/speed-dials/${draft.slot}`, {
              method: 'DELETE',
            }),
          )
        }
      }
      await Promise.all(operations)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ai-speed-dials', orgId] })
      setManagerOpen(false)
    },
  })

  function updateDraft(slot: number, patch: Partial<SpeedDialDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.slot === slot ? { ...draft, ...patch } : draft)),
    )
  }

  function onSave(event: FormEvent) {
    event.preventDefault()
    saveMutation.mutate(drafts)
  }

  return (
    <>
      <section className="ai-speed-dials" aria-label="Quick questions">
        <div className="ai-speed-dials__header">
          <div className="row" style={{ gap: '0.4rem' }}>
            <Zap size={14} />
            <strong>Quick Questions</strong>
            <span className="muted small">Alt + number</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setManagerOpen(true)}
            disabled={speedDialsQ.isLoading}
          >
            <Settings2 size={14} />
            Manage
          </button>
        </div>
        <div className="ai-speed-dials__items">
          {enabledItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="ai-speed-dial"
              title={`${item.prompt} (Alt+${item.slot})`}
              disabled={disabled}
              onClick={() => onSend(item.prompt)}
            >
              <span className="ai-speed-dial__number">{item.slot}</span>
              <span>{item.label}</span>
            </button>
          ))}
          {!speedDialsQ.isLoading && enabledItems.length === 0 && (
            <button
              type="button"
              className="ai-speed-dial ai-speed-dial--empty"
              onClick={() => setManagerOpen(true)}
            >
              Add your first quick question
            </button>
          )}
        </div>
        {speedDialsQ.error && (
          <p className="error small">{(speedDialsQ.error as Error).message}</p>
        )}
      </section>

      <Modal
        open={managerOpen}
        onClose={() => {
          if (!saveMutation.isPending) setManagerOpen(false)
        }}
        title="Manage Quick Questions"
        size="xl"
        closeOnBackdrop={!saveMutation.isPending}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saveMutation.isPending}
              onClick={() => setManagerOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="ai-speed-dial-form"
              className="btn"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save shortcuts'}
            </button>
          </>
        }
      >
        <form id="ai-speed-dial-form" className="ai-speed-dial-editor" onSubmit={onSave}>
          <p className="muted small">
            Add up to nine personal questions. Clicking a shortcut sends the full question to
            Noolrun AI in the current chat.
          </p>
          {drafts.map((draft) => (
            <div key={draft.slot} className="ai-speed-dial-editor__row">
              <span className="ai-speed-dial__number">{draft.slot}</span>
              <div className="form-field">
                <label className="input-label" htmlFor={`speed-dial-label-${draft.slot}`}>
                  Name
                </label>
                <input
                  id={`speed-dial-label-${draft.slot}`}
                  className="input"
                  maxLength={60}
                  placeholder="e.g. Sales summary"
                  value={draft.label}
                  onChange={(event) => updateDraft(draft.slot, { label: event.target.value })}
                />
              </div>
              <div className="form-field ai-speed-dial-editor__prompt">
                <label className="input-label" htmlFor={`speed-dial-prompt-${draft.slot}`}>
                  Question sent to AI
                </label>
                <textarea
                  id={`speed-dial-prompt-${draft.slot}`}
                  className="input"
                  rows={2}
                  maxLength={4000}
                  placeholder="What should Noolrun AI answer?"
                  value={draft.prompt}
                  onChange={(event) => updateDraft(draft.slot, { prompt: event.target.value })}
                />
              </div>
              <label className="ai-speed-dial-editor__enabled">
                <input
                  type="checkbox"
                  checked={draft.is_enabled}
                  disabled={!draft.label.trim() && !draft.prompt.trim()}
                  onChange={(event) =>
                    updateDraft(draft.slot, { is_enabled: event.target.checked })
                  }
                />
                Show
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Clear shortcut ${draft.slot}`}
                disabled={!draft.label && !draft.prompt}
                onClick={() =>
                  updateDraft(draft.slot, { label: '', prompt: '', is_enabled: true })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {saveMutation.error && (
            <p className="error">{(saveMutation.error as Error).message}</p>
          )}
        </form>
      </Modal>
    </>
  )
}
