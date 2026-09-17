import { NavLink, Outlet } from 'react-router-dom'
import { routes } from '../../lib/appRoutes'

const TABS: Array<{ to: string; label: string; hint: string }> = [
  { to: routes.money('quotations'), label: 'Quotations', hint: 'Quotes sent to customers' },
  { to: routes.money('invoices'), label: 'Invoices', hint: 'What customers owe you' },
  { to: routes.money('expenses'), label: 'Costs', hint: 'What you spent' },
  { to: routes.money('suppliers'), label: 'Suppliers', hint: 'Who you pay' },
]

/**
 * One Money area over the existing quotation, invoice and expense screens.
 * Quotations here are the SAME records as Sales → Quotes / Lead → Quotes.
 */
export function MoneyPage() {
  return (
    <div className="money-shell">
      <nav className="money-tabs" aria-label="Money sections">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end
            className={({ isActive }) => `money-tab${isActive ? ' active' : ''}`}
          >
            <span>{t.label}</span>
            <span className="muted small">{t.hint}</span>
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
