import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'

interface Signup { id: string; email: string; display_name: string; created_at: string; tenants?: { name: string } }

export default function DashboardPage() {
  const [stats, setStats] = useState({ tenants: 0, users: 0 })
  const [recent, setRecent] = useState<Signup[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    Promise.all([adminApi.getAllTenants(), adminApi.getAllUsers()]).then(([tenants, users]) => {
      setStats({ tenants: tenants?.length ?? 0, users: users?.length ?? 0 })
      const sorted = [...(users ?? [])].sort((a: Signup, b: Signup) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setRecent(sorted.slice(0, 10))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])
  const stat = (label: string, value: number, color = '#DC2626') => (
    <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 24, minWidth: 160 }}>
      <div style={{ fontSize: 36, fontWeight: 700, color, fontFamily: 'monospace' }}>{loading ? '...' : value}</div>
      <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{label}</div>
    </div>
  )
  const th = (label: string) => <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>{label}</th>
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Platform Dashboard</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 32 }}>Track-Chef platform overview</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 40 }}>{stat('Total Tenants', stats.tenants)}{stat('Total Users', stats.users, '#F5F5F5')}</div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Recent Signups</h2>
      <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 24, color: '#888', fontSize: 13 }}>Loading...</div> : recent.length === 0 ? <div style={{ padding: 24, color: '#888', fontSize: 13 }}>No signups yet</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
            <thead><tr>{th('Email')}{th('Name')}{th('Tenant')}{th('Joined')}</tr></thead>
            <tbody>{recent.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
                <td style={{ padding: '10px 12px' }}>{u.email}</td>
                <td style={{ padding: '10px 12px', color: '#888' }}>{u.display_name || '—'}</td>
                <td style={{ padding: '10px 12px', color: '#888' }}>{u.tenants?.name || '—'}</td>
                <td style={{ padding: '10px 12px', color: '#888' }}>{new Date(u.created_at).toLocaleString('en-NZ')}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}
