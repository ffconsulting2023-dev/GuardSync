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
import PartnersPage from './pages/PartnersPage'
import EContractsPage from './pages/EContractsPage'
import SignContractPage from './pages/SignContractPage'
import RegisterPage from './pages/RegisterPage'
import SuperAdminPage from './pages/SuperAdminPage'
import SecurityReportsPage from './pages/SecurityReportsPage'
import GuardAppPage from './pages/guard/GuardAppPage'
import SettingsPage from './pages/SettingsPage'
import VehiclesPage from './pages/VehiclesPage'
import LoadingSpinner from './components/LoadingSpinner'

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
            path="/"
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
                    <Route path="partners/*" element={<PartnersPage />} />
                    <Route path="e-contracts/*" element={<EContractsPage />} />
                    <Route path="reports/*" element={<SecurityReportsPage />} />
                    <Route path="vehicles/*" element={<VehiclesPage />} />
                    <Route path="settings/*" element={<SettingsPage />} />
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
