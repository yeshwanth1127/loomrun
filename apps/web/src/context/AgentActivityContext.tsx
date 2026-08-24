import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

/** One tool the agent ran (or is running) during the current turn. */
export type AgentToolCall = {
  id: string
  name: string
  phase: 'running' | 'done' | 'error'
  args?: Record<string, string | number | boolean>
}

type AgentActivityState = {
  /** True from the moment a turn starts until it settles. */
  active: boolean
  /** Qlix run id, when there is one to stop. */
  runId: string | null
  /** Tool calls for the current turn, in the order they started. */
  tools: AgentToolCall[]
  /** Where the turn is: waiting on the model, or writing the answer. */
  phase: 'thinking' | 'writing'
  /** True while a view is showing this trace inline (the chat thread). */
  inlineHosted: boolean
}

type AgentActivityValue = AgentActivityState & {
  canStop: boolean
  begin: () => void
  setRunId: (runId: string | null) => void
  noteTool: (tool: { name: string; phase: AgentToolCall['phase']; args?: AgentToolCall['args'] }) => void
  setPhase: (phase: AgentActivityState['phase']) => void
  end: () => void
  /** Registered by whoever owns the stream; the dock calls it. */
  registerStop: (fn: (() => void) | null) => void
  stop: () => void
  /**
   * Claim the trace for an inline view. Returns the release function, so a
   * view can hold the claim for as long as it is mounted. Ref-counted, so a
   * remount that overlaps the unmount of the previous one cannot leave the
   * dock permanently suppressed.
   */
  registerInlineHost: () => () => void
}

const EMPTY: Omit<AgentActivityState, 'inlineHosted'> = {
  active: false,
  runId: null,
  tools: [],
  phase: 'thinking',
}

const AgentActivityContext = createContext<AgentActivityValue | undefined>(undefined)

/**
 * Holds "what is the agent doing right now" above the router, so the dock can
 * render it from any page. The chat page owns the stream and reports into
 * here; nothing in this provider talks to the network itself.
 */
export function AgentActivityProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AgentActivityState>({ ...EMPTY, inlineHosted: false })
  const stopRef = useRef<(() => void) | null>(null)
  const inlineHostCount = useRef(0)

  const begin = useCallback(() => {
    setState((cur) => ({ ...cur, active: true, runId: null, tools: [], phase: 'thinking' }))
  }, [])

  const setRunId = useCallback((runId: string | null) => {
    setState((cur) => ({ ...cur, runId }))
  }, [])

  const setPhase = useCallback((phase: AgentActivityState['phase']) => {
    setState((cur) => (cur.phase === phase ? cur : { ...cur, phase }))
  }, [])

  const noteTool = useCallback(
    (tool: { name: string; phase: AgentToolCall['phase']; args?: AgentToolCall['args'] }) => {
      setState((cur) => {
        const tools = [...cur.tools]
        // A finishing tool updates the row it started, rather than adding a
        // second chip for the same call.
        for (let i = tools.length - 1; i >= 0; i -= 1) {
          if (tools[i].name === tool.name && tools[i].phase === 'running') {
            tools[i] = { ...tools[i], phase: tool.phase, args: tool.args ?? tools[i].args }
            return { ...cur, tools }
          }
        }
        tools.push({
          id: `${tool.name}-${tools.length}-${Date.now()}`,
          name: tool.name,
          phase: tool.phase,
          args: tool.args,
        })
        return { ...cur, tools }
      })
    },
    [],
  )

  const end = useCallback(() => {
    setState((cur) => ({ ...cur, ...EMPTY }))
  }, [])

  const registerStop = useCallback((fn: (() => void) | null) => {
    stopRef.current = fn
  }, [])

  const stop = useCallback(() => {
    stopRef.current?.()
  }, [])

  const registerInlineHost = useCallback(() => {
    inlineHostCount.current += 1
    setState((cur) => (cur.inlineHosted ? cur : { ...cur, inlineHosted: true }))
    let released = false
    return () => {
      if (released) return
      released = true
      inlineHostCount.current = Math.max(0, inlineHostCount.current - 1)
      if (inlineHostCount.current === 0) {
        setState((cur) => (cur.inlineHosted ? { ...cur, inlineHosted: false } : cur))
      }
    }
  }, [])

  const value = useMemo<AgentActivityValue>(
    () => ({
      ...state,
      // The local fallback agent has no run to cancel remotely, but the user
      // can still abandon the turn, so the button stays available either way.
      canStop: state.active,
      begin,
      setRunId,
      noteTool,
      setPhase,
      end,
      registerStop,
      stop,
      registerInlineHost,
    }),
    [state, begin, setRunId, noteTool, setPhase, end, registerStop, stop, registerInlineHost],
  )

  return <AgentActivityContext.Provider value={value}>{children}</AgentActivityContext.Provider>
}

export function useAgentActivity() {
  const ctx = useContext(AgentActivityContext)
  if (!ctx) throw new Error('useAgentActivity must be used within an AgentActivityProvider')
  return ctx
}
