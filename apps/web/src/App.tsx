import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { AppShell } from './components/AppShell'
import { PlatformAdminShell } from './components/PlatformAdminShell'
import { EmployeeRouteGuard } from './components/EmployeeRouteGuard'
import { isTelecallerRole, membershipForOrg } from './lib/membership'
import { CEODashboardPage } from './pages/CEODashboardPage'
import { LandingPage } from './pages/LandingPage'
import { LeadsPage } from './pages/LeadsPage'
import { FollowUpsPage } from './pages/FollowUpsPage'
import { LeadConnectionsPage } from './pages/LeadConnectionsPage'
import { LoginPage } from './pages/LoginPage'
import { ProductionPage } from './pages/ProductionPage'
import { QuotationsPage } from './pages/QuotationsPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { RegisterPage } from './pages/RegisterPage'
import { RegisterSuperAdminPage } from './pages/RegisterSuperAdminPage'
import { TeamPage } from './pages/TeamPage'
import { TelecallerPage } from './pages/TelecallerPage'
import { TelephonyPage } from './pages/TelephonyPage'
import { WhatsAppPage } from './pages/WhatsAppPage'
import { AdminPage } from './pages/AdminPage'
import { BrandAssetsPage } from './pages/BrandAssetsPage'
import { DocumentTemplatesPage } from './pages/DocumentTemplatesPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { SubscriptionPage } from './pages/SubscriptionPage'
import { AiChatPage } from './pages/AiChatPage'

function Home() {
  const { me, loading, orgId } = useAuth()
  if (loading) return <p className="center muted">Loading…</p>
  if (me) {
    if (me.is_super_admin) {
      return <Navigate to="/platform" replace />
    }
    const membership = membershipForOrg(me, orgId)
    if (isTelecallerRole(membership)) {
      return <Navigate to="/app/telecaller" replace />
    }
    return <Navigate to="/app/leads" replace />
  }
  return <LandingPage />
}

function AppIndex() {
  const { me, orgId } = useAuth()
  const membership = membershipForOrg(me, orgId)
  if (isTelecallerRole(membership)) {
    return <Navigate to="telecaller" replace />
  }
  return <Navigate to="leads" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register-super-admin" element={<RegisterSuperAdminPage />} />

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
          <Route index element={<AppIndex />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="leads/follow-ups" element={<FollowUpsPage />} />
          <Route path="leads/connections" element={<LeadConnectionsPage />} />
          <Route path="quotations" element={<QuotationsPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="production" element={<ProductionPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="telecaller" element={<TelecallerPage />} />
          <Route path="settings/telephony" element={<TelephonyPage />} />
          <Route path="whatsapp" element={<WhatsAppPage />} />
          <Route path="ceo" element={<CEODashboardPage />} />
          <Route path="brand-assets" element={<BrandAssetsPage />} />
          <Route path="document-templates" element={<DocumentTemplatesPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="subscription" element={<SubscriptionPage />} />
          <Route path="ai" element={<AiChatPage />} />
          <Route path="admin" element={<Navigate to="/platform" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
