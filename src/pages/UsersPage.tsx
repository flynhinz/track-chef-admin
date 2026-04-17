import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'
import { useSearchParams } from 'react-router-dom'

interface User { id: string; email: string; display_name: string; personas: string[]; created_at: string; tenant_id: string | null; is_super_admin: boolean; must_reset_password?: boolean; tenants?: { name: string } }
interface Tenant { id: string; name: string }

const input = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none' } as const
const btn = { background: '#DC2626', border: 'none', color: '#F5F5F5', cursor: 'pointer', fontSize: 12, padding: '6px 14px', borderRadius: 4, fontWeight: 600 } as const
const btnGhost = { background: 'none', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: 'pointer', fontSize: 11, padding: '3px 10px', borderRadius: 4 } as const

const DEFAULT_PASSWORD = 'EG123456'

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [filtered, setFiltered] = useState<User[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchParams] = useSearchParams()
  const tenantFilter = searchParams.get('tenant')

  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ email: '', display_name: '', tenant_id: '', password: DEFAULT_PASSWORD, must_reset: true })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [resetFor, setResetFor] = useState<User | null>(null)
  const [resetPw, setResetPw] = useState(DEFAULT_PASSWORD)
  const [resetMustReset, setResetMustReset] = useState(true)

  const load = () => {
    setLoading(true)
    Promise.all([
      adminApi.getAllUsers(tenantFilter ?? undefined),
      adminApi.getAllTenants(),
    ]).then(([u, t]) => {
      setUsers(u ?? []); setFiltered(u ?? []); setTenants(t ?? []); setLoading(false)
    })
  }
  useEffect(() => { load() }, [tenantFilter])
  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(users.filter(u => u.email?.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q) || u.tenants?.name?.toLowerCase().includes(q)))
  }, [search, users])

  const deleteUser = async (id: string, email: string) => {
    if (!confirm(`Delete profile for ${email}?\n\nNote: You must also remove them from Supabase Auth manually.`)) return
    await adminApi.deleteProfile(id); load()
  }

  const createUser = async () => {
    if (!form.email || !form.password) { setCreateError('Email and password are required'); return }
    setCreating(true); setCreateError('')
    try {
      await adminApi.createUser({
        email: form.email.trim(),
        display_name: form.display_name.trim(),
        tenant_id: form.tenant_id || null,
        password: form.password,
        must_reset: form.must_reset,
      })
      setForm({ email: '', display_name: '', tenant_id: '', password: DEFAULT_PASSWORD, must_reset: true })
      setShowNew(false); load()
    } catch (e: any) {
      setCreateError(e?.message ?? String(e))
    } finally { setCreating(false) }
  }

  const doReset = async () => {
    if (!resetFor || !resetPw) return
    if (!confirm(`Reset password for ${resetFor.email}?`)) return
    try {
      await adminApi.resetPassword({ user_id: resetFor.id, password: resetPw, must_reset: resetMustReset })
      setResetFor(null); setResetPw(DEFAULT_PASSWORD); setResetMustReset(true); load()
    } catch (e: any) { alert(`Reset failed: ${e?.message ?? e}`) }
  }

  const th = (label: string) => <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>{label}</th>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Users</h1>
        <button onClick={() => setShowNew(v => !v)} style={btn}>{showNew ? 'Cancel' : '+ New User'}</button>
      </div>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>{filtered.length} users {tenantFilter ? 'in this tenant' : 'across all tenants'}</p>

      {showNew && (
        <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
            <div><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Email</div><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={{ ...input, width: '100%' }} /></div>
            <div><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Display Name</div><input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} style={{ ...input, width: '100%' }} /></div>
            <div><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Tenant</div>
              <select value={form.tenant_id} onChange={e => setForm({ ...form, tenant_id: e.target.value })} style={{ ...input, width: '100%' }}>
                <option value=''>— None —</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Default Password</div><input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} style={{ ...input, width: '100%', fontFamily: 'monospace' }} /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, cursor: 'pointer', fontSize: 13 }}>
            <input type='checkbox' checked={form.must_reset} onChange={e => setForm({ ...form, must_reset: e.target.checked })} style={{ accentColor: '#DC2626', width: 16, height: 16 }} />
            User must reset password on next login
            <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>(uncheck to leave the default password in place)</span>
          </label>
          {createError && <div style={{ color: '#DC2626', fontSize: 12, marginTop: 8 }}>{createError}</div>}
          <div style={{ marginTop: 16 }}><button onClick={createUser} disabled={creating} style={{ ...btn, opacity: creating ? 0.6 : 1 }}>{creating ? 'Creating...' : 'Create User'}</button></div>
        </div>
      )}

      {resetFor && (
        <div style={{ background: '#141414', border: '1px solid #DC262640', borderRadius: 8, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Reset password for <span style={{ color: '#DC2626' }}>{resetFor.email}</span></div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>New Password</div><input value={resetPw} onChange={e => setResetPw(e.target.value)} style={{ ...input, width: '100%', fontFamily: 'monospace' }} /></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', paddingBottom: 8 }}>
              <input type='checkbox' checked={resetMustReset} onChange={e => setResetMustReset(e.target.checked)} style={{ accentColor: '#DC2626', width: 16, height: 16 }} />
              User must reset on next login
            </label>
            <button onClick={doReset} style={btn}>Reset Password</button>
            <button onClick={() => setResetFor(null)} style={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      <input placeholder='Search by email, name or tenant...' value={search} onChange={e => setSearch(e.target.value)} style={{ ...input, width: 320, marginBottom: 16 }} />
      {loading ? <div style={{ color: '#888' }}>Loading...</div> : filtered.length === 0 ? <div style={{ color: '#888', padding: 40, textAlign: 'center' }}>No users found</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
          <thead><tr>{th('Email')}{th('Name')}{th('Tenant')}{th('Personas')}{th('Created')}{th('Actions')}</tr></thead>
          <tbody>{filtered.map(u => (
            <tr key={u.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
              <td style={{ padding: '10px 12px' }}>
                {u.email}
                {u.is_super_admin && <span style={{ marginLeft: 6, fontSize: 10, background: '#DC262620', color: '#DC2626', padding: '1px 6px', borderRadius: 3, border: '1px solid #DC262640' }}>ADMIN</span>}
                {u.must_reset_password && <span style={{ marginLeft: 6, fontSize: 10, background: '#F59E0B20', color: '#F59E0B', padding: '1px 6px', borderRadius: 3, border: '1px solid #F59E0B40' }}>MUST RESET</span>}
              </td>
              <td style={{ padding: '10px 12px', color: '#888' }}>{u.display_name || '—'}</td>
              <td style={{ padding: '10px 12px', color: '#888' }}>{u.tenants?.name || '—'}</td>
              <td style={{ padding: '10px 12px', color: '#888', fontSize: 11 }}>{(u.personas ?? []).join(', ') || '—'}</td>
              <td style={{ padding: '10px 12px', color: '#888' }}>{new Date(u.created_at).toLocaleDateString('en-NZ')}</td>
              <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                <button onClick={() => { setResetFor(u); setResetPw(DEFAULT_PASSWORD); setResetMustReset(true) }} style={btnGhost}>Reset PW</button>
                <button onClick={() => deleteUser(u.id, u.email)} style={{ ...btnGhost, borderColor: '#DC262650', color: '#DC2626' }}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
