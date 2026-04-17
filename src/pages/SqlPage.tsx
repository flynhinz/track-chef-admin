import { useState } from 'react'
import { adminApi } from '../lib/adminApi'
import { needsConfirm, firstKeyword, parseBulkUsersCsv } from '../lib/sqlSafety'

type SqlResult =
  | { kind: 'rows'; rows: Record<string, unknown>[] }
  | { kind: 'command'; command: string; affected: number }
  | { kind: 'error'; error: string; sqlstate?: string }

const SNIPPETS: { label: string; sql: string }[] = [
  {
    label: 'List all tenants with user counts',
    sql: `select t.id, t.name, t.created_at, count(p.id) as user_count
from public.tenants t
left join public.profiles p on p.tenant_id = t.id
group by t.id, t.name, t.created_at
order by t.created_at desc;`,
  },
  {
    label: 'Recent signups (last 7 days)',
    sql: `select email, display_name, tenant_id, created_at
from public.profiles
where created_at > now() - interval '7 days'
order by created_at desc;`,
  },
  {
    label: 'Top telemetry events (last 7 days)',
    sql: `select event_name, count(*) as n
from public.app_events
where created_at > now() - interval '7 days'
group by event_name
order by n desc
limit 25;`,
  },
  {
    label: 'Force password reset on next login — single user',
    sql: `-- Replace the email, then run.
update public.profiles
set must_reset_password = true
where email = 'user@example.com';`,
  },
  {
    label: 'Promote user to super admin (by email)',
    sql: `update public.profiles
set is_super_admin = true
where email = 'user@example.com';`,
  },
  {
    label: 'Open builds with unconfirmed bugs',
    sql: `select b.build_ref, b.title, b.status,
  count(bug.*) filter (where not bug.fixed_confirmed) as unconfirmed,
  count(bug.*) as total
from public.admin_builds b
left join public.admin_build_bugs bug on bug.build_id = b.id
group by b.id
having count(bug.*) filter (where not bug.fixed_confirmed) > 0
order by b.created_at desc;`,
  },
]

export default function SqlPage() {
  const [sql, setSql] = useState('select id, name, created_at from public.tenants order by created_at desc limit 10;')
  const [result, setResult] = useState<SqlResult | null>(null)
  const [running, setRunning] = useState(false)
  const [bulkCsv, setBulkCsv] = useState('')
  const [bulkLog, setBulkLog] = useState<string[]>([])
  const [bulkRunning, setBulkRunning] = useState(false)

  const run = async () => {
    if (!sql.trim()) return
    if (needsConfirm(sql)) {
      if (!confirm(`This will run a mutating statement (${firstKeyword(sql)}). Continue?`)) return
    }
    setRunning(true); setResult(null)
    try { const r = await adminApi.runSql(sql); setResult(r as SqlResult) }
    catch (e: any) { setResult({ kind: 'error', error: e?.message ?? String(e) }) }
    finally { setRunning(false) }
  }

  const runBulk = async () => {
    const rows = parseBulkUsersCsv(bulkCsv)
    if (rows.length === 0) return
    if (!confirm(`Create ${rows.length} users? Each line should be: email,display_name,password,tenant_id_or_blank,must_reset(true/false)`)) return
    setBulkRunning(true); setBulkLog([])
    for (const r of rows) {
      try {
        await adminApi.createUser(r)
        setBulkLog(l => [...l, `✓ ${r.email}`])
      } catch (e: any) {
        setBulkLog(l => [...l, `✗ ${r.email} — ${e?.message ?? e}`])
      }
    }
    setBulkRunning(false)
  }

  const input = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '10px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none', fontFamily: 'monospace' } as const
  const btn = { background: '#DC2626', border: 'none', color: '#F5F5F5', cursor: 'pointer', fontSize: 13, padding: '8px 18px', borderRadius: 4, fontWeight: 600 } as const

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>SQL Console</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>Execute arbitrary SQL against the platform database. UPDATE / DELETE / DDL statements will ask for confirmation before running.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: '#888', alignSelf: 'center' }}>Snippets:</span>
        {SNIPPETS.map(s => (
          <button key={s.label} onClick={() => setSql(s.sql)} style={{ background: '#141414', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 4 }}>{s.label}</button>
        ))}
      </div>

      <textarea value={sql} onChange={e => setSql(e.target.value)} rows={10} style={{ ...input, width: '100%', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, marginBottom: 24 }}>
        <button onClick={run} disabled={running} style={{ ...btn, opacity: running ? 0.6 : 1 }}>{running ? 'Running...' : 'Run SQL'}</button>
        {needsConfirm(sql) && <span style={{ fontSize: 11, color: '#F59E0B' }}>⚠ Will require confirmation (mutating statement)</span>}
      </div>

      {result && (
        <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16, marginBottom: 40 }}>
          {result.kind === 'error' ? (
            <div>
              <div style={{ color: '#DC2626', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Error {result.sqlstate ? `(${result.sqlstate})` : ''}</div>
              <div style={{ color: '#F5F5F5', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{result.error}</div>
            </div>
          ) : result.kind === 'command' ? (
            <div style={{ color: '#22C55E', fontSize: 13 }}>✓ {result.command} — {result.affected} row(s) affected</div>
          ) : (
            <ResultTable rows={result.rows} />
          )}
        </div>
      )}

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Bulk Create Users</h2>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 10 }}>
        One user per line. Format: <code style={{ color: '#F5F5F5', fontFamily: 'monospace' }}>email,display_name,password,tenant_id_or_blank,must_reset(true|false)</code>.
        Calls the <code>create_user</code> Edge Function action for each row.
      </p>
      <textarea value={bulkCsv} onChange={e => setBulkCsv(e.target.value)} rows={6} placeholder={`alice@example.com,Alice Smith,EG123456,,true
bob@example.com,Bob Jones,EG123456,550e8400-e29b-41d4-a716-446655440000,false`} style={{ ...input, width: '100%', resize: 'vertical' }} />
      <div style={{ marginTop: 10 }}>
        <button onClick={runBulk} disabled={bulkRunning || !bulkCsv.trim()} style={{ ...btn, opacity: (bulkRunning || !bulkCsv.trim()) ? 0.6 : 1 }}>
          {bulkRunning ? 'Creating...' : `Create ${parseBulkUsersCsv(bulkCsv).length} users`}
        </button>
      </div>
      {bulkLog.length > 0 && (
        <div style={{ marginTop: 16, background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 14, fontFamily: 'monospace', fontSize: 12 }}>
          {bulkLog.map((l, i) => <div key={i} style={{ color: l.startsWith('✓') ? '#22C55E' : '#DC2626' }}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div style={{ color: '#888', fontSize: 13 }}>No rows returned.</div>
  const cols = Object.keys(rows[0])
  const th = { textAlign: 'left' as const, padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>{rows.length} row(s)</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{cols.map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 500).map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #1A1A1A' }}>
            {cols.map(c => {
              const v = r[c]
              const s = v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)
              return <td key={c} style={{ padding: '6px 12px', color: '#F5F5F5', fontFamily: 'monospace', fontSize: 11, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s}>{s}</td>
            })}
          </tr>
        ))}</tbody>
      </table>
      {rows.length > 500 && <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>Showing first 500 of {rows.length} rows.</div>}
    </div>
  )
}
