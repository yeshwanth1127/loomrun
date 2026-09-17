import { ArrowLeft, Bot, Mail, MessageCircle, Phone, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { SendQuoteMenu } from '../../components/SendQuoteMenu'
import { PageHeader } from '../../components/ui/PageHeader'
import { ScoreRing } from '../../components/ui/ScoreRing'
import { useAuth } from '../../context/AuthContext'
import { routes } from '../../lib/appRoutes'
import { CALL_STATUS_MAP } from '../../lib/callStatus'
import { SOURCE_LABELS, STAGES, STAGE_COLOR, STAGE_LABELS } from '../../lib/leads'
import { isOwnerRole, membershipForOrg } from '../../lib/membership'
import { LeadActivityPanel } from './LeadActivityPanel'
import { LeadCallPanel } from './LeadCallPanel'
import { LeadOrderPanel } from './LeadOrderPanel'
import { LeadOverviewPanel } from './LeadOverviewPanel'
import { LeadQuotesPanel } from './LeadQuotesPanel'
import { useLeadWorkspace } from './useLeadWorkspace'

type TabKey = 'overview' | 'call' | 'quotes' | 'activity' | 'order'

export function LeadDetailPage() {
  const { leadId = '' } = useParams()
  const { me, orgId } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const membership = membershipForOrg(me, orgId)
  const isOwner = isOwnerRole(membership) || !!me?.is_super_admin
  const canSeeQuotes = isOwner || membership?.role === 'SALES' || membership?.role === 'TELECALLER'
  const canManageQuotes = canSeeQuotes

  const tabParam = searchParams.get('tab')
  const requested: TabKey =
    tabParam === 'call' || tabParam === 'quotes' || tabParam === 'activity' || tabParam === 'order'
      ? tabParam
      : 'overview'
  // Quotes and Order are Owner-only; a deep link to them lands on Overview instead
  // of an empty panel.
  const tab: TabKey =
    (requested === 'quotes' && !canSeeQuotes) || (requested === 'order' && !isOwner)
      ? 'overview'
      : requested

  const workspace = useLeadWorkspace(orgId ?? '', leadId)
  const lead = workspace.detailQ.data

  function setTab(next: TabKey) {
    const params = new URLSearchParams(searchParams)
    if (next === 'overview') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  if (!orgId) {
    return (
      <div className="page">
        <PageHeader title="Lead" description="Select an organization." />
      </div>
    )
  }

  if (workspace.detailQ.isLoading) {
    return (
      <div className="page">
        <PageHeader title="Loading lead…" />
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="page">
        <PageHeader
          title="Lead not found"
          description="It may have been deleted."
          actions={
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => navigate(routes.sales())}
            >
              <ArrowLeft size={14} />
              Back to Sales
            </button>
          }
        />
      </div>
    )
  }

  const outcome = lead.last_call_outcome ? CALL_STATUS_MAP[lead.last_call_outcome] : null
  const tabs: Array<{ key: TabKey; label: string; show: boolean }> = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'call', label: 'Call', show: true },
    { key: 'quotes', label: 'Quotes', show: canSeeQuotes },
    { key: 'activity', label: 'History', show: true },
    { key: 'order', label: 'Order', show: isOwner },
  ]

  function confirmDelete() {
    if (!window.confirm(`Delete ${lead?.title || 'this lead'}? This cannot be undone.`)) return
    workspace.deleteLead.mutate(undefined, {
      onSuccess: () => navigate(routes.sales()),
    })
  }

  return (
    <div className="page lead-workspace">
      <PageHeader
        title={lead.title}
        description={
          <span className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
            <span className={`badge ${STAGE_COLOR[lead.stage] ?? 'badge-slate'}`}>
              {STAGE_LABELS[lead.stage] ?? lead.stage}
            </span>
            {lead.pipeline_name && <span className="badge badge-indigo">{lead.pipeline_name}</span>}
            <span className="source-pill">{SOURCE_LABELS[lead.source] ?? lead.source}</span>
            {outcome && <span className={`badge ${outcome.color}`}>{outcome.label}</span>}
            {lead.company && <span className="muted small">{lead.company}</span>}
          </span>
        }
        actions={
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => navigate(routes.sales())}
            >
              <ArrowLeft size={14} />
              Sales
            </button>
            <ScoreRing score={lead.lead_score} />
          </div>
        }
        toolbar={
          <div className="quick-actions lead-quick-actions">
            {lead.phone && (
              <a className="quick-action-btn" href={`tel:${lead.phone}`}>
                <Phone size={14} />
                Call
              </a>
            )}
            {lead.phone && (
              <a
                className="quick-action-btn"
                href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={14} />
                WhatsApp
              </a>
            )}
            {lead.email && (
              <a className="quick-action-btn" href={`mailto:${lead.email}`}>
                <Mail size={14} />
                Email
              </a>
            )}
            <Link
              className="quick-action-btn"
              to={routes.askAi(
                `About the lead "${lead.title}"${lead.company ? ` from ${lead.company}` : ''} (stage ${STAGE_LABELS[lead.stage] ?? lead.stage}): what should I do next?`,
              )}
            >
              <Bot size={14} />
              Ask AI
            </Link>
            <SendQuoteMenu
              key={lead.id}
              orgId={orgId}
              leadId={lead.id}
              phone={lead.phone}
              email={lead.email}
            />
            <select
              className="select"
              value={lead.stage}
              onChange={(e) => workspace.updateLead.mutate({ stage: e.target.value })}
              aria-label="Stage"
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s] ?? s}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={confirmDelete}
              disabled={workspace.deleteLead.isPending}
              title="Delete lead"
            >
              <Trash2 size={14} />
            </button>
          </div>
        }
      >
        <div className="panel-tabs lead-tabs">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
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
      </PageHeader>

      <div className="page-body">
        {tab === 'overview' && (
          <LeadOverviewPanel
            // Remount when the follow-up changes so the scheduler fields reload.
            key={`${lead.id}:${lead.next_follow_up_at ?? ''}`}
            lead={lead}
            orgId={orgId}
            workspace={workspace}
          />
        )}
        {tab === 'call' && <LeadCallPanel lead={lead} orgId={orgId} workspace={workspace} />}
        {tab === 'quotes' && canSeeQuotes && (
          <LeadQuotesPanel
            lead={lead}
            orgId={orgId}
            isOwner={isOwner}
            canManageQuotes={canManageQuotes}
          />
        )}
        {tab === 'activity' && <LeadActivityPanel lead={lead} orgId={orgId} />}
        {tab === 'order' && isOwner && <LeadOrderPanel lead={lead} orgId={orgId} />}
      </div>
    </div>
  )
}
