import { useEffect, useMemo, useState } from 'react'
import { adminApi, type Build } from '../lib/adminApi'
import EnvironmentPanel from '../components/EnvironmentPanel'
import { APP_VERSION, COMMIT_HASH } from '../lib/buildInfo'

interface Signup { id: string; email: string; display_name: string; created_at: string; tenants?: { name: string } }

// [BUG-317 #3] Signups search + sortable columns.
type SignupField = 'email' | 'display_name' | 'tenant' | 'created_at'
type SortDir = 'asc' | 'desc'

function sortSignups(rows: Signup[], field: SignupField, dir: SortDir): Signup[] {
  const mul = dir === 'asc' ? 1 : -1
  const val = (r: Signup, f: SignupField): string | number => {
    if (f === 'created_at') return new Date(r.created_at).getTime()
    if (f === 'tenant') return (r.tenants?.name ?? '').toLowerCase()
    return (r[f] ?? '').toLowerCase()
  }
  return [...rows].sort((a, b) => {
    const va = val(a, field); const vb = val(b, field)
    if (va < vb) return -1 * mul
    if (va > vb) return 1 * mul
    return 0
  })
}

function filterSignups(rows: Signup[], q: string): Signup[] {
  const n = q.trim().toLowerCase()
  if (!n) return rows
  return rows.filter((r) =>
    [r.email, r.display_name, r.tenants?.name]
      .filter((v): v is string => !!v)
      .some((v) => v.toLowerCase().includes(n)),
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ tenants: 0, users: 0 })
  const [allUsers, setAllUsers] = useState<Signup[]>([])
  const [recentBuilds, setRecentBuilds] = useState<Build[]>([])
  const [loading, setLoading] = useState(true)

  // [BUG-317 #3] Signups panel state: search + sort.
  const [signupSearch, setSignupSearch] = useState('')
  const [signupSortField, setSignupSortField] = useState<SignupField>('created_at')
  const [signupSortDir, setSignupSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    Promise.all([adminApi.getAllTenants(), adminApi.getAllUsers(), adminApi.listBuilds().catch(() => [])]).then(([tenants, users, builds]) => {
      setStats({ tenants: tenants?.length ?? 0, users: users?.length ?? 0 })
      setAllUsers((users ?? []) as Signup[])
      const sortedBuilds = [...(builds ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setRecentBuilds(sortedBuilds.slice(0, 3))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const visibleSignups = useMemo(
    () => sortSignups(filterSignups(allUsers, signupSearch), signupSortField, signupSortDir),
    [allUsers, signupSearch, signupSortField, signupSortDir],
  )
  // When no search, cap at 20 so the dashboard stays compact.
  const displayedSignups = signupSearch.trim() ? visibleSignups : visibleSignups.slice(0, 20)

  const toggleSignupSort = (f: SignupField) => {
    if (signupSortField === f) setSignupSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSignupSortField(f); setSignupSortDir(f === 'created_at' ? 'desc' : 'asc') }
  }
  const stat = (label: string, value: number, color = '#DC2626') => (
    <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 24, minWidth: 160 }}>
      <div style={{ fontSize: 36, fontWeight: 700, color, fontFamily: 'monospace' }}>{loading ? '...' : value}</div>
      <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{label}</div>
    </div>
  )
  const th = (label: string) => <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>{label}</th>
  const statusColor = (s: Build['status']) => s === 'verified' ? '#16A34A' : s === 'rejected' ? '#DC2626' : s === 'testing' ? '#D97706' : '#888'
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Platform Dashboard</h1>
      <p style={{ color: '#888', fontSize: 12, marginBottom: 4, fontFamily: 'monospace' }}>Track-Chef Admin · v{APP_VERSION} · commit {COMMIT_HASH}</p>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 32 }}>Track-Chef platform overview</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 40 }}>{stat('Total Tenants', stats.tenants)}{stat('Total Users', stats.users, '#F5F5F5')}</div>
      <div style={{ marginBottom: 32 }}><EnvironmentPanel /></div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>What's Deployed</h2>
      <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, overflow: 'hidden', marginBottom: 32 }}>
        {loading ? <div style={{ padding: 24, color: '#888', fontSize: 13 }}>Loading...</div> : recentBuilds.length === 0 ? <div style={{ padding: 24, color: '#888', fontSize: 13 }}>No builds recorded</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
            <thead><tr>{th('Build')}{th('Title')}{th('Status')}{th('Created')}</tr></thead>
            <tbody>{recentBuilds.map(b => (
              <tr key={b.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
                <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#F5F5F5' }}>{b.build_ref}</td>
                <td style={{ padding: '10px 12px', color: '#F5F5F5' }}>{b.title}</td>
                <td style={{ padding: '10px 12px', color: statusColor(b.status), fontWeight: 600, textTransform: 'uppercase', fontSize: 11 }}>{b.status}</td>
                <td style={{ padding: '10px 12px', color: '#888' }}>{new Date(b.created_at).toLocaleString('en-NZ')}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Recent Signups</h2>

      {/* [BUG-317 #3] Search + sortable columns. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <input
          placeholder='Search email, name, tenant…'
          value={signupSearch}
          onChange={(e) => setSignupSearch(e.target.value)}
          style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '6px 10px', color: '#F5F5F5', fontSize: 12, outline: 'none', width: 300 }}
          data-testid='signups-search'
        />
        <span style={{ fontSize: 11, color: '#888' }}>
          {loading ? 'Loading…' : signupSearch.trim() ? `${visibleSignups.length} match` : `Latest ${Math.min(20, allUsers.length)} of ${allUsers.length}`}
        </span>
      </div>

      <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 24, color: '#888', fontSize: 13 }}>Loading...</div>
        ) : displayedSignups.length === 0 ? (
          <div style={{ padding: 24, color: '#888', fontSize: 13 }}>
            {allUsers.length === 0 ? 'No signups yet' : 'No signups match the current search'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }} data-testid='signups-table'>
            <thead>
              <tr>
                {sortableTh('Email',  'email',        signupSortField, signupSortDir, toggleSignupSort)}
                {sortableTh('Name',   'display_name', signupSortField, signupSortDir, toggleSignupSort)}
                {sortableTh('Tenant', 'tenant',       signupSortField, signupSortDir, toggleSignupSort)}
                {sortableTh('Joined', 'created_at',   signupSortField, signupSortDir, toggleSignupSort)}
              </tr>
            </thead>
            <tbody>{displayedSignups.map(u => (
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

// Shared sortable header — click to toggle asc/desc.
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
