import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthCtx, useAuthProvider } from './hooks/useAuth'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import GuardsPage from './pages/GuardsPage'
import SitesPage from './pages/SitesPage'
import ContractsPage from './pages/ContractsPage'
import SchedulePage from './pages/SchedulePage'
import AttendancePage from './pages/AttendancePage'
import InvoicesPage from './pages/InvoicesPage'
import DailyPayPage from './pages/DailyPayPage'
import ClientsPage from './pages/ClientsPage'
import ClientDetailPage from './pages/ClientDetailPage'
import PartnersPage from './pages/PartnersPage'
import EContractsPage from './pages/EContractsPage'
import SignContractPage from './pages/SignContractPage'
import RegisterPage from './pages/RegisterPage'
import SuperAdminPage from './pages/SuperAdminPage'
import SecurityReportsPage from './pages/SecurityReportsPage'
import GuardAppPage from './pages/guard/GuardAppPage'
import SettingsPage from './pages/SettingsPage'
import VehiclesPage from './pages/VehiclesPage'
import AutoReceiptPage from './pages/AutoReceiptPage'
import NotificationsPage from './pages/NotificationsPage'
import LoadingSpinner from './components/LoadingSpinner'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div className="p-8 text-red-600">
        <p className="font-bold text-lg">エラーが発生しました</p>
        <pre className="mt-2 text-sm bg-red-50 p-4 rounded whitespace-pre-wrap">{this.state.error}</pre>
        <button onClick={() => this.setState({ error: null })} className="mt-4 px-4 py-2 bg-red-600 text-white rounded">再試行</button>
      </div>
    )
    return this.props.children
  }
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthProvider()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const auth = useAuthProvider()

  return (
    <AuthCtx.Provider value={auth}>
      {auth.loading ? (
        <LoadingSpinner />
      ) : (
        <Routes>
          <Route path="/login" element={auth.user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/sign/:token" element={<SignContractPage />} />
          <Route path="/guard/*" element={auth.user ? <GuardAppPage /> : <Navigate to="/login" replace />} />
          <Route
            path="/*"
            element={
              auth.user ? (
                <Layout>
                  <Routes>
                    <Route index element={<DashboardPage />} />
                    <Route path="guards/*" element={<GuardsPage />} />
                    <Route path="sites/*" element={<SitesPage />} />
                    <Route path="contracts/*" element={<ContractsPage />} />
                    <Route path="schedule/*" element={<SchedulePage />} />
                    <Route path="attendance/*" element={<AttendancePage />} />
                    <Route path="invoices/*" element={<InvoicesPage />} />
                    <Route path="daily-pay/*" element={<DailyPayPage />} />
                    <Route path="clients" element={<ClientsPage />} />
                    <Route path="clients/:id" element={<ClientDetailPage />} />
                    <Route path="partners/*" element={<PartnersPage />} />
                    <Route path="e-contracts/*" element={<EContractsPage />} />
                    <Route path="reports/*" element={<SecurityReportsPage />} />
                    <Route path="vehicles/*" element={<VehiclesPage />} />
                    <Route path="auto-receipts/*" element={<AutoReceiptPage />} />
                    <Route path="notifications/*" element={<NotificationsPage />} />
                    <Route path="settings/*" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
                    <Route path="super-admin/*" element={<SuperAdminPage />} />
                  </Routes>
                </Layout>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
        </Routes>
      )}
    </AuthCtx.Provider>
  )
}
