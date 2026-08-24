import { useAgentActivity } from '../context/AgentActivityContext'
import { AgentActivityTrace } from './AgentActivityTrace'

/**
 * Fixed, app-wide fallback readout of the current agent turn, for when the user
 * is somewhere other than the chat. The chat thread shows the same trace inline
 * and claims it while mounted, so the two never appear at once.
 */
export function AgentActivityDock() {
  const { active, inlineHosted } = useAgentActivity()

  if (!active || inlineHosted) return null

  return (
    <div className="agent-dock" role="status" aria-live="polite">
      <AgentActivityTrace variant="dock" />
    </div>
  )
}
