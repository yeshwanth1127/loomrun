import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { AppShell } from './components/AppShell'
import { PlatformAdminShell } from './components/PlatformAdminShell'
import { EmployeeRouteGuard } from './components/EmployeeRouteGuard'
import { SettingsLayout } from './components/SettingsLayout'
import { LandingPage } from './pages/LandingPage'
import { LeadConnectionsPage } from './pages/LeadConnectionsPage'
import { LoginPage } from './pages/LoginPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { RegisterPage } from './pages/RegisterPage'
import { RegisterSuperAdminPage } from './pages/RegisterSuperAdminPage'
import { TeamPage } from './pages/TeamPage'
import { TelephonyPage } from './pages/TelephonyPage'
import { WhatsAppPage } from './pages/WhatsAppPage'
import { AdminPage } from './pages/AdminPage'
import { BrandAssetsPage } from './pages/BrandAssetsPage'
import { DocumentTemplatesPage } from './pages/DocumentTemplatesPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { SubscriptionPage } from './pages/SubscriptionPage'
import { UsagePage } from './pages/UsagePage'
import { AiChatPage } from './pages/AiChatPage'
import { TrackOrderPage } from './pages/TrackOrderPage'
import { VendorsPage } from './pages/VendorsPage'
import { CEODashboardPage } from './pages/CEODashboardPage'
import { HomePage } from './pages/HomePage'
import { MyConnectionsPage } from './pages/MyConnectionsPage'
import { DocumentWorkspacePage } from './pages/DocumentWorkspacePage'
import { MoneyPage } from './pages/money/MoneyPage'
import { OrderWorkspacePage } from './pages/orders/OrderWorkspacePage'
import { OrdersPage } from './pages/orders/OrdersPage'
import { LeadDetailPage } from './pages/sales/LeadDetailPage'
import { SalesPage } from './pages/sales/SalesPage'
import {
  AllQuotesPage,
  OrganizePipelinesPage,
  PipelineDetailPage,
  PipelineRedirect,
  TelecallerRedirect,
} from './pages/sales/SalesSubPages'

function RootHome() {
  const { me, loading } = useAuth()
  if (loading) return <p className="center muted">Loading…</p>
  if (me) {
    if (me.is_super_admin && me.organizations.length === 0) {
      return <Navigate to="/platform" replace />
    }
    // Phase 0: always land on new Home bridge (role soft-embeds existing pages)
    return <Navigate to="/app/home" replace />
  }
  return <LandingPage />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootHome />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register-super-admin" element={<RegisterSuperAdminPage />} />
      <Route path="/track/:token" element={<TrackOrderPage />} />

      <Route path="/platform" element={<PlatformAdminShell />}>
        <Route index element={<AdminPage />} />
      </Route>

      <Route path="/app" element={<AppShell />}>
        <Route
          element={
            <EmployeeRouteGuard>
              <Outlet />
            </EmployeeRouteGuard>
          }
        >
          <Route index element={<Navigate to="/app/home" replace />} />

          <Route path="home" element={<HomePage />} />

          {/* Money — one area over the existing invoice and expense screens */}
          <Route path="money" element={<MoneyPage />}>
            <Route index element={<Navigate to="/app/money/quotations" replace />} />
            <Route path="quotations" element={<AllQuotesPage />} />
            <Route path="quotations/:quotationId" element={<DocumentWorkspacePage mode="quotation" backTo="/app/money/quotations" />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route
              path="invoices/:quotationId"
              element={<DocumentWorkspacePage mode="invoice" backTo="/app/money/invoices" />}
            />
            <Route path="expenses" element={<ExpensesPage />} />
            <Route path="suppliers" element={<VendorsPage />} />
          </Route>
          <Route path="my-connections" element={<MyConnectionsPage />} />
          <Route path="invoices" element={<Navigate to="/app/money/invoices" replace />} />
          <Route path="expenses" element={<Navigate to="/app/money/expenses" replace />} />
          <Route path="vendors" element={<Navigate to="/app/money/suppliers" replace />} />

          {/* Orders workspace */}
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:orderId" element={<OrderWorkspacePage />} />
          <Route path="production" element={<Navigate to="/app/orders" replace />} />

          {/* Sales workspace */}
          <Route path="sales" element={<SalesPage />} />
          <Route path="sales/organize" element={<OrganizePipelinesPage />} />
          <Route path="sales/organize/:pipelineId" element={<PipelineDetailPage />} />
          <Route path="sales/quotes" element={<AllQuotesPage />} />
          <Route
            path="sales/quotes/:quotationId"
            element={<DocumentWorkspacePage mode="quotation" backTo="/app/sales" />}
          />
          <Route path="sales/:leadId" element={<LeadDetailPage />} />

          {/* Retired Sales surfaces — redirect so old links and bookmarks still work */}
          <Route path="leads" element={<Navigate to="/app/sales" replace />} />
          <Route
            path="leads/follow-ups"
            element={<Navigate to="/app/sales?view=follow-ups" replace />}
          />
          <Route path="pipelines" element={<PipelineRedirect />} />
          <Route path="pipelines/:pipelineId" element={<PipelineRedirect />} />
          <Route path="quotations" element={<Navigate to="/app/sales/quotes" replace />} />
          <Route path="telecaller" element={<TelecallerRedirect />} />

          <Route path="ceo" element={<CEODashboardPage />} />
          <Route path="ai" element={<AiChatPage />} />
          <Route path="admin" element={<Navigate to="/platform" replace />} />

          {/* Settings — grouped under one path, shared inner nav */}
          <Route element={<SettingsLayout />}>
            <Route path="settings" element={<Navigate to="/app/settings/connections" replace />} />
            <Route path="settings/connections" element={<LeadConnectionsPage />} />
            <Route path="settings/whatsapp" element={<WhatsAppPage />} />
            <Route path="settings/calling" element={<TelephonyPage />} />
            <Route path="settings/brand" element={<BrandAssetsPage />} />
            <Route path="settings/documents" element={<DocumentTemplatesPage />} />
            <Route path="settings/team" element={<TeamPage />} />
            <Route path="settings/plan" element={<SubscriptionPage />} />
            <Route path="settings/usage" element={<UsagePage />} />

            {/*
              OAuth and WhatsApp callbacks return to /app/leads/connections with query
              params, so that URL keeps rendering the real page instead of redirecting.
            */}
            <Route path="leads/connections" element={<LeadConnectionsPage />} />
          </Route>

          {/* Retired settings URLs */}
          <Route
            path="settings/telephony"
            element={<Navigate to="/app/settings/calling" replace />}
          />
          <Route
            path="document-templates"
            element={<Navigate to="/app/settings/documents" replace />}
          />
          <Route path="brand-assets" element={<Navigate to="/app/settings/brand" replace />} />
          <Route path="team" element={<Navigate to="/app/settings/team" replace />} />
          <Route path="subscription" element={<Navigate to="/app/settings/plan" replace />} />
          <Route path="whatsapp" element={<Navigate to="/app/settings/whatsapp" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
