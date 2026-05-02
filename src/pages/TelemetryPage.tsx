import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../lib/adminApi'

interface AppEvent { id: number; event_name: string; page: string | null; persona: string | null; user_id: string | null; tenant_id: string | null; properties: Record<string, unknown>; created_at: string }

// [BUG-454] Speedhive sync health — top-of-page panel (ahead of the
// EF/EF-error rate work tracked in the "Coming soon" subtitle).
interface SyncRow {
  id: string
  event_id: string | null
  state: string | null
  message: string | null
  session_label: string | null
  next_check_at: string | null
  last_updated_at: string | null
  event_name: string | null
}

const SYNC_SQL = `
  SELECT
    s.id, s.event_id, s.state, s.message, s.session_label,
    s.next_check_at, s.last_updated_at,
    e.name as event_name
  FROM speedhive_sync_status s
  LEFT JOIN events e ON e.id = s.event_id
  ORDER BY s.last_updated_at DESC
  LIMIT 10
`

// [TECH-06 — moved from main app] Marketing-events telemetry block.
// Reads public.marketing_events via admin-query / run_sql so the
// service role bypasses RLS. Range toggle drives a single SELECT
// capped at 5000 rows; everything else is derived client-side.
interface MarketingEventRow {
  id: string
  event_type: string
  entity_type: string | null
  entity_id: string | null
  entity_name: string | null
  session_id: string | null
  referrer: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  device_type: string | null
  created_at: string
}

type AnalyticsRange = 7 | 30 | 90

function marketingSqlForRange(days: AnalyticsRange): string {
  return `
    SELECT id, event_type, entity_type, entity_id, entity_name,
           session_id, referrer, utm_source, utm_medium, utm_campaign,
           device_type, created_at
    FROM public.marketing_events
    WHERE created_at >= now() - interval '${days} days'
    ORDER BY created_at DESC
    LIMIT 5000
  `
}

interface DerivedMarketing {
  rows: MarketingEventRow[]
  overview: {
    page_views: number
    finder_opens: number
    searches: number
    entity_clicks: number
    profile_views: number
    conversion_pct: number
  }
  topDrivers: { name: string; count: number }[]
  topSeries: { name: string; count: number }[]
  topLemons: { name: string; count: number }[]
  searchTerms: { term: string; count: number }[]
  device: { mobile: number; tablet: number; desktop: number; total: number }
  utmSources: { source: string; count: number }[]
  daily: { date: string; page_view: number; finder_opened: number }[]
}

function deriveMarketing(rows: MarketingEventRow[], days: AnalyticsRange): DerivedMarketing {
  let page_views = 0, finder_opens = 0, searches = 0, entity_clicks = 0, profile_views = 0
  rows.forEach((r) => {
    if (r.event_type === 'page_view') page_views++
    else if (r.event_type === 'finder_opened') finder_opens++
    else if (r.event_type === 'finder_searched') searches++
    else if (r.event_type === 'entity_selected') entity_clicks++
    else if (r.event_type === 'profile_viewed') profile_views++
  })
  const conversion_pct = page_views > 0 ? Math.round((profile_views / page_views) * 1000) / 10 : 0

  const tally = (entityType: string, limit: number) => {
    const m = new Map<string, { name: string; count: number }>()
    rows.filter((r) => r.event_type === 'entity_selected' && r.entity_type === entityType).forEach((r) => {
      const key = r.entity_id ?? r.entity_name ?? 'unknown'
      const existing = m.get(key)
      if (existing) existing.count++
      else m.set(key, { name: r.entity_name ?? r.entity_id ?? 'Unknown', count: 1 })
    })
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, limit)
  }

  const searchTally = new Map<string, number>()
  rows.filter((r) => r.event_type === 'finder_searched' && r.entity_name).forEach((r) => {
    const term = (r.entity_name ?? '').trim().toLowerCase()
    if (!term) return
    searchTally.set(term, (searchTally.get(term) ?? 0) + 1)
  })

  const device = { mobile: 0, tablet: 0, desktop: 0, total: 0 }
  rows.forEach((r) => {
    if (r.device_type === 'mobile') device.mobile++
    else if (r.device_type === 'tablet') device.tablet++
    else if (r.device_type === 'desktop') device.desktop++
  })
  device.total = device.mobile + device.tablet + device.desktop

  const utmTally = new Map<string, number>()
  rows.forEach((r) => {
    const src = (r.utm_source ?? '').trim()
    if (!src) return
    utmTally.set(src, (utmTally.get(src) ?? 0) + 1)
  })

  const dailyMap = new Map<string, { date: string; page_view: number; finder_opened: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dailyMap.set(key, { date: key, page_view: 0, finder_opened: 0 })
  }
  rows.forEach((r) => {
    const key = (r.created_at ?? '').slice(0, 10)
    const row = dailyMap.get(key)
    if (!row) return
    if (r.event_type === 'page_view') row.page_view++
    if (r.event_type === 'finder_opened') row.finder_opened++
  })
  const daily = Array.from(dailyMap.values())

  return {
    rows,
    overview: { page_views, finder_opens, searches, entity_clicks, profile_views, conversion_pct },
    topDrivers: tally('driver', 10),
    topSeries: tally('series', 5),
    topLemons: tally('lemons_team', 5),
    searchTerms: Array.from(searchTally.entries()).map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count).slice(0, 20),
    device,
    utmSources: Array.from(utmTally.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    daily,
  }
}

export default function TelemetryPage() {
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<AppEvent | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [syncRows, setSyncRows] = useState<SyncRow[]>([])
  const [syncLoading, setSyncLoading] = useState(true)

  // Marketing block state.
  const [mktRange, setMktRange] = useState<AnalyticsRange>(30)
  const [mktRows, setMktRows] = useState<MarketingEventRow[] | null>(null)
  const [mktLoading, setMktLoading] = useState(true)
  const [mktError, setMktError] = useState<string | null>(null)

  useEffect(() => {
    adminApi.selectRows<SyncRow>(SYNC_SQL)
      .then((rows) => setSyncRows(rows))
      .catch(() => setSyncRows([]))
      .finally(() => setSyncLoading(false))
  }, [])

  useEffect(() => {
    setMktLoading(true)
    setMktError(null)
    adminApi
      .selectRows<MarketingEventRow>(marketingSqlForRange(mktRange))
      .then((rows) => setMktRows(rows ?? []))
      .catch((e) => {
        setMktRows([])
        setMktError(e instanceof Error ? e.message : 'Failed to load marketing events')
      })
      .finally(() => setMktLoading(false))
  }, [mktRange])

  const mkt = useMemo<DerivedMarketing | null>(() => {
    if (!mktRows) return null
    return deriveMarketing(mktRows, mktRange)
  }, [mktRows, mktRange])

  const load = (silent = false) => {
    if (!silent) setLoading(true)
    adminApi.recentEvents({ limit: 500, event_name: filter || undefined }).then((data: AppEvent[]) => {
      setEvents(data ?? [])
      if (!silent) setLoading(false)
    })
  }
  useEffect(() => { load() }, [filter])
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => load(true), 30000)
    return () => clearInterval(id)
  }, [autoRefresh, filter])

  const th = (label: string) => <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>{label}</th>
  const input = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none' } as const

  return (
    <div data-testid='telemetry-page'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Telemetry</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Marketing telemetry, Speedhive sync health, and the click-by-click <code style={{ color: '#F5F5F5' }}>app_events</code> log.
      </p>

      {/* [TECH-06] Marketing telemetry — moved from app.track-chef.com/admin. */}
      <MarketingBlock mkt={mkt} loading={mktLoading} error={mktError} range={mktRange} setRange={setMktRange} />

      {/* [BUG-454] Speedhive sync status — middle of the page now. */}
      <div data-testid='speedhive-sync' style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16, marginTop: 24, marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Speedhive sync status (last 10)</div>
        {syncLoading ? (
          <div style={{ color: '#888', fontSize: 12, padding: 8 }}>Loading…</div>
        ) : syncRows.length === 0 ? (
          <div style={{ color: '#888', fontSize: 12, padding: 8 }}>No sync activity recorded.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>Event</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>Last Run</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>State</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>Message</th>
              </tr>
            </thead>
            <tbody>
              {syncRows.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
                  <td style={{ padding: '6px 12px', color: '#F5F5F5' }}>{s.event_name ?? '—'}</td>
                  <td style={{ padding: '6px 12px', color: '#888', fontFamily: 'monospace', fontSize: 11 }}>{s.last_updated_at ? new Date(s.last_updated_at).toLocaleString('en-NZ') : '—'}</td>
                  <td style={{ padding: '6px 12px', color: s.state === 'polling' ? '#16A34A' : s.state === 'error' ? '#DC2626' : '#888', fontSize: 11, textTransform: 'uppercase', fontWeight: 600 }}>{s.state ?? '—'}</td>
                  <td style={{ padding: '6px 12px', color: '#888', fontSize: 11 }}>{s.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Recent app events</h2>
      <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>Showing last 500 from <code style={{ color: '#F5F5F5' }}>app_events</code>.</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <input placeholder='Filter by event name (e.g. run_started)' value={filter} onChange={e => setFilter(e.target.value)} style={{ ...input, width: 320 }} />
        <button onClick={() => load()} style={{ background: 'none', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: 'pointer', fontSize: 12, padding: '6px 14px', borderRadius: 4 }}>Refresh</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888', cursor: 'pointer' }}>
          <input type='checkbox' checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ accentColor: '#DC2626' }} />
          Auto-refresh 30s
        </label>
        <span style={{ fontSize: 12, color: '#888' }}>{events.length} events</span>
      </div>

      {loading ? <div style={{ color: '#888' }}>Loading...</div> : events.length === 0 ? (
        <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>No events yet.</div>
          <div style={{ fontSize: 11, color: '#555' }}>Track-Chef client must call <code>supabase.from('app_events').insert(...)</code> on key user actions.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 16 }}>
          <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{th('When')}{th('Event')}{th('Page')}{th('Persona')}{th('User')}</tr></thead>
              <tbody>{events.map(e => (
                <tr key={e.id} onClick={() => setSelected(e)} style={{ borderBottom: '1px solid #1A1A1A', cursor: 'pointer', background: selected?.id === e.id ? '#1A1A1A' : 'transparent' }}>
                  <td style={{ padding: '6px 12px', color: '#888', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString('en-NZ')}</td>
                  <td style={{ padding: '6px 12px', color: '#DC2626', fontFamily: 'monospace', fontSize: 11 }}>{e.event_name}</td>
                  <td style={{ padding: '6px 12px', color: '#F5F5F5' }}>{e.page || '—'}</td>
                  <td style={{ padding: '6px 12px', color: '#888' }}>{e.persona || '—'}</td>
                  <td style={{ padding: '6px 12px', color: '#888', fontFamily: 'monospace', fontSize: 10 }}>{e.user_id ? e.user_id.slice(0, 8) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {selected && (
            <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16, maxHeight: '70vh', overflow: 'auto', position: 'sticky' as const, top: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Event details</div>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
              <dl style={{ fontSize: 12, margin: 0 }}>
                <Row label='event_name' value={selected.event_name} mono />
                <Row label='page' value={selected.page ?? '—'} />
                <Row label='persona' value={selected.persona ?? '—'} />
                <Row label='user_id' value={selected.user_id ?? '—'} mono />
                <Row label='tenant_id' value={selected.tenant_id ?? '—'} mono />
                <Row label='created_at' value={new Date(selected.created_at).toLocaleString('en-NZ')} />
              </dl>
              <div style={{ fontSize: 11, color: '#888', marginTop: 12, marginBottom: 4 }}>properties</div>
              <pre style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: 10, fontSize: 11, color: '#F5F5F5', overflow: 'auto', margin: 0 }}>{JSON.stringify(selected.properties ?? {}, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid #1A1A1A' }}>
      <dt style={{ color: '#888', width: 90, fontSize: 11 }}>{label}</dt>
      <dd style={{ color: '#F5F5F5', margin: 0, flex: 1, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11 : 12, wordBreak: 'break-all' as const }}>{value}</dd>
    </div>
  )
}

// ─── Marketing telemetry block ─────────────────────────────────────────────

function MarketingBlock({
  mkt,
  loading,
  error,
  range,
  setRange,
}: {
  mkt: DerivedMarketing | null
  loading: boolean
  error: string | null
  range: AnalyticsRange
  setRange: (v: AnalyticsRange) => void
}) {
  return (
    <div data-testid='marketing-block' style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' as const }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Marketing telemetry</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Activity across the public discovery surfaces (<code>marketing_events</code>).</div>
        </div>
        <div style={{ display: 'inline-flex', border: '1px solid #2A2A2A', borderRadius: 4, overflow: 'hidden' }}>
          {([7, 30, 90] as AnalyticsRange[]).map((v) => (
            <button
              key={v}
              onClick={() => setRange(v)}
              style={{
                background: range === v ? '#DC2626' : 'transparent',
                color: range === v ? 'white' : '#F5F5F5',
                border: 'none',
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {v}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#888', fontSize: 12, padding: 8 }}>Loading…</div>
      ) : error ? (
        <div style={{ color: '#DC2626', fontSize: 12, padding: 8 }}>Couldn't load marketing events: {error}</div>
      ) : !mkt ? null : (
        <>
          {/* Overview */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 16 }}>
            <Metric label='Page views' value={mkt.overview.page_views} />
            <Metric label='Finder opens' value={mkt.overview.finder_opens} />
            <Metric label='Searches' value={mkt.overview.searches} />
            <Metric label='Entity clicks' value={mkt.overview.entity_clicks} />
            <Metric label='Profile views' value={mkt.overview.profile_views} />
            <Metric label='Conversion' value={`${mkt.overview.conversion_pct}%`} />
          </div>

          {/* Top entities + search terms */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <RankedList title='Top 10 drivers' rows={mkt.topDrivers} />
            <RankedList title='Top 5 series' rows={mkt.topSeries} />
            <RankedList title='Top 5 Lemons teams' rows={mkt.topLemons} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {/* Search terms */}
            <div style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 6, padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#F5F5F5', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 }}>Top 20 search terms</div>
              {mkt.searchTerms.length === 0 ? (
                <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No searches yet.</div>
              ) : (
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' as const }}>
                  <tbody>
                    {mkt.searchTerms.map((s) => (
                      <tr key={s.term} style={{ borderBottom: '1px solid #1A1A1A' }}>
                        <td style={{ padding: '3px 0', color: '#F5F5F5' }}>{s.term}</td>
                        <td style={{ padding: '3px 0', color: '#888', textAlign: 'right' as const, fontFamily: 'monospace', fontWeight: 600 }}>{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Devices + UTM */}
            <div style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 6, padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#F5F5F5', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 }}>Device · UTM</div>
              {mkt.device.total === 0 ? (
                <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No traffic recorded yet.</div>
              ) : (
                <div style={{ marginBottom: 10 }}>
                  {(['mobile', 'tablet', 'desktop'] as const).map((d) => {
                    const v = mkt.device[d]
                    const pct = mkt.device.total > 0 ? Math.round((v / mkt.device.total) * 100) : 0
                    return (
                      <div key={d} style={{ marginBottom: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#F5F5F5' }}>
                          <span style={{ textTransform: 'capitalize' as const }}>{d}</span>
                          <span style={{ color: '#888', fontFamily: 'monospace' }}>{v} · {pct}%</span>
                        </div>
                        <div style={{ height: 4, background: '#1A1A1A', borderRadius: 2, marginTop: 2 }}>
                          <div style={{ height: '100%', background: '#DC2626', width: `${pct}%`, borderRadius: 2 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {mkt.utmSources.length === 0 ? null : (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#F5F5F5', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 4 }}>UTM sources</div>
                  {mkt.utmSources.map((u) => {
                    const max = mkt.utmSources[0].count || 1
                    const pct = Math.max(2, Math.round((u.count / max) * 100))
                    return (
                      <div key={u.source} style={{ marginBottom: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#F5F5F5' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: 160 }}>{u.source}</span>
                          <span style={{ color: '#888', fontFamily: 'monospace' }}>{u.count}</span>
                        </div>
                        <div style={{ height: 4, background: '#1A1A1A', borderRadius: 2, marginTop: 2 }}>
                          <div style={{ height: '100%', background: '#DC2626', width: `${pct}%`, borderRadius: 2 }} />
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>

          {/* Daily series — inline SVG sparkline */}
          <DailySparkline daily={mkt.daily} />

          {/* Raw events table */}
          <RawMarketingTable rows={mkt.rows} />
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 6, padding: 10 }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#F5F5F5', marginTop: 2, fontVariantNumeric: 'tabular-nums' as const }}>{value}</div>
    </div>
  )
}

function RankedList({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  return (
    <div style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 6, padding: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#F5F5F5', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No clicks yet.</div>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
              <span style={{ color: '#F5F5F5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1 }}>
                <span style={{ color: '#888', display: 'inline-block', width: 18 }}>{i + 1}.</span>
                {r.name}
              </span>
              <span style={{ color: '#F5F5F5', fontFamily: 'monospace', fontWeight: 600 }}>{r.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function DailySparkline({ daily }: { daily: { date: string; page_view: number; finder_opened: number }[] }) {
  if (daily.length === 0) return null
  const W = 800
  const H = 80
  const PAD = 8
  const innerW = W - PAD * 2
  const innerH = H - PAD * 2
  const maxVal = Math.max(1, ...daily.flatMap((d) => [d.page_view, d.finder_opened]))
  const xFor = (i: number) => PAD + (i * innerW) / Math.max(1, daily.length - 1)
  const yFor = (v: number) => PAD + innerH - (v / maxVal) * innerH
  const linePath = (key: 'page_view' | 'finder_opened') =>
    daily.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(d[key])}`).join(' ')
  const totalPV = daily.reduce((acc, d) => acc + d.page_view, 0)
  const totalFO = daily.reduce((acc, d) => acc + d.finder_opened, 0)
  return (
    <div style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 6, padding: 10, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#F5F5F5', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Daily activity
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
          <span style={{ color: '#00BFFF' }}>● page_view ({totalPV})</span>
          <span style={{ color: '#1D9E75' }}>● finder_opened ({totalFO})</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width='100%' height={H} preserveAspectRatio='none' style={{ display: 'block' }}>
        <path d={linePath('page_view')} fill='none' stroke='#00BFFF' strokeWidth={1.6} />
        <path d={linePath('finder_opened')} fill='none' stroke='#1D9E75' strokeWidth={1.6} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', marginTop: 4 }}>
        <span>{daily[0]?.date}</span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  )
}

function RawMarketingTable({ rows }: { rows: MarketingEventRow[] }) {
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const haystack = [r.event_type, r.entity_type, r.entity_name, r.utm_source, r.device_type].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, filter])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const inputStyle = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '4px 8px', color: '#F5F5F5', fontSize: 12, outline: 'none', width: 220 } as const
  return (
    <div style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 6, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#F5F5F5', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Raw events ({filtered.length})</div>
        <input value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0) }} placeholder='Filter…' style={inputStyle} />
      </div>
      {filtered.length === 0 ? (
        <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No events match.</div>
      ) : (
        <>
          <div style={{ overflow: 'auto', maxHeight: '50vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' as const, padding: '4px 8px', color: '#888', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>Time</th>
                  <th style={{ textAlign: 'left' as const, padding: '4px 8px', color: '#888', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>Event</th>
                  <th style={{ textAlign: 'left' as const, padding: '4px 8px', color: '#888', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>Entity</th>
                  <th style={{ textAlign: 'left' as const, padding: '4px 8px', color: '#888', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>Device</th>
                  <th style={{ textAlign: 'left' as const, padding: '4px 8px', color: '#888', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>UTM source</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
                    <td style={{ padding: '4px 8px', color: '#888', fontFamily: 'monospace', whiteSpace: 'nowrap' as const }}>{new Date(r.created_at).toLocaleString('en-NZ')}</td>
                    <td style={{ padding: '4px 8px', color: '#DC2626', fontFamily: 'monospace' }}>{r.event_type}</td>
                    <td style={{ padding: '4px 8px', color: '#F5F5F5' }}>{r.entity_name ?? (r.entity_type ? `<${r.entity_type}>` : '—')}</td>
                    <td style={{ padding: '4px 8px', color: '#888', textTransform: 'capitalize' as const }}>{r.device_type ?? '—'}</td>
                    <td style={{ padding: '4px 8px', color: '#888' }}>{r.utm_source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11, color: '#888' }}>
            <span>Page {page + 1} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ background: 'none', border: '1px solid #2A2A2A', color: page === 0 ? '#444' : '#F5F5F5', cursor: page === 0 ? 'default' : 'pointer', fontSize: 11, padding: '3px 10px', borderRadius: 4 }}>Prev</button>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ background: 'none', border: '1px solid #2A2A2A', color: page >= totalPages - 1 ? '#444' : '#F5F5F5', cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontSize: 11, padding: '3px 10px', borderRadius: 4 }}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
