import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import TenantsPage from './pages/TenantsPage'
import UsersPage from './pages/UsersPage'
import BuildsPage from './pages/BuildsPage'
import TopNav from './components/TopNav'

const queryClient = new QueryClient()

function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0D0D0D' }}>
      <TopNav />
      <main style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto' }}>{children}</main>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { setChecking(false); return }
      const { data: profile } = await supabase.from('profiles').select('is_super_admin').eq('user_id', data.session.user.id).single()
      setAllowed(!!profile?.is_super_admin)
      setChecking(false)
    })
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
          <Route path='/builds' element={<ProtectedRoute><AdminLayout><BuildsPage /></AdminLayout></ProtectedRoute>} />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
