// [BUG-317] Admin Announcements tab — platform-wide round_communications view.
// Reads via admin-query EF's list_announcements action (super-admin gated).

import { useEffect, useMemo, useState } from 'react'
import { adminApi, type AdminAnnouncement } from '../lib/adminApi'

type SortField = 'created_at' | 'sent_at' | 'tenant_name' | 'event_name' | 'status' | 'sent_count'
type SortDir = 'asc' | 'desc'

const STATUS_STYLE: Record<string, { fg: string; bg: string; border: string }> = {
  sent:      { fg: '#22C55E', bg: '#22C55E20', border: '#22C55E40' },
  scheduled: { fg: '#3B82F6', bg: '#3B82F620', border: '#3B82F640' },
  draft:     { fg: '#888',    bg: '#2A2A2A',   border: '#2A2A2A'   },
  failed:    { fg: '#DC2626', bg: '#DC262620', border: '#DC262640' },
}

function statusPill(status: string | null) {
  const key = (status ?? 'draft').toLowerCase()
  const s = STATUS_STYLE[key] ?? STATUS_STYLE.draft
  return (
    <span style={{ fontSize: 10, color: s.fg, background: s.bg, border: `1px solid ${s.border}`, padding: '2px 8px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
      {key}
    </span>
  )
}

function sortRows(rows: AdminAnnouncement[], field: SortField, dir: SortDir): AdminAnnouncement[] {
  const mul = dir === 'asc' ? 1 : -1
  const val = (r: AdminAnnouncement, f: SortField): string | number => {
    if (f === 'sent_count') return r.sent_count ?? -1
    const v = r[f]
    if (v == null) return ''
    if (f === 'created_at' || f === 'sent_at') return new Date(v).getTime()
    return String(v).toLowerCase()
  }
  return [...rows].sort((a, b) => {
    const va = val(a, field); const vb = val(b, field)
    if (va < vb) return -1 * mul
    if (va > vb) return 1 * mul
    return 0
  })
}

function filterRows(rows: AdminAnnouncement[], q: string): AdminAnnouncement[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((r) =>
    [r.subject, r.status, r.event_name, r.series_name, r.tenant_name]
      .filter((v): v is string => !!v)
      .some((v) => v.toLowerCase().includes(needle)),
  )
}

export default function AnnouncementsPage() {
  const [rows, setRows] = useState<AdminAnnouncement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const load = () => {
    setLoading(true); setError(null)
    adminApi.listAnnouncements()
      .then((data) => setRows(data ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => sortRows(filterRows(rows, search), sortField, sortDir), [rows, search, sortField, sortDir])

  const toggleSort = (f: SortField) => {
    if (sortField === f) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(f); setSortDir(f === 'created_at' || f === 'sent_at' ? 'desc' : 'asc') }
  }

  const sh = (label: string, f: SortField) => (
    <th
      onClick={() => toggleSort(f)}
      data-testid={`announcements-sort-${f}`}
      style={{ textAlign: 'left', padding: '8px 12px', color: sortField === f ? '#F5F5F5' : '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A', cursor: 'pointer', userSelect: 'none' }}
    >
      {label}{sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )
  const input = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none' } as const

  return (
    <div data-testid='announcements-page'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Announcements</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Every round communication sent across the platform. Latest 100 rows, newest first by default.
      </p>

      {error && (
        <div style={{ padding: '8px 12px', background: '#DC262610', border: '1px solid #DC262630', borderRadius: 4, color: '#DC2626', fontSize: 13, marginBottom: 12 }} data-testid='announcements-error'>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <input
          placeholder='Search subject, tenant, event, series…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...input, width: 360 }}
          data-testid='announcements-search'
        />
        <button
          onClick={load}
          style={{ background: 'none', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: 'pointer', fontSize: 12, padding: '6px 14px', borderRadius: 4 }}
        >
          Refresh
        </button>
        <span style={{ fontSize: 12, color: '#888' }}>
          {loading ? 'Loading…' : `${visible.length} of ${rows.length}`}
        </span>
      </div>

      {loading ? (
        <div style={{ color: '#888' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 40, textAlign: 'center', color: '#888', fontSize: 13 }} data-testid='announcements-empty'>
          No announcements yet. Round communications sent by coordinators will appear here.
        </div>
      ) : visible.length === 0 ? (
        <div style={{ color: '#888', padding: 40, textAlign: 'center' }}>No rows match the current search.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-testid='announcements-table'>
          <thead>
            <tr>
              {sh('Tenant', 'tenant_name')}
              {sh('Event', 'event_name')}
              {sh('Subject', 'status')}
              {sh('Status', 'status')}
              {sh('Sent', 'sent_count')}
              {sh('Sent at', 'sent_at')}
              {sh('Created', 'created_at')}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #1A1A1A' }} data-testid={`announcements-row-${r.id}`}>
                <td style={{ padding: '10px 12px' }}>{r.tenant_name ?? '—'}</td>
                <td style={{ padding: '10px 12px', color: '#F5F5F5' }}>
                  {r.event_name ?? '—'}
                  {r.series_name && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{r.series_name}</div>}
                </td>
                <td style={{ padding: '10px 12px', color: '#F5F5F5' }}>{r.subject ?? '—'}</td>
                <td style={{ padding: '10px 12px' }}>{statusPill(r.status)}</td>
                <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                  {r.sent_count == null ? '—' : (
                    <>
                      <span style={{ color: '#22C55E' }}>{r.sent_count}</span>
                      {r.failed_count != null && r.failed_count > 0 && (
                        <span style={{ color: '#DC2626', marginLeft: 6 }}>/ {r.failed_count} failed</span>
                      )}
                    </>
                  )}
                </td>
                <td style={{ padding: '10px 12px', color: '#888', fontSize: 12 }}>
                  {r.sent_at ? new Date(r.sent_at).toLocaleString('en-NZ') : '—'}
                </td>
                <td style={{ padding: '10px 12px', color: '#888', fontSize: 12 }}>
                  {new Date(r.created_at).toLocaleString('en-NZ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
