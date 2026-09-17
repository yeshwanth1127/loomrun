import { useQuery } from '@tanstack/react-query'
import { Plus, Store } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui/EmptyState'
import { FilterToolbar } from '../components/ui/FilterToolbar'
import { PageHeader } from '../components/ui/PageHeader'
import { BarList, DonutChart, DonutLegend, InsightCard, InsightGrid, MetricCard } from '../components/ui/dashboard'
import { useAuth } from '../context/AuthContext'
import { useDateFilter } from '../context/DateFilterContext'
import { apiFetch } from '../lib/api'
import { routes } from '../lib/appRoutes'
import { fmtINR, initials, timeAgo } from '../lib/format'

type Expense = {
  id: string
  vendor: string | null
  category: string
  amount_cents: number
  incurred_at: string
  description: string | null
  lead_title: string | null
}

function vendorType(category: string) {
  const c = category.toUpperCase()
  if (c.includes('FABRIC') || c.includes('SUPPL')) return 'Supplier'
  if (c.includes('OUTSOURC') || c.includes('JOB') || c.includes('PRINT') || c.includes('STITCH')) return 'Job Worker'
  if (c.includes('FREIGHT') || c.includes('COURIER') || c.includes('LOGIST')) return 'Courier'
  return 'Other'
}

const TYPE_COLOR: Record<string, string> = {
  Supplier: '#0F766E',
  'Job Worker': '#2563eb',
  Courier: '#ea580c',
  Other: '#64748b',
}

export function VendorsPage() {
  const { orgId } = useAuth()
  const { dayParam, appendDay, isAll } = useDateFilter()
  const [search, setSearch] = useState('')

  const q = useQuery({
    queryKey: ['expenses', orgId, 'vendors', dayParam],
    enabled: !!orgId,
    queryFn: () => {
      const params = new URLSearchParams()
      appendDay(params)
      params.set('scope', 'all')
      return apiFetch<{ items: Expense[] }>(`/v1/orgs/${orgId}/expenses?${params}`)
    },
  })

  const items = q.data?.items ?? []
  const grouped = new Map<string, {
    name: string
    type: string
    category: string
    payable: number
    lastAt: string
    count: number
  }>()
  for (const e of items) {
    const name = (e.vendor || '').trim()
    if (!name) continue
    const type = vendorType(e.category)
    const prev = grouped.get(name)
    if (!prev) {
      grouped.set(name, {
        name,
        type,
        category: e.category,
        payable: e.amount_cents,
        lastAt: e.incurred_at,
        count: 1,
      })
    } else {
      prev.payable += e.amount_cents
      prev.count += 1
      if (e.incurred_at > prev.lastAt) {
        prev.lastAt = e.incurred_at
        prev.category = e.category
        prev.type = type
      }
    }
  }

  const vendors = [...grouped.values()].sort((a, b) => b.payable - a.payable)
  const qtext = search.trim().toLowerCase()
  const visible = vendors.filter((v) =>
    !qtext || v.name.toLowerCase().includes(qtext) || v.type.toLowerCase().includes(qtext) || v.category.toLowerCase().includes(qtext),
  )
  const byType = new Map<string, number>()
  for (const v of vendors) byType.set(v.type, (byType.get(v.type) ?? 0) + 1)
  const totalPayable = vendors.reduce((s, v) => s + v.payable, 0)
  const recent = [...items]
    .filter((e) => e.vendor)
    .sort((a, b) => +new Date(b.incurred_at) - +new Date(a.incurred_at))
    .slice(0, 5)

  if (!orgId) {
    return <PageHeader title="Vendors" description="Select an organization." />
  }

  return (
    <div className="page">
      <PageHeader
        title="Vendors"
        badge={`${vendors.length} total`}
        description="Manage fabric suppliers, job workers, couriers, and more. Vendors appear here from expenses you record."
        actions={
          <Link to={routes.money('expenses')} className="btn">
            <Plus size={15} /> Add expense
          </Link>
        }
        toolbar={
          <FilterToolbar collapsible={false}>
            <input
              className="input"
              placeholder="Search by vendor name, type, category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 240 }}
            />
          </FilterToolbar>
        }
      />
      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        <div className="metrics-grid">
          <MetricCard icon={Store} tone="purple" label="Total vendors" value={vendors.length} hint={isAll ? 'This period' : dayParam} />
          <MetricCard icon={Store} tone="green" label="Suppliers" value={byType.get('Supplier') ?? 0} />
          <MetricCard icon={Store} tone="blue" label="Job workers" value={byType.get('Job Worker') ?? 0} />
          <MetricCard icon={Store} tone="amber" label="Couriers" value={byType.get('Courier') ?? 0} />
          <MetricCard icon={Store} tone="purple" label="Total payable" value={fmtINR(totalPayable, { cents: true })} />
        </div>

        {q.isLoading && <p className="muted">Loading vendors…</p>}

        {visible.length > 0 ? (
          <div className="table-wrap card">
            <table>
              <thead>
                <tr>
                  <th>Vendor name</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Payable</th>
                  <th>Last transaction</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => (
                  <tr key={v.name}>
                    <td>
                      <div className="row" style={{ gap: '0.55rem' }}>
                        <div className="user-avatar" style={{ width: 32, height: 32, fontSize: '0.7rem' }}>{initials(v.name)}</div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{v.name}</div>
                          <div className="muted small">{v.count} bill{v.count === 1 ? '' : 's'}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="badge badge-purple">{v.type}</span></td>
                    <td className="muted">{v.category}</td>
                    <td style={{ fontWeight: 700 }}>{fmtINR(v.payable, { cents: true })}</td>
                    <td className="muted small">{timeAgo(v.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !q.isLoading && (
            <EmptyState
              icon={Store}
              title="No vendors yet"
              description="Vendors are created automatically when you record an expense with a vendor name."
              action={<Link to={routes.money('expenses')} className="btn">Record an expense</Link>}
            />
          )
        )}

        <InsightGrid>
          <InsightCard title="Top vendors by payable" action={{ label: 'View expenses', to: routes.money('expenses') }}>
            <BarList
              items={vendors.slice(0, 5).map((v) => ({
                label: v.name,
                value: v.payable / 100,
                color: TYPE_COLOR[v.type],
              }))}
              formatValue={(n) => `₹${n.toLocaleString('en-IN')}`}
            />
          </InsightCard>
          <InsightCard title="Vendor by type">
            {vendors.length === 0 ? (
              <p className="muted small">No vendor types yet.</p>
            ) : (
              <>
                <DonutChart
                  segments={[...byType.entries()].map(([label, value]) => ({
                    label,
                    value,
                    color: TYPE_COLOR[label] ?? '#64748b',
                  }))}
                  center={{ value: vendors.length, label: 'Total' }}
                />
                <DonutLegend
                  segments={[...byType.entries()].map(([label, value]) => ({
                    label,
                    value,
                    color: TYPE_COLOR[label] ?? '#64748b',
                  }))}
                  total={vendors.length}
                />
              </>
            )}
          </InsightCard>
          <InsightCard title="Recent transactions">
            {recent.length === 0 ? (
              <p className="muted small">No vendor bills yet.</p>
            ) : (
              <div className="stack" style={{ gap: '0.45rem', fontSize: '0.82rem' }}>
                {recent.map((e) => (
                  <div key={e.id} className="row spread">
                    <div>
                      <div style={{ fontWeight: 600 }}>{e.vendor}</div>
                      <div className="muted small">{e.category}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div>{fmtINR(e.amount_cents, { cents: true })}</div>
                      <div className="muted small">{timeAgo(e.incurred_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </InsightCard>
        </InsightGrid>
      </div>
    </div>
  )
}

