import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'

export default function DashboardPage() {
  const [stats, setStats] = useState({ tenants: 0, users: 0 })
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    Promise.all([adminApi.getAllTenants(), adminApi.getAllUsers()]).then(([tenants, users]) => {
      setStats({ tenants: tenants?.length ?? 0, users: users?.length ?? 0 })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])
  const stat = (label: string, value: number, color = '#DC2626') => (
    <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 24, minWidth: 160 }}>
      <div style={{ fontSize: 36, fontWeight: 700, color, fontFamily: 'monospace' }}>{loading ? '...' : value}</div>
      <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{label}</div>
    </div>
  )
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Platform Dashboard</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 32 }}>i6MM Dev Labs — Track-Chef platform overview</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>{stat('Total Tenants', stats.tenants)}{stat('Total Users', stats.users, '#F5F5F5')}</div>
    </div>
  )
}
