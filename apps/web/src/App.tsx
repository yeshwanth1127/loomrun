import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { AppShell } from './components/AppShell'
import { CEODashboardPage } from './pages/CEODashboardPage'
import { LeadsPage } from './pages/LeadsPage'
import { LoginPage } from './pages/LoginPage'
import { ProductionPage } from './pages/ProductionPage'
import { QuotationsPage } from './pages/QuotationsPage'
import { RegisterPage } from './pages/RegisterPage'
import { RegisterSuperAdminPage } from './pages/RegisterSuperAdminPage'
import { TeamPage } from './pages/TeamPage'
import { TelecallerPage } from './pages/TelecallerPage'
import { WhatsAppPage } from './pages/WhatsAppPage'
import { AdminPage } from './pages/AdminPage'
import { BrandAssetsPage } from './pages/BrandAssetsPage'

function Home() {
  const { me, loading } = useAuth()
  if (loading) return <p className="center muted">Loading…</p>
  if (me) {
    if (me.is_super_admin && me.organizations.length === 0) {
      return <Navigate to="/app/admin" replace />
    }
    return <Navigate to="/app/leads" replace />
  }
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register-super-admin" element={<RegisterSuperAdminPage />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="leads" replace />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="quotations" element={<QuotationsPage />} />
        <Route path="production" element={<ProductionPage />} />
        <Route path="telecaller" element={<TelecallerPage />} />
        <Route path="whatsapp" element={<WhatsAppPage />} />
        <Route path="ceo" element={<CEODashboardPage />} />
        <Route path="brand-assets" element={<BrandAssetsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
