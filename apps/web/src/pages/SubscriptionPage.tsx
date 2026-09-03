import { useQuery } from '@tanstack/react-query'
import { Check, CreditCard, Mail, Sparkles, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { planBadgeClass, type SubscriptionInfo } from '../lib/entitlements'
import { membershipForOrg } from '../lib/membership'

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string
  used: number
  limit: number | null
}) {
  const capped = limit != null && limit > 0
  const pct = capped ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="small">{label}</span>
        <span className="muted small">
          {used}{limit == null ? '' : ` / ${limit}`}
          {limit == null ? ' (unlimited)' : '/day'}
        </span>
      </div>
      {capped && (
        <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2, #e2e8f0)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? '#dc2626' : 'var(--primary)' }} />
        </div>
      )}
    </div>
  )
}

export function SubscriptionPage() {
  const { orgId, me } = useAuth()
  const membership = membershipForOrg(me, orgId)
  const isOwner = membership?.role === 'OWNER'

  const subQ = useQuery({
    queryKey: ['subscription', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<SubscriptionInfo>(`/v1/orgs/${orgId}/subscription`),
  })

  const data = subQ.data
  const plan = (data?.plan || membership?.organization.plan || 'free').toLowerCase()
  const trial = data?.trial
  const expired = !!trial?.trial_expired
  const activeTrial = !!trial?.trial_active

  return (
    <>
      <PageHeader
        title="Subscription"
        description="14-day free trial includes Scale features at limited capacity — then choose Growth or Scale"
      />

      <div className="page-body stack" style={{ gap: '1.75rem' }}>
        {subQ.isLoading && <p className="muted">Loading subscription…</p>}
        {subQ.error && <p className="error">{(subQ.error as Error).message}</p>}

        {data && (
          <>
            {expired && (
              <div className="card" style={{ maxWidth: 720, borderColor: '#dc2626' }}>
                <div className="row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <Sparkles size={18} />
                  <strong>Your free trial has ended</strong>
                </div>
                <p className="muted small" style={{ marginBottom: '1rem' }}>
                  Choose Growth or Scale to restore access. Free trial includes all Scale features with lower daily limits.
                </p>
                <a className="btn" href={data.upgrade.mailto}>
                  <Mail size={15} />
                  Contact to upgrade
                </a>
              </div>
            )}

            {activeTrial && (
              <div className="card" style={{ maxWidth: 720 }}>
                <strong>Free trial active — {trial?.days_left ?? 0} day{(trial?.days_left ?? 0) === 1 ? '' : 's'} left</strong>
                <p className="muted small" style={{ marginTop: '0.35rem' }}>
                  You currently have Scale-level features with trial capacity limits
                  ({data.entitlements.messages_per_day ?? '—'} messages/day,{' '}
                  {data.entitlements.ai_messages_per_day ?? '—'} AI chats/day,{' '}
                  {data.entitlements.max_users} users,{' '}
                  {data.entitlements.max_leads ?? '∞'} leads).
                </p>
              </div>
            )}

            <div className="card" style={{ maxWidth: 720 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div>
                  <div className="muted small" style={{ marginBottom: '0.35rem' }}>Current plan</div>
                  <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.35rem', fontWeight: 700 }}>
                      {data.plan_label}
                    </span>
                    <span className={`badge ${planBadgeClass(plan)}`}>{plan}</span>
                    {activeTrial && <span className="badge badge-amber">Trial</span>}
                    {expired && <span className="badge badge-red">Expired</span>}
                  </div>
                  <p className="muted small" style={{ marginTop: '0.4rem' }}>
                    Status: {data.status}
                    {data.ai_mode !== 'disabled' && <> · AI: {data.ai_mode}</>}
                    {data.entitlements.ai_multilingual && <> · Multilingual</>}
                  </p>
                </div>
                <div className="row" style={{ gap: '0.5rem' }}>
                  <Users size={16} className="muted" />
                  <span>
                    <strong>{data.seats.used}</strong>
                    <span className="muted"> / {data.seats.limit} seats</span>
                  </span>
                </div>
              </div>

              <div className="stack" style={{ gap: '0.75rem', marginTop: '1rem' }}>
                <UsageBar
                  label="WhatsApp messages today"
                  used={data.usage.whatsapp_outbound.used}
                  limit={data.usage.whatsapp_outbound.limit}
                />
                <UsageBar
                  label="AI chats today"
                  used={data.usage.ai_chat.used}
                  limit={data.usage.ai_chat.limit}
                />
                <div className="muted small">
                  Leads: {data.leads.used}
                  {data.leads.limit != null ? ` / ${data.leads.limit}` : ' (unlimited)'}
                </div>
              </div>

              {plan !== 'scale' && (
                <div style={{ marginTop: '1rem' }}>
                  <a className="btn" href={data.upgrade.mailto}>
                    <Mail size={15} />
                    {expired || plan === 'free' ? 'Contact to buy a plan' : 'Upgrade to Scale'}
                  </a>
                </div>
              )}
              {!isOwner && (
                <p className="muted small" style={{ marginTop: '0.75rem' }}>
                  Only organization owners can manage billing requests.
                </p>
              )}
            </div>

            <div>
              <div className="section-title" style={{ marginBottom: '1rem' }}>
                <CreditCard size={16} style={{ marginRight: '0.4rem' }} />
                Paid plans
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '1.25rem',
                }}
              >
                {data.catalog.map((item) => {
                  const isCurrent = item.key === plan && !activeTrial && !expired
                  return (
                    <div
                      key={item.key}
                      className="card"
                      style={{
                        borderColor: isCurrent || item.highlight ? 'var(--primary)' : undefined,
                        outline: isCurrent ? '2px solid var(--primary)' : undefined,
                      }}
                    >
                      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{item.name}</div>
                        {isCurrent && <span className="badge badge-green">Current</span>}
                        {!isCurrent && item.highlight && <span className="badge badge-indigo">Popular</span>}
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                        {item.price_label}
                      </div>
                      <p className="muted small" style={{ marginBottom: '1rem' }}>
                        Up to {item.included_users} users · ₹{item.extra_user_price_inr}/extra user
                      </p>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
                        {item.features.map((f) => (
                          <li key={f} className="row small" style={{ gap: '0.45rem', alignItems: 'flex-start' }}>
                            <Check size={14} style={{ marginTop: 2, flexShrink: 0, color: 'var(--success, #16a34a)' }} />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                      {!isCurrent && (
                        <div style={{ marginTop: '1.25rem' }}>
                          <a className="btn btn-ghost" href={data.upgrade.mailto} style={{ width: '100%', justifyContent: 'center' }}>
                            <Mail size={15} />
                            Request {item.name}
                          </a>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <p className="muted small">
              Need AI assistance?{' '}
              <Link to="/app/ai">Open Loomrun AI</Link>
              {' · '}
              Questions: {data.upgrade.contact_email}
            </p>
          </>
        )}
      </div>
    </>
  )
}
