import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'
import { useNavigate } from 'react-router-dom'

interface Tenant { id: string; name: string; created_at: string; user_count: number }

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const load = () => { setLoading(true); adminApi.getAllTenants().then(data => { setTenants(data ?? []); setLoading(false) }) }
  useEffect(() => { load() }, [])
  const deleteTenant = async (id: string, name: string) => {
    if (!confirm(`Delete tenant "${name}" and all its data? This cannot be undone.`)) return
    await adminApi.deleteTenant(id); load()
  }
  const th = (label: string) => <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>{label}</th>
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Tenants</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 24 }}>{tenants.length} tenants on the platform</p>
      {loading ? <div style={{ color: '#888' }}>Loading...</div> : tenants.length === 0 ? <div style={{ color: '#888', padding: 40, textAlign: 'center' }}>No tenants found</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
          <thead><tr>{th('Name')}{th('ID')}{th('Users')}{th('Created')}{th('Actions')}</tr></thead>
          <tbody>{tenants.map(t => (
            <tr key={t.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
              <td style={{ padding: '10px 12px', fontWeight: 500 }}>{t.name}</td>
              <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{t.id.slice(0, 8)}...</td>
              <td style={{ padding: '10px 12px', color: '#DC2626', fontWeight: 600 }}>{t.user_count}</td>
              <td style={{ padding: '10px 12px', color: '#888' }}>{new Date(t.created_at).toLocaleDateString('en-NZ')}</td>
              <td style={{ padding: '10px 12px' }}>
                <button onClick={() => navigate(`/users?tenant=${t.id}`)} style={{ background: 'none', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: 'pointer', fontSize: 11, padding: '3px 10px', borderRadius: 4, marginRight: 6 }}>View Users</button>
                <button onClick={() => deleteTenant(t.id, t.name)} style={{ background: 'none', border: '1px solid #DC262650', color: '#DC2626', cursor: 'pointer', fontSize: 11, padding: '3px 10px', borderRadius: 4 }}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
