// [BUG-317 #4] Combined Tenants + Users view.
// Tenants list with expandable rows that reveal the users in that tenant
// inline. Both levels get search + sortable columns. Replaces the old
// separate /tenants + /users pages; UsersPage is kept for the
// ?tenant=<id> deep-link case from other surfaces.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../lib/adminApi'

interface Tenant { id: string; name: string; created_at: string; user_count: number }
interface User {
  id: string
  email: string
  display_name: string
  personas: string[] | null
  created_at: string
  tenant_id: string | null
  is_super_admin: boolean
  must_reset_password?: boolean
}

type SortDir = 'asc' | 'desc'
type TenantField = 'name' | 'user_count' | 'created_at'
type UserField = 'email' | 'display_name' | 'created_at' | 'personas'

function cmp(a: string | number, b: string | number, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1
  if (a < b) return -1 * mul
  if (a > b) return 1 * mul
  return 0
}

function sortTenants(rows: Tenant[], field: TenantField, dir: SortDir): Tenant[] {
  const val = (t: Tenant): string | number =>
    field === 'created_at' ? new Date(t.created_at).getTime() :
    field === 'user_count' ? (t.user_count ?? 0) :
    (t.name ?? '').toLowerCase()
  return [...rows].sort((a, b) => cmp(val(a), val(b), dir))
}

function filterTenants(rows: Tenant[], q: string): Tenant[] {
  const n = q.trim().toLowerCase()
  if (!n) return rows
  return rows.filter((t) => (t.name ?? '').toLowerCase().includes(n))
}

function sortUsers(rows: User[], field: UserField, dir: SortDir): User[] {
  const val = (u: User): string | number => {
    if (field === 'created_at') return new Date(u.created_at).getTime()
    if (field === 'personas') return (u.personas ?? []).join(', ').toLowerCase()
    return (u[field] ?? '').toLowerCase()
  }
  return [...rows].sort((a, b) => cmp(val(a), val(b), dir))
}

function filterUsers(rows: User[], q: string): User[] {
  const n = q.trim().toLowerCase()
  if (!n) return rows
  return rows.filter((u) =>
    [u.email, u.display_name, ...(u.personas ?? [])]
      .filter((v): v is string => !!v)
      .some((v) => v.toLowerCase().includes(n)),
  )
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)

  const [tenantSearch, setTenantSearch] = useState('')
  const [tenantSortField, setTenantSortField] = useState<TenantField>('name')
  const [tenantSortDir, setTenantSortDir] = useState<SortDir>('asc')

  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Users cached per tenant so expanding → collapsing → re-expanding doesn't refetch.
  const [usersByTenant, setUsersByTenant] = useState<Record<string, User[]>>({})
  const [usersLoading, setUsersLoading] = useState<Record<string, boolean>>({})
  const [userSearch, setUserSearch] = useState('')
  const [userSortField, setUserSortField] = useState<UserField>('email')
  const [userSortDir, setUserSortDir] = useState<SortDir>('asc')

  const loadTenants = () => {
    setLoading(true)
    adminApi.getAllTenants().then((data) => {
      setTenants(data ?? [])
      setLoading(false)
    })
  }
  useEffect(() => { loadTenants() }, [])

  const loadUsersForTenant = (tenantId: string) => {
    if (usersByTenant[tenantId] || usersLoading[tenantId]) return
    setUsersLoading((s) => ({ ...s, [tenantId]: true }))
    adminApi.getAllUsers(tenantId)
      .then((data) => {
        setUsersByTenant((m) => ({ ...m, [tenantId]: (data ?? []) as User[] }))
      })
      .finally(() => setUsersLoading((s) => ({ ...s, [tenantId]: false })))
  }

  const toggleExpand = (tenantId: string) => {
    setUserSearch('')
    if (expandedId === tenantId) {
      setExpandedId(null)
    } else {
      setExpandedId(tenantId)
      loadUsersForTenant(tenantId)
    }
  }

  const deleteTenant = async (id: string, name: string) => {
    if (!confirm(`Delete tenant "${name}" and all its data? This cannot be undone.`)) return
    await adminApi.deleteTenant(id)
    setUsersByTenant((m) => { const n = { ...m }; delete n[id]; return n })
    loadTenants()
  }

  const toggleTenantSort = (f: TenantField) => {
    if (tenantSortField === f) setTenantSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setTenantSortField(f); setTenantSortDir(f === 'user_count' || f === 'created_at' ? 'desc' : 'asc') }
  }
  const toggleUserSort = (f: UserField) => {
    if (userSortField === f) setUserSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setUserSortField(f); setUserSortDir(f === 'created_at' ? 'desc' : 'asc') }
  }

  const visibleTenants = useMemo(
    () => sortTenants(filterTenants(tenants, tenantSearch), tenantSortField, tenantSortDir),
    [tenants, tenantSearch, tenantSortField, tenantSortDir],
  )

  const input = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none' } as const
  const btnGhost = { background: 'none', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: 'pointer', fontSize: 11, padding: '3px 10px', borderRadius: 4 } as const

  return (
    <div data-testid='tenants-page'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Tenants & Users</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        {tenants.length} tenants across the platform. Click a row to expand its users.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <input
          placeholder='Search tenants…'
          value={tenantSearch}
          onChange={(e) => setTenantSearch(e.target.value)}
          style={{ ...input, width: 280 }}
          data-testid='tenants-search'
        />
        <span style={{ fontSize: 12, color: '#888' }}>
          {loading ? 'Loading…' : `${visibleTenants.length} of ${tenants.length}`}
        </span>
      </div>

      {loading ? (
        <div style={{ color: '#888' }}>Loading...</div>
      ) : visibleTenants.length === 0 ? (
        <div style={{ color: '#888', padding: 40, textAlign: 'center' }}>
          {tenants.length === 0 ? 'No tenants found' : 'No tenants match the current search'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-testid='tenants-table'>
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              {sortableTh('Name',    'name',       tenantSortField, tenantSortDir, toggleTenantSort)}
              {sortableTh('Users',   'user_count', tenantSortField, tenantSortDir, toggleTenantSort)}
              {sortableTh('Created', 'created_at', tenantSortField, tenantSortDir, toggleTenantSort)}
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleTenants.map((t) => {
              const expanded = expandedId === t.id
              const users = usersByTenant[t.id] ?? []
              const visibleUsers = sortUsers(filterUsers(users, userSearch), userSortField, userSortDir)
              return (
                <>
                  <tr
                    key={t.id}
                    onClick={() => toggleExpand(t.id)}
                    style={{ borderBottom: '1px solid #1A1A1A', cursor: 'pointer', background: expanded ? '#1A1A1A' : 'transparent' }}
                    data-testid={`tenant-row-${t.id}`}
                  >
                    <td style={{ padding: '10px 12px', color: '#888' }}>{expanded ? '▾' : '▸'}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{t.name}</td>
                    <td style={{ padding: '10px 12px', color: '#DC2626', fontWeight: 600 }}>{t.user_count}</td>
                    <td style={{ padding: '10px 12px', color: '#888' }}>{new Date(t.created_at).toLocaleDateString('en-NZ')}</td>
                    <td style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => deleteTenant(t.id, t.name)}
                        style={{ ...btnGhost, borderColor: '#DC262650', color: '#DC2626' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={`${t.id}-users`} data-testid={`tenant-users-${t.id}`}>
                      <td />
                      <td colSpan={4} style={{ padding: '0 12px 16px' }}>
                        <div style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 6, padding: 12 }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                            <input
                              placeholder='Search users in this tenant…'
                              value={userSearch}
                              onChange={(e) => setUserSearch(e.target.value)}
                              style={{ ...input, width: 280 }}
                              data-testid='tenant-users-search'
                            />
                            <span style={{ fontSize: 11, color: '#888' }}>
                              {usersLoading[t.id] ? 'Loading…' : `${visibleUsers.length} of ${users.length}`}
                            </span>
                          </div>

                          {usersLoading[t.id] ? (
                            <div style={{ color: '#888', fontSize: 12, padding: 16 }}>Loading users…</div>
                          ) : users.length === 0 ? (
                            <div style={{ color: '#888', fontSize: 12, padding: 16 }}>
                              No users in this tenant.
                            </div>
                          ) : visibleUsers.length === 0 ? (
                            <div style={{ color: '#888', fontSize: 12, padding: 16 }}>
                              No users match the search.
                            </div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr>
                                  {sortableTh('Email',    'email',        userSortField, userSortDir, toggleUserSort)}
                                  {sortableTh('Name',     'display_name', userSortField, userSortDir, toggleUserSort)}
                                  {sortableTh('Personas', 'personas',     userSortField, userSortDir, toggleUserSort)}
                                  {sortableTh('Joined',   'created_at',   userSortField, userSortDir, toggleUserSort)}
                                </tr>
                              </thead>
                              <tbody>
                                {visibleUsers.map((u) => (
                                  <tr key={u.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
                                    <td style={{ padding: '6px 12px' }}>
                                      {u.email}
                                      {u.is_super_admin && (
                                        <span style={{ marginLeft: 6, fontSize: 9, background: '#DC262620', color: '#DC2626', padding: '1px 6px', borderRadius: 3, border: '1px solid #DC262640' }}>
                                          ADMIN
                                        </span>
                                      )}
                                    </td>
                                    <td style={{ padding: '6px 12px', color: '#888' }}>{u.display_name || '—'}</td>
                                    <td style={{ padding: '6px 12px', color: '#888', fontSize: 11 }}>
                                      {(u.personas ?? []).join(', ') || '—'}
                                    </td>
                                    <td style={{ padding: '6px 12px', color: '#888' }}>
                                      {new Date(u.created_at).toLocaleDateString('en-NZ')}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function sortableTh<F extends string>(
  label: string,
  field: F,
  current: F,
  dir: SortDir,
  toggle: (f: F) => void,
) {
  const active = current === field
  return (
    <th
      key={field}
      onClick={() => toggle(field)}
      data-testid={`sort-${field}`}
      style={{
        textAlign: 'left',
        padding: '8px 12px',
        color: active ? '#F5F5F5' : '#888',
        fontWeight: 500,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        borderBottom: '1px solid #2A2A2A',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {label}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )
}
