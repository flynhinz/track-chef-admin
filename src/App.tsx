import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import TenantsPage from './pages/TenantsPage'
import UsersPage from './pages/UsersPage'
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<LoginPage />} />
          <Route path='/dashboard' element={<ProtectedRoute><AdminLayout><DashboardPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/tenants' element={<ProtectedRoute><AdminLayout><TenantsPage /></AdminLayout></ProtectedRoute>} />
          <Route path='/users' element={<ProtectedRoute><AdminLayout><UsersPage /></AdminLayout></ProtectedRoute>} />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
