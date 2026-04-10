import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'
import { useSearchParams } from 'react-router-dom'

interface User { id: string; email: string; display_name: string; personas: string[]; created_at: string; tenant_id: string; is_super_admin: boolean; tenants?: { name: string } }

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [filtered, setFiltered] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchParams] = useSearchParams()
  const tenantFilter = searchParams.get('tenant')

  const load = () => { setLoading(true); adminApi.getAllUsers(tenantFilter ?? undefined).then(data => { setUsers(data ?? []); setFiltered(data ?? []); setLoading(false) }) }
  useEffect(() => { load() }, [tenantFilter])
  useEffect(() => { const q = search.toLowerCase(); setFiltered(users.filter(u => u.email?.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q) || u.tenants?.name?.toLowerCase().includes(q))) }, [search, users])

  const deleteUser = async (id: string, email: string) => {
    if (!confirm(`Delete profile for ${email}?\n\nNote: You must also remove them from Supabase Auth manually.`)) return
    await adminApi.deleteProfile(id); load()
  }

  const th = (label: string) => <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>{label}</th>

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Users</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>{filtered.length} users {tenantFilter ? 'in this tenant' : 'across all tenants'}</p>
      <input placeholder='Search by email, name or tenant...' value={search} onChange={e => setSearch(e.target.value)} style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, width: 320, outline: 'none', marginBottom: 16 }} />
      {loading ? <div style={{ color: '#888' }}>Loading...</div> : filtered.length === 0 ? <div style={{ color: '#888', padding: 40, textAlign: 'center' }}>No users found</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
          <thead><tr>{th('Email')}{th('Name')}{th('Tenant')}{th('Personas')}{th('Created')}{th('Actions')}</tr></thead>
          <tbody>{filtered.map(u => (
            <tr key={u.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
              <td style={{ padding: '10px 12px' }}>{u.email}{u.is_super_admin && <span style={{ marginLeft: 6, fontSize: 10, background: '#DC262620', color: '#DC2626', padding: '1px 6px', borderRadius: 3, border: '1px solid #DC262640' }}>ADMIN</span>}</td>
              <td style={{ padding: '10px 12px', color: '#888' }}>{u.display_name || '—'}</td>
              <td style={{ padding: '10px 12px', color: '#888' }}>{u.tenants?.name || '—'}</td>
              <td style={{ padding: '10px 12px', color: '#888', fontSize: 11 }}>{(u.personas ?? []).join(', ') || '—'}</td>
              <td style={{ padding: '10px 12px', color: '#888' }}>{new Date(u.created_at).toLocaleDateString('en-NZ')}</td>
              <td style={{ padding: '10px 12px' }}><button onClick={() => deleteUser(u.id, u.email)} style={{ background: 'none', border: '1px solid #DC262650', color: '#DC2626', cursor: 'pointer', fontSize: 11, padding: '3px 10px', borderRadius: 4 }}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
