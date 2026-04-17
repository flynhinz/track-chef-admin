import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'

interface AppEvent { id: number; event_name: string; page: string | null; persona: string | null; user_id: string | null; tenant_id: string | null; properties: Record<string, unknown>; created_at: string }

export default function TelemetryPage() {
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<AppEvent | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

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
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Telemetry</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>Click-by-click event log. Every tracked action fires into <code style={{ color: '#F5F5F5' }}>app_events</code>. Showing last 500.</p>

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
