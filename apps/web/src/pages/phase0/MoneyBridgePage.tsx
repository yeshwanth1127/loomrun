import { FileText, Receipt, Store } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/ui/PageHeader'

/**
 * Phase 0 Money bridge — deep-links to existing Invoices / Expenses / Vendors pages.
 * Phase 4 will consolidate into a real Money workspace.
 */
export function MoneyBridgePage() {
  return (
    <div className="page">
      <PageHeader
        title="Money"
        description="Invoices, expenses, and suppliers — same tools as before, under one place."
      />
      <div className="phase0-bridge-grid">
        <Link to="/app/invoices" className="phase0-bridge-card card">
          <FileText size={20} />
          <div>
            <strong>Invoices</strong>
            <p className="muted small">View and send invoices</p>
          </div>
        </Link>
        <Link to="/app/expenses" className="phase0-bridge-card card">
          <Receipt size={20} />
          <div>
            <strong>Expenses</strong>
            <p className="muted small">Job costs and overhead</p>
          </div>
        </Link>
        <Link to="/app/vendors" className="phase0-bridge-card card">
          <Store size={20} />
          <div>
            <strong>Suppliers</strong>
            <p className="muted small">From expense vendors</p>
          </div>
        </Link>
      </div>
    </div>
  )
}
