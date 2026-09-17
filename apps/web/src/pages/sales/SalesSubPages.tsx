import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { routes } from '../../lib/appRoutes'
import { PipelineWorkspacePage } from '../PipelineWorkspacePage'
import { PipelinesPage } from '../PipelinesPage'
import { QuotationsPage } from '../QuotationsPage'

/** Shared chrome for the two Sales side-surfaces that keep their existing screens. */
function SalesSubPage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sales-subpage">
      <div className="sales-subpage-bar">
        <Link to={routes.sales()} className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} />
          Sales
        </Link>
        <span className="muted small">{label}</span>
      </div>
      {children}
    </div>
  )
}

/** Pipeline creation, default/archive, stages and routing all live here. */
export function OrganizePipelinesPage() {
  return (
    <SalesSubPage label="Organize pipelines">
      <PipelinesPage />
    </SalesSubPage>
  )
}

export function PipelineDetailPage() {
  return <PipelineWorkspacePage />
}

/** Every quotation in one list — the per-lead view lives on the lead itself. */
export function AllQuotesPage() {
  return (
    <SalesSubPage label="All quotations">
      <QuotationsPage />
    </SalesSubPage>
  )
}

/**
 * `/app/telecaller?lead=…` used to open the dialler.
 * With a lead, land in Sales → Calls with that lead selected so the queue loop continues.
 * Without a lead, open the Calls workspace.
 */
export function TelecallerRedirect() {
  const [searchParams] = useSearchParams()
  const leadId = searchParams.get('lead')
  return (
    <Navigate
      to={
        leadId
          ? `/app/sales?view=calling&lead=${encodeURIComponent(leadId)}`
          : routes.sales('calling')
      }
      replace
    />
  )
}

export function PipelineRedirect() {
  const { pipelineId } = useParams()
  return (
    <Navigate
      to={pipelineId ? `/app/sales/organize/${pipelineId}` : routes.salesOrganize}
      replace
    />
  )
}
