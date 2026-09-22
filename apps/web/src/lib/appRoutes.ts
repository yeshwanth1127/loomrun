/**
 * Single source of truth for where the simplified UI sends people.
 *
 * The refresh lands one module at a time, so a target points at the legacy surface
 * until that module's phase ships, then flips here. Callers (Home cards, quick
 * actions, cross-links) always go through this module so repointing is one edit.
 */

export type SalesView = 'all' | 'new' | 'follow-ups' | 'quoted' | 'won' | 'lost' | 'calling'
export type OrderTab = 'overview' | 'design' | 'production' | 'shipping' | 'money'
export type OrdersFilter = 'active' | 'delayed' | 'on_hold' | 'shipped' | 'completed' | 'all'
export type MoneyTab = 'invoices' | 'expenses' | 'suppliers' | 'quotations'
export type SettingsSection =
  'connections' | 'whatsapp' | 'calling' | 'brand' | 'documents' | 'team' | 'usage' | 'plan'

export const routes = {
  home: '/app/home',
  /** Full analytics — kept whole; Home only surfaces a summary of it. */
  business: '/app/ceo',
  ai: '/app/ai',
  /** Same AI page, with the question already typed in. */
  askAi(prompt: string): string {
    return `/app/ai?ask=${encodeURIComponent(prompt)}`
  },

  // --- Sales ---
  sales(view: SalesView = 'all'): string {
    return view === 'all' ? '/app/sales' : `/app/sales?view=${view}`
  },
  lead(leadId: string, tab?: 'call' | 'quotes' | 'activity' | 'order'): string {
    return tab ? `/app/sales/${leadId}?tab=${tab}` : `/app/sales/${leadId}`
  },
  /** Pipeline creation, stages, routing rules. */
  salesOrganize: '/app/sales/organize',
  pipeline(pipelineId: string): string {
    return `/app/sales/organize/${pipelineId}`
  },
  /** Every quotation, for parity with the old Quotations page. */
  quotes: '/app/sales/quotes',
  quotationDoc(quotationId: string): string {
    return `/app/sales/quotes/${quotationId}`
  },
  moneyQuotationDoc(quotationId: string): string {
    return `/app/money/quotations/${quotationId}`
  },
  moneyInvoiceDoc(quotationId: string): string {
    return `/app/money/invoices/${quotationId}`
  },
  moneyQuotations(leadId?: string): string {
    return leadId
      ? `/app/money/quotations?leadId=${encodeURIComponent(leadId)}`
      : '/app/money/quotations'
  },
  moneyInvoices(leadId?: string): string {
    return leadId
      ? `/app/money/invoices?leadId=${encodeURIComponent(leadId)}`
      : '/app/money/invoices'
  },
  salesQuotes(leadId?: string): string {
    return leadId
      ? `/app/sales/quotes?leadId=${encodeURIComponent(leadId)}`
      : '/app/sales/quotes'
  },

  // --- Orders ---
  orders(filter: OrdersFilter = 'active'): string {
    return filter === 'active' ? '/app/orders' : `/app/orders?show=${filter}`
  },
  order(orderId: string, tab: OrderTab = 'overview'): string {
    return tab === 'overview' ? `/app/orders/${orderId}` : `/app/orders/${orderId}?tab=${tab}`
  },

  // --- Money ---
  money(tab: MoneyTab = 'invoices'): string {
    return `/app/money/${tab}`
  },

  // --- Settings ---
  settings(section: SettingsSection = 'connections'): string {
    return `/app/settings/${section}`
  },
}
