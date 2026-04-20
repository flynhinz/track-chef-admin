// [EPIC-149 Step 5] Debug Console — verbose log viewer for the five
// monitored edge functions. Subscribes to public.ef_logs over Supabase
// realtime so new rows stream in without polling (per addition #4).
//
// Verbose toggles flip ef_config.verbose_enabled for each function;
// clear wipes the log history (optionally per function).
import { useEffect, useMemo, useState } from 'react'
import { adminApi, type EfConfig, type EfLog } from '../lib/adminApi'
import { supabase } from '../lib/supabase'

type Level = 'info' | 'warn' | 'error' | 'debug'

const LEVEL_COLOR: Record<Level, string> = {
  info: '#5A9AC8',
  warn: '#E8B547',
  error: '#DC2626',
  debug: '#888',
}

const LEVELS: Level[] = ['info', 'warn', 'error', 'debug']

export default function DebugConsolePage() {
  const [configs, setConfigs] = useState<EfConfig[]>([])
  const [logs, setLogs] = useState<EfLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSlug, setFilterSlug] = useState<string>('')
  const [filterLevel, setFilterLevel] = useState<string>('')
  const [filterSession, setFilterSession] = useState<string>('')
  const [selected, setSelected] = useState<EfLog | null>(null)
  const [streaming, setStreaming] = useState(true)
  const [statusMessage, setStatusMessage] = useState<string>('')

  const reload = async () => {
    setLoading(true)
    try {
      const [cfg, rows] = await Promise.all([
        adminApi.listEfConfig(),
        adminApi.listEfLogs({
          function_slug: filterSlug || undefined,
          level: (filterLevel as Level) || undefined,
          session_id: filterSession || undefined,
          limit: 500,
        }),
      ])
      setConfigs(cfg)
      setLogs(rows)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterSlug, filterLevel, filterSession])

  // Addition #4 — Supabase realtime subscription, not polling. New
  // ef_logs rows stream in as inserts; client-side filters apply.
  useEffect(() => {
    if (!streaming) return
    const channel = supabase
      .channel('ef_logs_stream')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ef_logs' },
        (payload) => {
          const row = payload.new as EfLog
          if (filterSlug && row.function_slug !== filterSlug) return
          if (filterLevel && row.level !== filterLevel) return
          if (filterSession && row.session_id !== filterSession) return
          setLogs((prev) => [row, ...prev].slice(0, 500))
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setStatusMessage('Streaming')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          setStatusMessage('Stream offline')
      })
    return () => { supabase.removeChannel(channel) }
  }, [streaming, filterSlug, filterLevel, filterSession])

  const slugs = useMemo(
    () => Array.from(new Set([...(configs.map((c) => c.function_slug)), ...logs.map((l) => l.function_slug)])).sort(),
    [configs, logs],
  )

  const toggleVerbose = async (slug: string, next: boolean) => {
    const updated = await adminApi.toggleEfVerbose(slug, next)
    setConfigs((prev) => prev.map((c) => (c.function_slug === slug ? { ...c, ...updated } : c)))
  }

  const clearLogs = async (scope?: string) => {
    const label = scope ? `logs for ${scope}` : 'ALL ef_logs'
    if (!confirm(`Permanently delete ${label}? This cannot be undone.`)) return
    await adminApi.clearEfLogs(scope ? { function_slug: scope } : {})
    await reload()
  }

  const th = (label: string) => (
    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>{label}</th>
  )
  const input = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none' } as const
  const btn = { background: 'none', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: 'pointer', fontSize: 12, padding: '6px 14px', borderRadius: 4 } as const

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Debug Console</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Live verbose logs from monitored edge functions. Streams from{' '}
        <code style={{ color: '#F5F5F5' }}>public.ef_logs</code> via Supabase realtime; toggle verbose per function in the panel below.
      </p>

      {/* Verbose toggle panel */}
      <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Verbose toggles</div>
        {configs.length === 0 ? (
          <div style={{ color: '#888', fontSize: 12 }}>No ef_config rows yet — seed via SQL.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {configs.map((c) => (
              <label key={c.function_slug} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid #2A2A2A', borderRadius: 4, cursor: 'pointer', background: c.verbose_enabled ? '#1A2A1A' : 'transparent' }}>
                <input
                  type='checkbox'
                  checked={c.verbose_enabled}
                  onChange={(e) => toggleVerbose(c.function_slug, e.target.checked)}
                  style={{ accentColor: '#22C55E' }}
                />
                <code style={{ color: '#F5F5F5', fontSize: 12, flex: 1 }}>{c.function_slug}</code>
                <button onClick={(e) => { e.preventDefault(); clearLogs(c.function_slug) }} style={{ ...btn, fontSize: 11, padding: '2px 8px' }}>Clear</button>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={filterSlug} onChange={(e) => setFilterSlug(e.target.value)} style={{ ...input, width: 200 }}>
          <option value=''>All functions</option>
          {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} style={{ ...input, width: 140 }}>
          <option value=''>All levels</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input
          placeholder='session_id (optional)'
          value={filterSession}
          onChange={(e) => setFilterSession(e.target.value)}
          style={{ ...input, width: 280 }}
        />
        <button onClick={reload} style={btn}>Refresh</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888', cursor: 'pointer' }}>
          <input
            type='checkbox'
            checked={streaming}
            onChange={(e) => setStreaming(e.target.checked)}
            style={{ accentColor: '#DC2626' }}
          />
          Stream new rows
        </label>
        <button onClick={() => clearLogs()} style={{ ...btn, borderColor: '#DC262640', color: '#DC2626' }}>Clear all</button>
        <span style={{ fontSize: 12, color: '#888' }}>{logs.length} rows · {statusMessage}</span>
      </div>

      {loading ? (
        <div style={{ color: '#888' }}>Loading…</div>
      ) : logs.length === 0 ? (
        <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>No log rows match the current filter.</div>
          <div style={{ fontSize: 11, color: '#555' }}>Trigger one of the monitored functions, or relax filters.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', gap: 16 }}>
          <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{th('When')}{th('Function')}{th('Level')}{th('Message')}{th('Session')}</tr></thead>
              <tbody>{logs.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setSelected(l)}
                  style={{ borderBottom: '1px solid #1A1A1A', cursor: 'pointer', background: selected?.id === l.id ? '#1A1A1A' : 'transparent' }}
                >
                  <td style={{ padding: '6px 12px', color: '#888', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString('en-NZ')}</td>
                  <td style={{ padding: '6px 12px', color: '#F5F5F5', fontFamily: 'monospace', fontSize: 11 }}>{l.function_slug}</td>
                  <td style={{ padding: '6px 12px', color: LEVEL_COLOR[l.level] ?? '#F5F5F5', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase' }}>{l.level}</td>
                  <td style={{ padding: '6px 12px', color: '#F5F5F5' }}>{l.message}</td>
                  <td style={{ padding: '6px 12px', color: '#888', fontFamily: 'monospace', fontSize: 10 }}>{l.session_id ? l.session_id.slice(0, 12) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {selected && (
            <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16, maxHeight: '70vh', overflow: 'auto', position: 'sticky', top: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Log details</div>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
              <dl style={{ fontSize: 12, margin: 0 }}>
                <Row label='function' value={selected.function_slug} mono />
                <Row label='level' value={selected.level.toUpperCase()} mono />
                <Row label='session_id' value={selected.session_id ?? '—'} mono />
                <Row label='created_at' value={new Date(selected.created_at).toLocaleString('en-NZ')} />
                <Row label='message' value={selected.message} />
              </dl>
              <div style={{ fontSize: 11, color: '#888', marginTop: 12, marginBottom: 4 }}>payload</div>
              <pre style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: 10, fontSize: 11, color: '#F5F5F5', overflow: 'auto', margin: 0 }}>
                {JSON.stringify(selected.payload ?? {}, null, 2)}
              </pre>
              <div style={{ marginTop: 12 }}>
                <button onClick={() => setFilterSession(selected.session_id ?? '')} disabled={!selected.session_id} style={{ ...btn, opacity: selected.session_id ? 1 : 0.4 }}>
                  Filter to this session
                </button>
              </div>
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
      <dd style={{ color: '#F5F5F5', margin: 0, flex: 1, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11 : 12, wordBreak: 'break-all' }}>{value}</dd>
    </div>
  )
}
