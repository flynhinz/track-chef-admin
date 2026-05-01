import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from './lib/supabase'
// [BUG-292] Replaces the direct .from('profiles') RLS-gated check.
import { verifySuperAdmin } from './lib/adminApi'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import TenantsPage from './pages/TenantsPage'
import UsersPage from './pages/UsersPage'
import ContentPage from './pages/ContentPage'
import BuildsPage from './pages/BuildsPage'
import TelemetryPage from './pages/TelemetryPage'
import UsagePage from './pages/UsagePage'
import SqlPage from './pages/SqlPage'
import SeriesPage from './pages/SeriesPage'
import AnnouncementsPage from './pages/AnnouncementsPage'
import DebugConsolePage from './pages/DebugConsolePage'
// [EPIC-211] Series Seeder — Speedhive discovery + staging + import.
import SeriesSeederNewJobPage from './pages/series-seeder/SeriesSeederNewJobPage'
import SeriesSeederStatusPage from './pages/series-seeder/SeriesSeederStatusPage'
import SeriesSeederReviewPage from './pages/series-seeder/SeriesSeederReviewPage'
import SeriesSeederCompletePage from './pages/series-seeder/SeriesSeederCompletePage'
// [EPIC-240] Cleanup wizard — Steps 6/7/8 (round numbers, classes, names).
import CleanupHomePage from './pages/cleanup/CleanupHomePage'
import RoundNumbersPage from './pages/cleanup/RoundNumbersPage'
import SeriesClassesPage from './pages/cleanup/SeriesClassesPage'
import EventNamesPage from './pages/cleanup/EventNamesPage'
import TopNav from './components/TopNav'
import BuildInfo from './components/BuildInfo'

const queryClient = new QueryClient()

function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0D0D0D', display: 'flex', flexDirection: 'column' }}>
      <TopNav />
      <main style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto', width: '100%', flex: 1 }}>{children}</main>
      <footer style={{ borderTop: '1px solid #1A1A1A', padding: '10px 32px', textAlign: 'center' }}>
        <BuildInfo />
      </footer>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      if (!data.session) { setChecking(false); return }
      // [BUG-292] Route via admin-query EF (service role) instead of a
      // direct profiles query (anon client, RLS-gated).
      const ok = await verifySuperAdmin()
      if (cancelled) return
      setAllowed(ok)
      setChecking(false)
    })
    return () => { cancelled = true }
  }, [])
  if (checking) return <div style={{ padding: 40, color: '#888' }}>Checking access...</div>
  if (!allowed) return <Navigate to='/' replace />
  return <>{children}</>
}

// SQL console keeps its own is_super_admin check so it stays gated even if ProtectedRoute is ever loosened.
function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      if (!data.session) { setChecking(false); return }
      // [BUG-292] Route via admin-query EF (service role).
      const ok = await verifySuperAdmin()
      if (cancelled) return
      setAllowed(ok)
      setChecking(false)
    })
    return () => { cancelled = true }
  }, [])
  if (checking) return <div style={{ padding: 40, color: '#888' }}>Checking access...</div>
  if (!allowed) return <Navigate to='/' replace />
  return <>{children}</>
}

function ConfigError() {
  return (
    <div style={{ minHeight: '100vh', background: '#0D0D0D', color: '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24 }}>
      <div style={{ background: '#141414', border: '1px solid #DC262640', borderRadius: 8, padding: 32, maxWidth: 480 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', marginBottom: 12 }}>Configuration error</div>
        <p style={{ fontSize: 14, color: '#F5F5F5', marginBottom: 12 }}>The admin portal cannot start because required environment variables are missing.</p>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>Set the following in your deployment platform's environment variables and redeploy:</p>
        <ul style={{ fontSize: 12, color: '#F5F5F5', fontFamily: 'monospace', paddingLeft: 20, lineHeight: 1.8 }}>
          <li>VITE_SUPABASE_URL</li>
          <li>VITE_SUPABASE_ANON_KEY</li>
          <li>VITE_SUPABASE_ADMIN_FUNCTION_URL</li>
        </ul>
      </div>
    </div>
  )
}

export default function App() {
  if (!supabaseConfigured) return <ConfigError />
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<LoginPage />} />
          <Route path='/dashboard' element={<ProtectedRoute><AdminLayout><DashboardPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/tenants' element={<ProtectedRoute><AdminLayout><TenantsPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/users' element={<ProtectedRoute><AdminLayout><UsersPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/content' element={<ProtectedRoute><AdminLayout><ContentPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/series' element={<ProtectedRoute><AdminLayout><SeriesPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/announcements' element={<ProtectedRoute><AdminLayout><AnnouncementsPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/builds' element={<ProtectedRoute><AdminLayout><BuildsPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/telemetry' element={<ProtectedRoute><AdminLayout><TelemetryPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/usage' element={<ProtectedRoute><AdminLayout><UsagePage /></AdminLayout></ProtectedRoute>} />
          <Route path='/sql' element={<SuperAdminRoute><AdminLayout><SqlPage /></AdminLayout></SuperAdminRoute>} />
          <Route path='/debug' element={<SuperAdminRoute><AdminLayout><DebugConsolePage /></AdminLayout></SuperAdminRoute>} />
          {/* [EPIC-211] Series Seeder — writes prod data, gated on SuperAdminRoute. */}
          {/* [EPIC-240] Cleanup wizard — gated to super admin since it
              writes to events / series_classes across all tenants. */}
          <Route path='/cleanup' element={<SuperAdminRoute><AdminLayout><CleanupHomePage /></AdminLayout></SuperAdminRoute>} />
          <Route path='/cleanup/round-numbers' element={<SuperAdminRoute><AdminLayout><RoundNumbersPage /></AdminLayout></SuperAdminRoute>} />
          <Route path='/cleanup/series-classes' element={<SuperAdminRoute><AdminLayout><SeriesClassesPage /></AdminLayout></SuperAdminRoute>} />
          <Route path='/cleanup/event-names' element={<SuperAdminRoute><AdminLayout><EventNamesPage /></AdminLayout></SuperAdminRoute>} />
          <Route path='/series-seeder' element={<SuperAdminRoute><AdminLayout><SeriesSeederNewJobPage /></AdminLayout></SuperAdminRoute>} />
          <Route path='/series-seeder/:jobId' element={<SuperAdminRoute><AdminLayout><SeriesSeederStatusPage /></AdminLayout></SuperAdminRoute>} />
          <Route path='/series-seeder/:jobId/review' element={<SuperAdminRoute><AdminLayout><SeriesSeederReviewPage /></AdminLayout></SuperAdminRoute>} />
          <Route path='/series-seeder/:jobId/complete' element={<SuperAdminRoute><AdminLayout><SeriesSeederCompletePage /></AdminLayout></SuperAdminRoute>} />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
