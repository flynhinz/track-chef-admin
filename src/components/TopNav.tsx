import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useEffect, useState } from 'react'

export default function TopNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  useEffect(() => { supabase.auth.getSession().then(({ data }) => { setEmail(data.session?.user?.email ?? '') }) }, [])
  const signOut = async () => { await supabase.auth.signOut(); navigate('/') }
  const navItem = (path: string, label: string) => (
    <button onClick={() => navigate(path)} style={{ background: 'none', border: 'none', color: location.pathname === path ? '#DC2626' : '#F5F5F5', cursor: 'pointer', fontSize: 14, padding: '4px 12px', borderBottom: location.pathname === path ? '2px solid #DC2626' : '2px solid transparent', fontWeight: location.pathname === path ? 600 : 400 }}>{label}</button>
  )
  return (
    <nav style={{ background: '#141414', borderBottom: '1px solid #2A2A2A', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, background: '#DC2626', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white' }}>TC</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Track-Chef Admin</span>
            <span style={{ fontSize: 10, color: '#888' }}>Motorsport Mastered</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {navItem('/dashboard', 'Dashboard')}
          {/* [BUG-317 #4] Tenants page now subsumes the old Users tab —
              tenants list with expandable rows that reveal users inline,
              both levels searchable + sortable. The /users route stays
              registered for deep-links from external links that still
              carry ?tenant=<id>. */}
          {navItem('/tenants', 'Tenants & Users')}
          {/* [BUG-293] Content = Rowena's Help Centre editor (persona_content_translations). */}
          {navItem('/content', 'Content')}
          {navItem('/series', 'Series')}
          {navItem('/announcements', 'Announcements')}
          {navItem('/builds', 'Builds')}
          {navItem('/telemetry', 'Telemetry')}
          {navItem('/usage', 'Usage')}
          {navItem('/sql', 'SQL')}
          {navItem('/debug', 'Debug')}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 12, color: '#888' }}>{email}</span>
        <button onClick={signOut} style={{ background: 'none', border: '1px solid #2A2A2A', color: '#888', cursor: 'pointer', fontSize: 12, padding: '4px 12px', borderRadius: 4 }}>Sign Out</button>
      </div>
    </nav>
  )
}
