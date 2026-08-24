import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  Check,
  FileText,
  MessageSquarePlus,
  Mic,
  PanelLeft,
  MicOff,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAgentActivity } from '../context/AgentActivityContext'
import { AgentActivityTrace } from '../components/AgentActivityTrace'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { apiFetch, apiStream } from '../lib/api'
import { aiModeLabel, qlixCrmSyncing, type AiStatus } from '../lib/entitlements'
import { QlixActivation, QlixDocuments, QlixSyncNote } from '../components/QlixActivation'

const CONV_STORAGE_KEY = 'loomrun.ai.conversation'
const ACTIVATION_SEEN_KEY = 'loomrun.ai.activationSeen'
const HISTORY_STORAGE_KEY = 'loomrun.ai.history'
const VOICE_STORAGE_KEY = 'loomrun.ai.voice'

type Citation = {
  title?: string
  source?: string
  documentId?: string
  [key: string]: unknown
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  pendingActions?: PendingAction[]
  resolvedActionIds?: string[]
  autoApproved?: AutoApproved[]
  citations?: Citation[]
  id?: string
}

type PendingAction = {
  id: string
  tool: string
  summary: string
  args_preview?: Record<string, unknown>
  expires_at?: string
  jit_request_id?: string | null
}

// An action the agent took without asking, because a standing approval covered
// it. Shown after the fact so a granted permission is never silent.
type AutoApproved = {
  tool: string
  summary: string
  grant_id?: string
  expires_at?: string | null
}

type ToolGrant = {
  id: string
  tool: string
  label: string
  expires_at?: string | null
  expires_in_seconds: number
  use_count: number
  last_used_at?: string | null
}

type ConversationSummary = {
  id: string
  title: string
  created_at?: string | null
  updated_at?: string | null
}

type ConversationDetail = ConversationSummary & {
  messages: {
    id: string
    role: string
    content: string
    metadata?: { pending_actions?: PendingAction[] } | null
    created_at?: string | null
  }[]
}

type ChatResponse = {
  reply: string
  mode: string
  plan: string
  multilingual: boolean
  model?: string
  conversation_id?: string
  pending_actions?: PendingAction[]
  auto_approved?: AutoApproved[]
  citations?: Citation[]
}

// One event off the chat stream. `delta` carries text as it is written;
// `pending_action` means the agent is waiting on the user before it writes.
type StreamEvent = {
  type:
    | 'start'
    | 'run'
    | 'delta'
    | 'pending_action'
    | 'auto_approved'
    | 'tool'
    | 'log'
    | 'status'
    | 'reset'
    | 'done'
    | 'error'
  text?: string
  action?: PendingAction & AutoApproved
  run_id?: string
  conversation_id?: string
  detail?: string
  tool?: { name: string; phase: 'running' | 'done' | 'error'; args?: Record<string, string | number | boolean> }
} & Partial<ChatResponse>

type ActionResult = {
  reply: string
  tool: string
  result?: unknown
  action_id: string
  status: string
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, id: string) {
  try {
    localStorage.setItem(key, id)
  } catch {
    /* ignore */
  }
}

function formatConvTime(iso?: string | null) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/**
 * Approvals expire on Qlix's side in about two minutes, after which the agent
 * treats silence as a denial. Showing the remaining time is the difference
 * between "take your time" and a Confirm button that quietly stops working.
 */
function ApprovalCountdown({ expiresAt }: { expiresAt?: string }) {
  const target = expiresAt ? new Date(expiresAt).getTime() : Number.NaN
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (Number.isNaN(target)) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [target])

  if (Number.isNaN(target)) return null
  const remaining = Math.max(0, Math.round((target - now) / 1000))
  if (remaining <= 0) {
    return (
      <span className="small" style={{ color: '#b91c1c' }}>
        Expired — ask again to retry
      </span>
    )
  }
  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  return (
    <span className="small" style={{ color: remaining <= 30 ? '#b45309' : '#64748b' }}>
      {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`} to decide
    </span>
  )
}

/**
 * Something the agent did without asking, because a standing approval covered
 * it. A granted permission should never be silent, so every use is shown after
 * the fact with a one-click way to take the permission back.
 */
function AutoApprovedNotice({
  items,
  onRevoke,
  revoking,
}: {
  items: AutoApproved[]
  onRevoke: (grantId: string) => void
  revoking: boolean
}) {
  if (!items.length) return null
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((a, i) => (
        <div
          key={`${a.tool}-${i}`}
          className="small"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0.5rem 0.7rem',
            borderRadius: 8,
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
          }}
        >
          <Check size={14} style={{ color: '#047857', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            {a.summary}
            <span className="muted"> · done automatically</span>
          </span>
          {a.grant_id && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={revoking}
              title="Stop allowing this without asking"
              onClick={() => onRevoke(a.grant_id as string)}
            >
              Undo access
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** What the agent may currently do without asking, and for how much longer. */
function StandingApprovals({
  grants,
  onRevoke,
  onRevokeAll,
  busy,
}: {
  grants: ToolGrant[]
  onRevoke: (id: string) => void
  onRevokeAll: () => void
  busy: boolean
}) {
  if (!grants.length) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        Every action that changes data will ask you first.
      </p>
    )
  }
  return (
    <div>
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        Approved once, so these run without asking again until they expire.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {grants.map((g) => {
          const hours = Math.floor(g.expires_in_seconds / 3600)
          const mins = Math.round((g.expires_in_seconds % 3600) / 60)
          return (
            <li
              key={g.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{g.label}</div>
                <div className="muted" style={{ fontSize: '0.72rem' }}>
                  {hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`}
                  {g.use_count > 0 ? ` · used ${g.use_count}x` : ''}
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                title="Ask me again next time"
                onClick={() => onRevoke(g.id)}
              >
                <X size={13} />
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className="btn-ghost btn-sm"
        style={{ marginTop: 8 }}
        disabled={busy}
        onClick={onRevokeAll}
      >
        Ask me for everything again
      </button>
    </div>
  )
}

/** Where an answer came from, so the user can go and check it. */
function Citations({ items }: { items: Citation[] }) {
  if (!items.length) return null
  return (
    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.slice(0, 6).map((c, i) => {
        const label =
          (typeof c.title === 'string' && c.title) ||
          (typeof c.source === 'string' && c.source) ||
          `Source ${i + 1}`
        return (
          <span
            key={`${label}-${i}`}
            className="badge badge-slate"
            title={label}
            style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

export function AiChatPage() {
  const { orgId } = useAuth()
  const { dayParam, isAll } = useDateFilter()
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busyActionId, setBusyActionId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(() => readStored(CONV_STORAGE_KEY))
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceEnabled, setVoiceEnabled] = useState(() => readStored(VOICE_STORAGE_KEY) === '1')
  const [convSearch, setConvSearch] = useState('')
  const [historyOpen, setHistoryOpen] = useState(() => readStored(HISTORY_STORAGE_KEY) !== '0')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const agentActivity = useAgentActivity()
  // Claim the trace for the thread while this page is mounted, so the app-wide
  // dock stays out of the way. `registerInlineHost` is stable; depending on the
  // whole context object would re-run this on every activity update.
  const { registerInlineHost } = agentActivity
  useEffect(() => registerInlineHost(), [registerInlineHost])
  const [showKnowledge, setShowKnowledge] = useState(false)
  const [activationDismissed, setActivationDismissed] = useState(
    () => readStored(ACTIVATION_SEEN_KEY) === '1',
  )
  const [streamingReply, setStreamingReply] = useState<{
    full: string
    shown: string
    pendingActions?: PendingAction[]
    autoApproved?: AutoApproved[]
    citations?: Citation[]
  } | null>(null)
  const streamingActiveRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const inputBeforeVoiceRef = useRef('')
  const voiceEnabledRef = useRef(voiceEnabled)
  const messagesRef = useRef<ChatMessage[]>([])
  const chatPendingRef = useRef(false)
  const conversationIdRef = useRef<string | null>(conversationId)
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const mutateChatRef = useRef<(payload: {
    message: string
    history: ChatMessage[]
    model: string
    conversation_id: string | null
  }) => void>(() => {})

  useEffect(() => {
    if (activationDismissed) writeStored(ACTIVATION_SEEN_KEY, '1')
  }, [activationDismissed])

  useEffect(() => {
    activeRunIdRef.current = activeRunId
  }, [activeRunId])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])
  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled
  }, [voiceEnabled])

  const statusQ = useQuery({
    queryKey: ['ai-status', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<AiStatus>(`/v1/orgs/${orgId}/ai/status`),
    refetchInterval: (query) => (qlixCrmSyncing(query.state.data?.qlix) ? 4000 : false),
  })

  const conversationsQ = useQuery({
    queryKey: ['ai-conversations', orgId, dayParam, convSearch],
    enabled: !!orgId,
    queryFn: () => {
      const qs = new URLSearchParams()
      qs.set('day', dayParam)
      if (convSearch.trim()) qs.set('search', convSearch.trim())
      return apiFetch<{ items: ConversationSummary[] }>(
        `/v1/orgs/${orgId}/ai/conversations?${qs.toString()}`,
      )
    },
  })

  const conversationQ = useQuery({
    queryKey: ['ai-conversation', orgId, conversationId],
    enabled: !!orgId && !!conversationId,
    queryFn: () =>
      apiFetch<ConversationDetail>(`/v1/orgs/${orgId}/ai/conversations/${conversationId}`),
  })

  useEffect(() => {
    if (!conversationQ.data) return
    const loaded: ChatMessage[] = (conversationQ.data.messages || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        // Don't revive confirm cards from history — only live turns show them
      }))
    setMessages(loaded)
  }, [conversationQ.data])

  const qlix = statusQ.data?.qlix
  const qlixAvailable = qlix?.configured !== false
  const waitingForCrm = qlixCrmSyncing(qlix)
  const showActivation =
    qlixAvailable && (!qlix?.connected || waitingForCrm || !activationDismissed)

  // The model is not exposed in the UI: chat always runs on whatever the server
  // reports as the default, falling back to the first model it offers.
  const activeModel = statusQ.data?.models?.default || statusQ.data?.models?.items?.[0]?.id || ''
  const memoryFacts = statusQ.data?.memory?.facts || {}
  const memorySummary = statusQ.data?.memory?.summary || ''

  const voice = useSpeechSynthesis({ lang: 'en-IN' })

  const finalizeStreamingReply = useCallback(
    (
      reply: string,
      pendingActions?: PendingAction[],
      citations?: Citation[],
      autoApproved?: AutoApproved[],
    ) => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: reply,
          pendingActions: pendingActions?.length ? pendingActions : undefined,
          autoApproved: autoApproved?.length ? autoApproved : undefined,
          citations: citations?.length ? citations : undefined,
        },
      ])
      setStreamingReply(null)
      // Only refetch the canonical conversation now that our local message is in place —
      // invalidating earlier raced the reveal and duplicated the bubble (server copy + local copy).
      if (conversationIdRef.current) {
        void queryClient.invalidateQueries({
          queryKey: ['ai-conversation', orgId, conversationIdRef.current],
        })
      }
    },
    [orgId, queryClient],
  )

  const beginStreamingReply = useCallback(
    (
      reply: string,
      pendingActions?: PendingAction[],
      citations?: Citation[],
      autoApproved?: AutoApproved[],
    ) => {
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current)
        streamTimerRef.current = null
      }
      if (!reply) {
        finalizeStreamingReply(reply, pendingActions, citations, autoApproved)
        return
      }
      setStreamingReply({ full: reply, shown: '', pendingActions, citations, autoApproved })
      if (voiceEnabledRef.current) voice.speak(reply)
      const TICK_MS = 90
      const charsPerTick = Math.max(1, Math.round(reply.length / 220))
      streamTimerRef.current = setInterval(() => {
        setStreamingReply((cur) => {
          if (!cur) return cur
          const nextLen = Math.min(cur.full.length, cur.shown.length + charsPerTick)
          if (nextLen >= cur.full.length && streamTimerRef.current) {
            clearInterval(streamTimerRef.current)
            streamTimerRef.current = null
          }
          return { ...cur, shown: cur.full.slice(0, nextLen) }
        })
      }, TICK_MS)
    },
    [finalizeStreamingReply, voice],
  )

  useEffect(() => {
    return () => {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current)
    }
  }, [])

  // Live text arrives from the server, so it is shown as it lands rather than
  // revealed on a timer. The timer path still exists for the non-streaming
  // agent, which delivers its whole reply in one frame.
  const pushDelta = useCallback((chunk: string) => {
    setStreamingReply((cur) => {
      const full = (cur?.full ?? '') + chunk
      return { full, shown: full, pendingActions: cur?.pendingActions }
    })
  }, [])

  const chat = useMutation({
    mutationFn: async (payload: {
      message: string
      history: ChatMessage[]
      model: string
      conversation_id: string | null
    }) => {
      const controller = new AbortController()
      streamAbortRef.current = controller
      agentActivity.begin()
      let streamed = ''
      let sawDelta = false
      const actions: PendingAction[] = []
      const auto: AutoApproved[] = []

      await apiStream(
        `/v1/orgs/${orgId}/ai/chat/stream`,
        {
          signal: controller.signal,
          json: {
            message: payload.message,
            model: payload.model,
            conversation_id: payload.conversation_id,
            history: payload.history.map(({ role, content }) => ({ role, content })),
          },
        },
        (raw) => {
          const event = raw as StreamEvent
          switch (event.type) {
            case 'start':
              if (event.conversation_id) {
                setConversationId(event.conversation_id)
                conversationIdRef.current = event.conversation_id
                writeStored(CONV_STORAGE_KEY, event.conversation_id)
              }
              break
            case 'run':
              setActiveRunId(event.run_id ?? null)
              agentActivity.setRunId(event.run_id ?? null)
              break
            case 'tool':
              if (event.tool?.name) agentActivity.noteTool(event.tool)
              break
            case 'delta':
              if (event.text) {
                sawDelta = true
                streamed += event.text
                pushDelta(event.text)
                agentActivity.setPhase('writing')
              }
              break
            case 'pending_action':
              if (event.action) {
                actions.push(event.action)
                setStreamingReply((cur) =>
                  cur
                    ? { ...cur, pendingActions: [...actions] }
                    : { full: '', shown: '', pendingActions: [...actions] },
                )
              }
              break
            case 'auto_approved':
              if (event.action) {
                auto.push(event.action)
                // The agent already acted; surface it immediately rather than
                // only at the end of the turn.
                setStreamingReply((cur) =>
                  cur
                    ? { ...cur, autoApproved: [...auto] }
                    : { full: '', shown: '', autoApproved: [...auto] },
                )
                void queryClient.invalidateQueries({ queryKey: ['ai-grants', orgId] })
              }
              break
            case 'reset':
              // The agent handed the turn back to the local model; drop the
              // partial so the user does not see two different answers, and
              // clear the steps so the dock narrates the new attempt only.
              streamed = ''
              sawDelta = false
              setStreamingReply(null)
              agentActivity.begin()
              break
            case 'error':
              throw new Error(event.detail || 'The assistant stopped unexpectedly.')
            case 'done': {
              const reply = event.reply ?? streamed
              const pending = event.pending_actions ?? actions
              const approved = event.auto_approved ?? auto
              if (sawDelta) {
                // The text is already on screen. Settle the final version and
                // let the user dismiss the overlay, same as the other path.
                setStreamingReply({
                  full: reply,
                  shown: reply,
                  pendingActions: pending,
                  autoApproved: approved,
                  citations: event.citations,
                })
                if (voiceEnabledRef.current) voice.speak(reply)
              } else {
                beginStreamingReply(reply, pending, event.citations, approved)
              }
              break
            }
            default:
              break
          }
        },
      )
    },
    onSettled: () => {
      streamAbortRef.current = null
      setActiveRunId(null)
      agentActivity.end()
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations', orgId] })
      void queryClient.invalidateQueries({ queryKey: ['ai-status', orgId] })
    },
    onError: (err: Error) => {
      setStreamingReply(null)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Sorry — ${err.message}` },
      ])
    },
  })

  chatPendingRef.current = chat.isPending
  mutateChatRef.current = chat.mutate
  streamingActiveRef.current = !!streamingReply

  // The reply streams straight into the thread, so it settles on its own once
  // the turn is over and every character is on screen. Previously this waited
  // on a click to dismiss the overlay that used to carry the text.
  useEffect(() => {
    if (!streamingReply || chat.isPending) return
    if (streamingReply.shown.length < streamingReply.full.length) return
    finalizeStreamingReply(
      streamingReply.full,
      streamingReply.pendingActions,
      streamingReply.citations,
      streamingReply.autoApproved,
    )
  }, [streamingReply, chat.isPending, finalizeStreamingReply])

  const grantsQ = useQuery({
    queryKey: ['ai-grants', orgId],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{ items: ToolGrant[]; ttl_hours: number }>(`/v1/orgs/${orgId}/ai/grants`),
  })

  const revokeGrant = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/v1/orgs/${orgId}/ai/grants/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-grants', orgId] })
    },
  })

  const revokeAllGrants = useMutation({
    mutationFn: () =>
      apiFetch<{ revoked: number }>(`/v1/orgs/${orgId}/ai/grants`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-grants', orgId] })
    },
  })

  const createConv = useMutation({
    mutationFn: () =>
      apiFetch<ConversationDetail>(`/v1/orgs/${orgId}/ai/conversations`, { method: 'POST', json: {} }),
    onSuccess: (data) => {
      setConversationId(data.id)
      writeStored(CONV_STORAGE_KEY, data.id)
      setMessages([])
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations', orgId] })
    },
  })

  const deleteConv = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/v1/orgs/${orgId}/ai/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      if (conversationId === id) {
        setConversationId(null)
        setMessages([])
        try {
          localStorage.removeItem(CONV_STORAGE_KEY)
        } catch {
          /* ignore */
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations', orgId] })
    },
  })

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !orgId || chatPendingRef.current || streamingActiveRef.current || !activeModel) return
      const history = messagesRef.current
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
      setInput('')
      mutateChatRef.current({
        message: trimmed,
        history,
        model: activeModel,
        conversation_id: conversationIdRef.current,
      })
    },
    [orgId, activeModel],
  )

  const stopRun = useCallback(
    (runId: string | null) => {
      // Ask Qlix to stop the agent first, then drop our stream. Aborting only
      // our side would leave the run burning tokens on theirs. The local
      // fallback agent has no remote run, so there is nothing to call — the
      // abort alone ends that turn.
      if (runId) {
        void apiFetch(`/v1/orgs/${orgId}/ai/runs/stop`, {
          method: 'POST',
          json: { run_id: runId },
        }).catch(() => {
          /* stopping is best-effort; the abort below still ends the turn here */
        })
      }
      streamAbortRef.current?.abort()
      streamAbortRef.current = null
      setActiveRunId(null)
      agentActivity.end()
    },
    [orgId, agentActivity],
  )

  // Hand the dock a way to stop whatever is running, and take it back when
  // this page unmounts so the dock never calls into a dead stream.
  const registerStop = agentActivity.registerStop
  useEffect(() => {
    registerStop(() => stopRun(activeRunIdRef.current))
    return () => registerStop(null)
  }, [registerStop, stopRun])

  const speech = useSpeechToText({
    lang: 'en-IN',
    onInterim: (live) => {
      const prefix = inputBeforeVoiceRef.current
      setInput(prefix ? `${prefix} ${live}`.trim() : live)
    },
    onFinal: (transcript) => {
      const prefix = inputBeforeVoiceRef.current
      const full = (prefix ? `${prefix} ${transcript}` : transcript).trim()
      inputBeforeVoiceRef.current = ''
      setInput(full)
      if (full) sendMessage(full)
    },
  })

  useEffect(() => {
    if (speech.error) setVoiceError(speech.error)
  }, [speech.error])

  const confirmMut = useMutation({
    mutationFn: (actionId: string) =>
      apiFetch<ActionResult>(`/v1/orgs/${orgId}/ai/actions/${actionId}/confirm`, { method: 'POST' }),
    onSuccess: (data) => {
      setMessages((prev) => {
        const next = prev.map((m) => {
          if (!m.pendingActions?.some((p) => p.id === data.action_id)) return m
          return { ...m, resolvedActionIds: [...(m.resolvedActionIds || []), data.action_id] }
        })
        return [...next, { role: 'assistant', content: data.reply }]
      })
      // Confirming also opens a 24-hour standing approval for that tool.
      void queryClient.invalidateQueries({ queryKey: ['ai-grants', orgId] })
      void queryClient.invalidateQueries({ queryKey: ['leads'] })
      void queryClient.invalidateQueries({ queryKey: ['quotations'] })
      setBusyActionId(null)
    },
    onError: () => setBusyActionId(null),
  })

  const cancelMut = useMutation({
    mutationFn: (actionId: string) =>
      apiFetch<{ id: string; status: string }>(`/v1/orgs/${orgId}/ai/actions/${actionId}/cancel`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.pendingActions?.some((p) => p.id === data.id)) return m
          return { ...m, resolvedActionIds: [...(m.resolvedActionIds || []), data.id] }
        }),
      )
      setBusyActionId(null)
    },
    onError: () => setBusyActionId(null),
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chat.isPending, busyActionId, speech.listening, streamingReply])

  const status = statusQ.data
  const available = status?.available ?? false
  const writesEnabled = status?.mode === 'advanced'
  const conversations = conversationsQ.data?.items || []

  function selectConversation(id: string) {
    setConversationId(id)
    writeStored(CONV_STORAGE_KEY, id)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (speech.listening) speech.stop()
    sendMessage(input)
  }

  function onToggleVoice() {
    if (!voiceEnabled) return
    if (!speech.supported) {
      setVoiceError('Speech recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }
    if (chat.isPending || streamingReply) return
    setVoiceError(null)
    speech.clearError()
    if (speech.listening) {
      speech.stop()
      return
    }
    inputBeforeVoiceRef.current = input.trim()
    speech.start()
  }

  function onToggleVoiceMode() {
    const next = !voiceEnabled
    setVoiceEnabled(next)
    writeStored(VOICE_STORAGE_KEY, next ? '1' : '0')
    if (!next) {
      if (speech.listening) speech.stop()
      voice.cancel()
      setVoiceError(null)
    }
  }

  const toggleHistory = () => {
    setHistoryOpen((prev) => {
      writeStored(HISTORY_STORAGE_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  return (
    <div className="ai-chat-page">
      <div className="page-header">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <h1>Loomrun AI</h1>
            <p>
              {writesEnabled
                ? 'Ask questions or give commands — chats and org memory persist'
                : 'Ask questions — chats and org memory persist'}
              {!isAll ? ` · History filtered to ${dayParam}` : ''}
            </p>
          </div>
          {status && (
            <span className={`badge ${available ? 'badge-indigo' : 'badge-slate'}`}>
              {aiModeLabel(status.mode)}
              {status.multilingual ? ' · Multilingual' : ''}
              {status.usage?.limit != null ? ` · ${status.usage.used}/${status.usage.limit} today` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="page-body">
        {statusQ.isLoading && <p className="muted ai-chat-notice">Checking AI access…</p>}
        {statusQ.error && <p className="error ai-chat-notice">{(statusQ.error as Error).message}</p>}

        {status?.upgrade_required && (
          <div className="card" style={{ maxWidth: 560, margin: '1.5rem 2rem 0' }}>
            <div className="row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <Sparkles size={18} />
              <strong>Upgrade to continue with Loomrun AI</strong>
            </div>
            <p className="muted small" style={{ marginBottom: '1rem' }}>
              Your free trial has ended. Growth includes basic AI Q&amp;A; Scale includes advanced multilingual AI that can act on leads and quotations.
            </p>
            <Link className="btn" to="/app/subscription">View subscription plans</Link>
          </div>
        )}

        {available && showActivation && orgId && (
          <div className="ai-chat-notice">
          <QlixActivation
            orgId={orgId}
            qlix={qlix}
            onStartChatting={() => setActivationDismissed(true)}
          />
          </div>
        )}

        {available && !showActivation && (
          <div className="ai-chat-shell">
            {/* Conversation history, collapsible out of the way */}
            <aside
              className={`ai-chat-history${historyOpen ? '' : ' is-collapsed'}`}
              inert={!historyOpen}
            >
              <div className="ai-chat-history-inner">
                <div
                  style={{
                    padding: '0.75rem',
                    borderBottom: '1px solid var(--border, #e2e8f0)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    className="btn"
                    style={{ width: '100%' }}
                    disabled={createConv.isPending}
                    onClick={() => createConv.mutate()}
                  >
                    <MessageSquarePlus size={15} />
                    New chat
                  </button>
                  <input
                    className="input"
                    placeholder="Search chats…"
                    value={convSearch}
                    onChange={(e) => setConvSearch(e.target.value)}
                    style={{ fontSize: '0.85rem' }}
                  />
                  <p className="muted small" style={{ margin: 0 }}>
                    {isAll ? 'All conversations' : `Updated on ${dayParam}`}
                  </p>
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: '0.35rem' }}>
                  {conversationsQ.isLoading && <p className="muted small" style={{ padding: 8 }}>Loading…</p>}
                  {!conversationsQ.isLoading && conversations.length === 0 && (
                    <p className="muted small" style={{ padding: 8 }}>No chats for this period.</p>
                  )}
                  {conversations.map((c) => {
                    const active = c.id === conversationId
                    return (
                      <div
                        key={c.id}
                        style={{
                          display: 'flex',
                          gap: 4,
                          alignItems: 'stretch',
                          marginBottom: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => selectConversation(c.id)}
                          style={{
                            flex: 1,
                            textAlign: 'left',
                            border: 'none',
                            borderRadius: 8,
                            padding: '0.55rem 0.65rem',
                            cursor: 'pointer',
                            background: active ? 'var(--surface-2, #e2e8f0)' : 'transparent',
                          }}
                        >
                          <div className="small" style={{ fontWeight: 600, lineHeight: 1.3 }}>
                            {c.title || 'New chat'}
                          </div>
                          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                            {formatConvTime(c.updated_at || c.created_at)}
                          </div>
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          title="Delete chat"
                          style={{ padding: '0.35rem' }}
                          disabled={deleteConv.isPending}
                          onClick={() => {
                            if (confirm('Delete this chat?')) deleteConv.mutate(c.id)
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
                {qlix?.connected && orgId && (
                  <div style={{ borderTop: '1px solid var(--border, #e2e8f0)', padding: '0.75rem' }}>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      style={{ width: '100%', justifyContent: 'space-between' }}
                      onClick={() => setShowKnowledge((v) => !v)}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FileText size={14} /> Knowledge
                      </span>
                      <span className="muted small">{showKnowledge ? 'Hide' : 'Manage'}</span>
                    </button>
                    {showKnowledge && (
                      <div style={{ marginTop: 10 }}>
                        <QlixDocuments orgId={orgId} compact />
                        <div style={{ marginTop: 10 }}>
                          <QlixSyncNote qlix={qlix} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {writesEnabled && (
                  <div style={{ borderTop: '1px solid var(--border, #e2e8f0)', padding: '0.75rem' }}>
                    <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                      Standing approvals
                    </div>
                    <StandingApprovals
                      grants={grantsQ.data?.items ?? []}
                      busy={revokeGrant.isPending || revokeAllGrants.isPending}
                      onRevoke={(id) => revokeGrant.mutate(id)}
                      onRevokeAll={() => revokeAllGrants.mutate()}
                    />
                  </div>
                )}
                {(memorySummary || Object.keys(memoryFacts).length > 0) && (
                  <div
                    style={{
                      borderTop: '1px solid var(--border, #e2e8f0)',
                      padding: '0.75rem',
                      maxHeight: 140,
                      overflow: 'auto',
                    }}
                  >
                    <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Org memory</div>
                    {memorySummary && <p className="muted small" style={{ marginBottom: 6 }}>{memorySummary}</p>}
                    {Object.entries(memoryFacts).slice(0, 6).map(([k, v]) => (
                      <div key={k} className="muted" style={{ fontSize: '0.75rem' }}>
                        <strong>{k}</strong>: {String(v)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>

            {/* Chat panel */}
            <div className="ai-chat-main">
              <div
                className="row"
                style={{
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--border, #e2e8f0)',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="ai-chat-collapse"
                  onClick={toggleHistory}
                  aria-expanded={historyOpen}
                  title={historyOpen ? 'Hide chat history' : 'Show chat history'}
                >
                  <PanelLeft size={16} />
                </button>
                <button
                  type="button"
                  className={`btn ${voiceEnabled ? '' : 'btn-ghost'}`}
                  aria-pressed={voiceEnabled}
                  title={
                    voiceEnabled
                      ? 'Voice is on — replies are spoken and the mic is available'
                      : 'Turn on voice input and spoken replies'
                  }
                  onClick={onToggleVoiceMode}
                  style={{ padding: '0.35rem 0.7rem', fontSize: '0.875rem' }}
                >
                  {voiceEnabled ? <Mic size={14} /> : <MicOff size={14} />}
                  Voice {voiceEnabled ? 'on' : 'off'}
                </button>
              </div>

              <div style={{ flex: 1, overflow: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {conversationQ.isLoading && conversationId && (
                  <p className="muted small">Loading conversation…</p>
                )}
                {messages.length === 0 && !conversationQ.isLoading && (
                  <div className="muted small" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <Bot size={16} style={{ marginTop: 2 }} />
                    <div>
                      {writesEnabled ? (
                        <>
                          Try: “Move lead Acme to NEGOTIATION” or “What did we discuss yesterday?”
                          Use Period above to filter past chats by date.
                          {voiceEnabled ? ' Tap the mic to speak.' : ''}
                        </>
                      ) : (
                        'Ask a question, open a past chat from the left, or filter by date with Period.'
                      )}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => {
                  const openActions = (m.pendingActions || []).filter(
                    (p) => !(m.resolvedActionIds || []).includes(p.id),
                  )
                  return (
                    <div
                      key={m.id || `${m.role}-${i}`}
                      style={{
                        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '90%',
                        width: m.role === 'assistant' && openActions.length ? '100%' : undefined,
                      }}
                    >
                      <div
                        style={{
                          padding: '0.7rem 0.9rem',
                          borderRadius: 12,
                          background: m.role === 'user' ? 'var(--primary)' : 'var(--secondary)',
                          color: m.role === 'user' ? '#fff' : 'inherit',
                          whiteSpace: 'pre-wrap',
                          fontSize: '0.925rem',
                          lineHeight: 1.45,
                          maxWidth: m.role === 'user' ? '85%' : '100%',
                          marginLeft: m.role === 'user' ? 'auto' : undefined,
                        }}
                      >
                        {m.content}
                      </div>
                      {m.role === 'assistant' && m.autoApproved?.length ? (
                        <AutoApprovedNotice
                          items={m.autoApproved}
                          revoking={revokeGrant.isPending}
                          onRevoke={(id) => revokeGrant.mutate(id)}
                        />
                      ) : null}
                      {m.role === 'assistant' && m.citations?.length ? (
                        <Citations items={m.citations} />
                      ) : null}
                      {openActions.map((action) => (
                        <div
                          key={action.id}
                          className="card"
                          style={{
                            marginTop: 8,
                            padding: '0.85rem 1rem',
                            border: '1px solid var(--border, #cbd5e1)',
                            background: 'var(--surface, #fff)',
                          }}
                        >
                          <div
                            className="small"
                            style={{
                              marginBottom: 8,
                              fontWeight: 600,
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 8,
                            }}
                          >
                            <span>Confirm action</span>
                            <ApprovalCountdown expiresAt={action.expires_at} />
                          </div>
                          <p className="small" style={{ marginBottom: 10 }}>{action.summary}</p>
                          <div className="row" style={{ gap: 8 }}>
                            <button
                              type="button"
                              className="btn"
                              disabled={!!busyActionId}
                              onClick={() => {
                                setBusyActionId(action.id)
                                confirmMut.mutate(action.id)
                              }}
                            >
                              <Check size={14} />
                              {busyActionId === action.id && confirmMut.isPending ? 'Working…' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={!!busyActionId}
                              onClick={() => {
                                setBusyActionId(action.id)
                                cancelMut.mutate(action.id)
                              }}
                            >
                              <X size={14} />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
                {speech.listening && <p className="muted small">Listening… tap the mic again when done</p>}
                {/* The thinking state, the tools the agent is calling and the
                    Stop button read as part of the conversation, so they sit in
                    the thread itself. The global dock stands down while this is
                    mounted and only covers other pages. */}
                <AgentActivityTrace variant="inline" />
                {streamingReply && (
                  <div style={{ alignSelf: 'flex-start', maxWidth: '90%' }}>
                    <div
                      style={{
                        padding: '0.7rem 0.9rem',
                        borderRadius: 12,
                        background: 'var(--secondary)',
                        whiteSpace: 'pre-wrap',
                        fontSize: '0.925rem',
                        lineHeight: 1.45,
                      }}
                    >
                      {streamingReply.shown}
                      {streamingReply.shown.length < streamingReply.full.length && (
                        <span className="ai-stream-cursor" />
                      )}
                    </div>
                  </div>
                )}
                {chat.error && <p className="error">{(chat.error as Error).message}</p>}
                {voiceError && <p className="error">{voiceError}</p>}
                <div ref={bottomRef} />
              </div>

              <form
                onSubmit={onSubmit}
                className="row"
                style={{
                  gap: '0.5rem',
                  padding: '0.85rem 1rem',
                  borderTop: '1px solid var(--border, #e2e8f0)',
                  alignItems: 'flex-end',
                }}
              >
                <textarea
                  className="input"
                  rows={2}
                  placeholder={
                    speech.listening
                      ? 'Listening…'
                      : writesEnabled
                        ? voiceEnabled
                          ? 'Ask, command, or tap the mic…'
                          : 'Ask or command…'
                        : 'Message Loomrun AI…'
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={chat.isPending || !!streamingReply}
                  style={{ flex: 1, resize: 'none' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      onSubmit(e)
                    }
                  }}
                />
                {voiceEnabled && (
                <button
                  type="button"
                  className={`btn ${speech.listening ? '' : 'btn-ghost'}`}
                  title={speech.listening ? 'Stop and send' : 'Speak'}
                  aria-pressed={speech.listening}
                  disabled={chat.isPending || !!streamingReply}
                  onClick={onToggleVoice}
                  style={
                    speech.listening
                      ? { background: '#dc2626', borderColor: '#dc2626', color: '#fff' }
                      : undefined
                  }
                >
                  {speech.listening ? <MicOff size={15} /> : <Mic size={15} />}
                </button>
                )}
                <button
                  type="submit"
                  className="btn"
                  disabled={chat.isPending || !!streamingReply || !input.trim() || !activeModel || speech.listening}
                >
                  <Send size={15} />
                  Send
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
