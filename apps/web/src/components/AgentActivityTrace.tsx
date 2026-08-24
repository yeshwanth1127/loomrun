import { Check, Square, TriangleAlert } from 'lucide-react'
import { useAgentActivity, type AgentToolCall } from '../context/AgentActivityContext'

/**
 * Human wording for each agent tool, so the trace reads as a narration of what
 * is happening rather than a dump of function names. Unknown tools fall back
 * to a de-underscored version of the name, which stays readable as tools are
 * added without anyone having to update this map.
 */
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  search_leads: { running: 'Searching leads', done: 'Searched leads' },
  count_leads: { running: 'Counting leads', done: 'Counted leads' },
  get_lead: { running: 'Opening the lead', done: 'Read the lead' },
  create_lead: { running: 'Drafting a new lead', done: 'Drafted a new lead' },
  update_lead: { running: 'Preparing a lead update', done: 'Prepared a lead update' },
  list_catalog: { running: 'Checking the catalogue', done: 'Checked the catalogue' },
  list_team_members: { running: 'Looking up the team', done: 'Looked up the team' },
  search_quotations: { running: 'Searching quotations', done: 'Searched quotations' },
  get_quotation: { running: 'Opening the quotation', done: 'Read the quotation' },
  create_quotation: { running: 'Drafting a quotation', done: 'Drafted a quotation' },
  send_quotation: { running: 'Preparing to send', done: 'Ready to send' },
  create_and_send_quotation: { running: 'Building the quotation', done: 'Quotation ready' },
  create_and_send_invoice: { running: 'Building the invoice', done: 'Invoice ready' },
  search_past_chats: { running: 'Looking through past chats', done: 'Checked past chats' },
}

function labelFor(tool: AgentToolCall): string {
  const entry = TOOL_LABELS[tool.name]
  const fallback = tool.name.replace(/_/g, ' ')
  if (tool.phase === 'error') return `${entry?.running ?? fallback} — failed`
  if (tool.phase === 'done') return entry?.done ?? fallback
  return entry?.running ?? fallback
}

/** A short hint of what the tool was pointed at, when it is worth showing. */
function detailFor(tool: AgentToolCall): string | null {
  const args = tool.args
  if (!args) return null
  const interesting = ['search', 'sort', 'stage', 'lead_id', 'limit']
  for (const key of interesting) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.slice(0, 32)
    if (typeof value === 'number') return String(value)
  }
  return null
}

/**
 * The agent readout for the running turn: what it is doing, which tools it has
 * called, and the Stop control. Shared by the in-thread trace and the app-wide
 * dock so the two can never narrate the same turn differently.
 */
export function AgentActivityTrace({ variant = 'dock' }: { variant?: 'dock' | 'inline' }) {
  const { active, tools, phase, canStop, stop } = useAgentActivity()

  if (!active) return null

  return (
    <div className={variant === 'inline' ? 'agent-trace-inline' : 'agent-dock-inner'}>
      <div className="agent-dock-head">
        <span className="agent-dock-pulse" aria-hidden="true" />
        <span className="agent-dock-title">
          {phase === 'writing' ? 'Writing the answer' : 'Thinking'}
          <span className="agent-dock-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </span>
        {canStop && (
          <button type="button" className="agent-dock-stop" onClick={stop} title="Stop the agent">
            <Square size={11} />
            Stop
          </button>
        )}
      </div>

      {tools.length > 0 && (
        <ul className="agent-dock-steps">
          {tools.map((tool) => {
            const detail = detailFor(tool)
            return (
              <li key={tool.id} className={`agent-dock-step is-${tool.phase}`}>
                <span className="agent-dock-step-icon" aria-hidden="true">
                  {tool.phase === 'done' ? (
                    <Check size={11} />
                  ) : tool.phase === 'error' ? (
                    <TriangleAlert size={11} />
                  ) : (
                    <span className="agent-dock-spinner" />
                  )}
                </span>
                <span className="agent-dock-step-label">{labelFor(tool)}</span>
                {detail && <span className="agent-dock-step-detail">{detail}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
