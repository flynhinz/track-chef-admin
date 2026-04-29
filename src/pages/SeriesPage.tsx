// [BUG-454] Series tab — coordinator + linked/unlinked driver counts.
// Unlinked > 0 surfaces as a red badge (drivers haven't accepted invites
// yet, or backfill is needed). Empty events on an active series shows a
// ⚠️ duplicate/seed-artefact flag for ops to investigate.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../lib/adminApi'

interface Series {
  id: string
  name: string
  season: string | null
  country: string | null
  series_status: string | null
  is_public: boolean | null
  coordinator_tenant: string | null
  total_entries: number
  linked_drivers: number
  unlinked_entries: number
  total_events: number
  total_results: number
}

type SortDir = 'asc' | 'desc'
type SeriesField =
  | 'name' | 'season' | 'series_status' | 'coordinator_tenant'
  | 'total_entries' | 'linked_drivers' | 'unlinked_entries'
  | 'total_events' | 'total_results'

function cmp(a: string | number, b: string | number, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1
  if (a < b) return -1 * mul
  if (a > b) return 1 * mul
  return 0
}

const STR_FIELDS: SeriesField[] = ['name', 'season', 'series_status', 'coordinator_tenant']

function sortSeries(rows: Series[], field: SeriesField, dir: SortDir): Series[] {
  const val = (s: Series): string | number =>
    STR_FIELDS.includes(field)
      ? (s[field] as string | null ?? '').toLowerCase()
      : Number((s as unknown as Record<string, number>)[field] ?? 0)
  return [...rows].sort((a, b) => cmp(val(a), val(b), dir))
}

function filterSeries(rows: Series[], q: string): Series[] {
  const n = q.trim().toLowerCase()
  if (!n) return rows
  return rows.filter((s) =>
    [s.name, s.season, s.coordinator_tenant]
      .filter((v): v is string => !!v)
      .some((v) => v.toLowerCase().includes(n)),
  )
}

const SERIES_SQL = `
  SELECT
    s.id, s.name, s.season, s.country,
    s.series_status, s.is_public,
    t.name as coordinator_tenant,
    COUNT(DISTINCT se.id)::int                                                        as total_entries,
    COUNT(DISTINCT CASE WHEN se.driver_id IS NOT NULL THEN se.driver_id END)::int     as linked_drivers,
    COUNT(DISTINCT CASE WHEN se.driver_id IS NULL THEN se.id END)::int                as unlinked_entries,
    COUNT(DISTINCT e.id)::int                                                         as total_events,
    COUNT(DISTINCT rr.id)::int                                                        as total_results
  FROM series s
  LEFT JOIN tenants t           ON t.id = s.tenant_id
  LEFT JOIN series_entries se   ON se.series_id = s.id
  LEFT JOIN events e            ON e.series_id = s.id
  LEFT JOIN sessions sess       ON sess.event_id = e.id
  LEFT JOIN race_results rr     ON rr.session_id = sess.id
  GROUP BY s.id, s.name, s.season, s.country, s.series_status, s.is_public, t.name
  ORDER BY total_results DESC
`

function statusColor(s: string | null): { fg: string; bg: string; border: string } {
  if (s === 'active')   return { fg: '#16A34A', bg: '#16A34A20', border: '#16A34A40' }
  if (s === 'planning') return { fg: '#D97706', bg: '#D9770620', border: '#D9770640' }
  return                       { fg: '#888',    bg: '#88888820', border: '#88888840' }
}

export default function SeriesPage() {
  const [rows, setRows] = useState<Series[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SeriesField>('total_results')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    setLoading(true)
    setError(null)
    adminApi.selectRows<Series>(SERIES_SQL)
      .then((data) => setRows(data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(
    () => sortSeries(filterSeries(rows, search), sortField, sortDir),
    [rows, search, sortField, sortDir],
  )

  const toggleSort = (f: SeriesField) => {
    if (sortField === f) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(f); setSortDir(STR_FIELDS.includes(f) ? 'asc' : 'desc') }
  }

  const input = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none' } as const

  return (
    <div data-testid='series-page'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Series</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Coordinator, entry counts, and link health for every series across the platform.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <input
          placeholder='Search by name, season, or coordinator…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...input, width: 320 }}
          data-testid='series-search'
        />
        <span style={{ fontSize: 12, color: '#888' }}>
          {loading ? 'Loading…' : `${visible.length} of ${rows.length}`}
        </span>
      </div>

      {error ? (
        <div style={{ color: '#DC2626', padding: 16, background: '#141414', border: '1px solid #DC262640', borderRadius: 6 }}>{error}</div>
      ) : loading ? (
        <div style={{ color: '#888' }}>Loading...</div>
      ) : visible.length === 0 ? (
        <div style={{ color: '#888', padding: 40, textAlign: 'center' }}>
          {rows.length === 0 ? 'No series found' : 'No series match the current search'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-testid='series-table'>
          <thead>
            <tr>
              {sortableTh('Series Name', 'name',               sortField, sortDir, toggleSort)}
              {sortableTh('Season',      'season',             sortField, sortDir, toggleSort)}
              {sortableTh('Status',      'series_status',      sortField, sortDir, toggleSort)}
              {sortableTh('Coordinator', 'coordinator_tenant', sortField, sortDir, toggleSort)}
              {sortableTh('Entries',     'total_entries',      sortField, sortDir, toggleSort)}
              {sortableTh('Linked',      'linked_drivers',     sortField, sortDir, toggleSort)}
              {sortableTh('Unlinked',    'unlinked_entries',   sortField, sortDir, toggleSort)}
              {sortableTh('Events',      'total_events',       sortField, sortDir, toggleSort)}
              {sortableTh('Results',     'total_results',      sortField, sortDir, toggleSort)}
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              // ⚠️ — active series with entries but no events at all looks like a duplicate / seed artefact.
              const looksLikeArtefact = s.series_status === 'active' && s.total_events === 0 && s.total_entries > 0
              const sc = statusColor(s.series_status)
              return (
                <tr key={s.id} style={{ borderBottom: '1px solid #1A1A1A' }} data-testid={`series-row-${s.id}`}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                    {looksLikeArtefact && (
                      <span title='Active series with entries but no events — looks like a duplicate or seed artefact' style={{ marginRight: 6 }}>⚠️</span>
                    )}
                    {s.name}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#888' }}>{s.season ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, color: sc.fg, border: `1px solid ${sc.border}`, background: sc.bg, padding: '2px 8px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                      {s.series_status ?? '—'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#F5F5F5' }}>{s.coordinator_tenant ?? '—'}</td>
                  <td style={{ padding: '10px 12px', color: '#F5F5F5', fontFamily: 'monospace', fontSize: 12 }}>{s.total_entries}</td>
                  <td style={{ padding: '10px 12px', color: '#16A34A', fontFamily: 'monospace', fontSize: 12 }}>{s.linked_drivers}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {s.unlinked_entries > 0 ? (
                      <span data-testid={`unlinked-badge-${s.id}`} style={{ fontSize: 11, fontFamily: 'monospace', color: '#DC2626', background: '#DC262620', border: '1px solid #DC262640', padding: '2px 8px', borderRadius: 3, fontWeight: 600 }}>
                        {s.unlinked_entries}
                      </span>
                    ) : (
                      <span style={{ color: '#555', fontFamily: 'monospace', fontSize: 12 }}>0</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#F5F5F5', fontFamily: 'monospace', fontSize: 12 }}>{s.total_events}</td>
                  <td style={{ padding: '10px 12px', color: '#F5F5F5', fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{s.total_results.toLocaleString('en-NZ')}</td>
                </tr>
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
