import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'

interface UsageStats { dau: number; wau: number; mau: number; top_events_7d: { name: string; count: number }[]; top_pages_7d: { name: string; count: number }[] }

// [BUG-454] Client-error feed — shown below the usage charts as a proxy
// for "is anything on fire" until proper persona / feature-adoption
// charts land.
interface ClientErrorRow {
  scope: string | null
  level: string | null
  message: string | null
  created_at: string
}

const CLIENT_ERRORS_SQL = `
  SELECT scope, level, message, created_at
  FROM client_errors
  ORDER BY created_at DESC
  LIMIT 20
`

export default function UsagePage() {
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [series, setSeries] = useState<{ day: string; count: number }[]>([])
  const [errors, setErrors] = useState<ClientErrorRow[]>([])
  const [errorsLoading, setErrorsLoading] = useState(true)

  useEffect(() => {
    adminApi.usageStats().then(s => { setStats(s); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    adminApi.selectRows<ClientErrorRow>(CLIENT_ERRORS_SQL)
      .then((rows) => setErrors(rows))
      .catch(() => setErrors([]))
      .finally(() => setErrorsLoading(false))
  }, [])

  useEffect(() => {
    const sql = "select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as count from public.app_events where created_at > now() - interval '7 days' group by 1 order by 1"
    adminApi.runSql(sql).then(r => {
      if (r.kind !== 'rows') return
      const byDay = new Map(r.rows.map(row => [String(row.day), Number(row.count)]))
      const filled: { day: string; count: number }[] = []
      const today = new Date()
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today); d.setDate(today.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        filled.push({ day: key, count: byDay.get(key) ?? 0 })
      }
      setSeries(filled)
    }).catch(() => {})
  }, [])

  const card = (label: string, value: number | string, hint?: string, color = '#DC2626') => (
    <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 24, minWidth: 160 }}>
      <div style={{ fontSize: 40, fontWeight: 700, color, fontFamily: 'monospace', lineHeight: 1 }}>{loading ? '…' : value}</div>
      <div style={{ fontSize: 13, color: '#F5F5F5', marginTop: 8, fontWeight: 500 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{hint}</div>}
    </div>
  )

  const bars = (title: string, rows: { name: string; count: number }[]) => {
    const max = Math.max(1, ...rows.map(r => r.count))
    return (
      <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 20, flex: 1, minWidth: 320 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{title}</div>
        {rows.length === 0 ? (
          <div style={{ color: '#888', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>No data in last 7 days.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map(r => (
              <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '1fr 60px', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#F5F5F5', marginBottom: 3, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ height: 6, background: '#0D0D0D', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: '#DC2626' }} />
                  </div>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#888', textAlign: 'right' }}>{r.count}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Usage Dashboard</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 32 }}>Active users, most-used features, and most-visited pages across Track-Chef.</p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        {card('DAU', stats?.dau ?? 0, 'Unique users — last 24h')}
        {card('WAU', stats?.wau ?? 0, 'Unique users — last 7d', '#F5F5F5')}
        {card('MAU', stats?.mau ?? 0, 'Unique users — last 30d', '#888')}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {bars('Top events (7d)', stats?.top_events_7d ?? [])}
        {bars('Top pages (7d)', stats?.top_pages_7d ?? [])}
      </div>

      <LineChart data={series} />

      {!loading && stats?.dau === 0 && stats?.wau === 0 && (
        <div style={{ background: '#141414', border: '1px solid #F59E0B40', borderRadius: 8, padding: 20, marginTop: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B', marginBottom: 4 }}>No telemetry data yet</div>
          <div style={{ fontSize: 12, color: '#888' }}>The Track-Chef app needs to insert into <code style={{ color: '#F5F5F5' }}>public.app_events</code> on key user actions. See the event taxonomy in ClickUp EPIC-94.</div>
        </div>
      )}

      {/* [BUG-454] Client-error feed — proxy until feature-adoption + persona charts land. */}
      <div data-testid='client-errors' style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 20, marginTop: 32 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Recent client errors</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
          Last 20 rows from <code style={{ color: '#F5F5F5' }}>client_errors</code>. Persona distribution and DAU/WAU/MAU charts coming soon.
        </div>
        {errorsLoading ? (
          <div style={{ color: '#888', fontSize: 12, padding: 8 }}>Loading…</div>
        ) : errors.length === 0 ? (
          <div style={{ color: '#888', fontSize: 12, padding: 8 }}>No client errors recorded.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A', whiteSpace: 'nowrap' }}>Scope</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>Level</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>Message</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A', whiteSpace: 'nowrap' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1A1A1A' }}>
                  <td style={{ padding: '6px 12px', color: '#F5F5F5', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{e.scope ?? '—'}</td>
                  <td style={{ padding: '6px 12px', color: e.level === 'error' ? '#DC2626' : e.level === 'warn' ? '#D97706' : '#888', fontSize: 11, textTransform: 'uppercase', fontWeight: 600 }}>{e.level ?? '—'}</td>
                  <td style={{ padding: '6px 12px', color: '#F5F5F5', fontFamily: 'monospace', fontSize: 11, maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.message ?? ''}>{e.message ?? '—'}</td>
                  <td style={{ padding: '6px 12px', color: '#888', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString('en-NZ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function LineChart({ data }: { data: { day: string; count: number }[] }) {
  if (data.length === 0) return null
  const w = 600, h = 160, padX = 40, padY = 20
  const max = Math.max(1, ...data.map(d => d.count))
  const step = (w - padX * 2) / Math.max(1, data.length - 1)
  const pt = (d: { count: number }, i: number) => {
    const x = padX + i * step
    const y = h - padY - (d.count / max) * (h - padY * 2)
    return { x, y }
  }
  const points = data.map((d, i) => { const p = pt(d, i); return `${p.x},${p.y}` }).join(' ')
  return (
    <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 20, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Events over time (7d)</div>
      <svg width='100%' viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
        <polyline fill='none' stroke='#DC2626' strokeWidth={2} points={points} />
        {data.map((d, i) => { const p = pt(d, i); return <circle key={d.day} cx={p.x} cy={p.y} r={3} fill='#DC2626' /> })}
        {data.map((d, i) => { const p = pt(d, i); return <text key={d.day} x={p.x} y={h - 4} fontSize={10} fill='#888' textAnchor='middle'>{d.day.slice(5)}</text> })}
        <text x={8} y={padY + 4} fontSize={10} fill='#888'>{max}</text>
        <text x={8} y={h - padY + 4} fontSize={10} fill='#888'>0</text>
      </svg>
    </div>
  )
}
