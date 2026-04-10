import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const signIn = async () => {
    setLoading(true); setError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    const { data: profile } = await supabase.from('profiles').select('is_super_admin').eq('user_id', data.user.id).single()
    if (!profile?.is_super_admin) { await supabase.auth.signOut(); setError('Access denied. Authorised administrators only.'); setLoading(false); return }
    navigate('/dashboard')
  }

  const inputStyle = { width: '100%', background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 14, outline: 'none' }

  return (
    <div style={{ minHeight: '100vh', background: '#0D0D0D', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 40, width: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 36, height: 36, background: '#DC2626', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'white' }}>i6</div>
          <div><div style={{ fontWeight: 700, fontSize: 16 }}>i6MM Platform Admin</div><div style={{ fontSize: 11, color: '#888' }}>Track-Chef Administration</div></div>
        </div>
        <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 24, padding: '6px 10px', background: '#DC262610', borderRadius: 4, border: '1px solid #DC262630' }}>⚠ Authorised personnel only</div>
        {error && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 16, padding: '8px 12px', background: '#DC262610', borderRadius: 4 }}>{error}</div>}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Email</label>
          <input type='email' value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && signIn()} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Password</label>
          <input type='password' value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && signIn()} style={inputStyle} />
        </div>
        <button onClick={signIn} disabled={loading} style={{ width: '100%', background: '#DC2626', border: 'none', borderRadius: 4, padding: '10px', color: 'white', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>{loading ? 'Signing in...' : 'Sign In'}</button>
        <div style={{ marginTop: 16, textAlign: 'center' }}><a href='https://app.track-chef.com' style={{ fontSize: 12, color: '#888' }}>← Back to Track-Chef</a></div>
      </div>
    </div>
  )
}
