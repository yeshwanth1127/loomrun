import { useQuery } from '@tanstack/react-query'
import { Bot, MessageCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { routes } from '../lib/appRoutes'
import { apiFetch } from '../lib/api'
import {
  formatResetsIn,
  usagePercent,
  type SubscriptionInfo,
} from '../lib/entitlements'

function PercentUsageBar({
  label,
  used,
  limit,
  resetsAt,
  hint,
}: {
  label: string
  used: number
  limit: number | null
  resetsAt?: string | null
  hint?: string
}) {
  const pct = usagePercent(used, limit)
  const capped = limit != null && limit > 0
  const resetLabel = formatResetsIn(resetsAt)
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6, gap: 12 }}>
        <div>
          <div className="small" style={{ fontWeight: 600 }}>{label}</div>
          {hint && <div className="muted small" style={{ marginTop: 2 }}>{hint}</div>}
        </div>
        <div className="muted small" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {capped ? (
            <>
              <strong style={{ color: 'inherit', fontWeight: 650 }}>{pct}%</strong>
              {resetLabel ? ` · resets in ${resetLabel}` : ''}
            </>
          ) : (
            'Unlimited'
          )}
        </div>
      </div>
      {capped && (
        <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-2, #e2e8f0)', overflow: 'hidden' }}>
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 99,
              background: pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : 'var(--primary)',
              transition: 'width 0.25s ease',
            }}
          />
        </div>
      )}
    </div>
  )
}

export function UsagePage() {
  const { orgId } = useAuth()

  const subQ = useQuery({
    queryKey: ['subscription', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<SubscriptionInfo>(`/v1/orgs/${orgId}/subscription`),
  })

  const data = subQ.data
  const ai = data?.usage.ai
  const sessionPct = usagePercent(ai?.session5h.used ?? 0, ai?.session5h.limit ?? null)
  const weeklyPct = usagePercent(ai?.weekly.used ?? 0, ai?.weekly.limit ?? null)

  return (
    <>
      <PageHeader
        title="Usage"
        description="How much of your included Loomrun AI and messaging capacity you’ve used"
      />

      <div className="page-body stack" style={{ gap: '1.25rem', maxWidth: 640 }}>
        {subQ.isLoading && <p className="muted">Loading usage…</p>}
        {subQ.error && <p className="error">{(subQ.error as Error).message}</p>}

        {data && data.usage?.ai && (
          <>
            <div className="card">
              <div className="row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
                <Bot size={18} />
                <strong>Loomrun AI</strong>
                {data.ai_mode !== 'disabled' && (
                  <span className="badge badge-slate" style={{ marginLeft: 4 }}>{data.ai_mode}</span>
                )}
              </div>
              <p className="muted small" style={{ marginBottom: '1.1rem' }}>
                Session and weekly limits reset automatically. Both must have remaining capacity to chat.
              </p>
              <div className="stack" style={{ gap: '1.15rem' }}>
                <PercentUsageBar
                  label="Current session"
                  hint="Resets 5 hours after you start using AI"
                  used={data.usage.ai.session5h.used}
                  limit={data.usage.ai.session5h.limit}
                  resetsAt={data.usage.ai.session5h.resetsAt}
                />
                <PercentUsageBar
                  label="Weekly"
                  hint="Resets once per week for your organization"
                  used={data.usage.ai.weekly.used}
                  limit={data.usage.ai.weekly.limit}
                  resetsAt={data.usage.ai.weekly.resetsAt}
                />
              </div>
              {(sessionPct >= 90 || weeklyPct >= 90) && (
                <p className="muted small" style={{ marginTop: '1rem' }}>
                  You’re near a limit.{' '}
                  <Link to={routes.settings('plan')}>Upgrade your plan</Link> for more capacity.
                </p>
              )}
            </div>

            <div className="card">
              <div className="row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
                <MessageCircle size={18} />
                <strong>WhatsApp messaging</strong>
              </div>
              <PercentUsageBar
                label="Messages today"
                hint="Resets every day at midnight UTC"
                used={data.usage.whatsapp_outbound.used}
                limit={data.usage.whatsapp_outbound.limit}
              />
            </div>
          </>
        )}
      </div>
    </>
  )
}
