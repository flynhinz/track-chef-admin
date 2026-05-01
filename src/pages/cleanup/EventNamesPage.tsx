// [EPIC-240 Step 8] Standardise event name suffixes per class group.
// Speedhive ships names like:
//   "2025 OctoberFAST · BMW Nexen Tyre E46"
//   "NZIGP Tasman Revival · BMW RDS - NEXEN Tyre E46 Class"
//   "TACCOC Sprint at the Downs · BMW RDS E46"
// All point at the same grid. We keep the venue prefix (everything
// before the first "·") and replace the suffix with a canonical class
// label, so the three become:
//   "2025 OctoberFAST · BMW Nexen Tyre E46"
//   "NZIGP Tasman Revival · BMW Nexen Tyre E46"
//   "TACCOC Sprint at the Downs · BMW Nexen Tyre E46"
//
// Grouping signal: the event's class label, derived from
// series_entries.class. Falls back to the existing suffix if no
// entries are joined to the event.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import SeriesPicker from './SeriesPicker'
import { uuidList, quoteLiteral } from '../../lib/cleanupSql'

interface EventRow {
  id: string
  name: string | null
  start_date: string
  // Class label most commonly seen on this event's series_entries.
  // null when the event has no entries linked yet.
  derived_class: string | null
}
interface ClassRow { label: string; sort_order: number }

interface Group {
  classKey: string         // canonical class label (or '__unknown__')
  events: EventRow[]
  // Editable suffix the admin types — defaults to classKey.
  suffix: string
}

function venuePrefix(name: string | null): string {
  if (!name) return ''
  const idx = name.indexOf('·')
  return (idx >= 0 ? name.slice(0, idx) : name).trim()
}

function existingSuffix(name: string | null): string {
  if (!name) return ''
  const idx = name.indexOf('·')
  return idx >= 0 ? name.slice(idx + 1).trim() : ''
}

export default function EventNamesPage() {
  const [seriesId, setSeriesId] = useState('')
  const [events, setEvents] = useState<EventRow[]>([])
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [suffixByGroup, setSuffixByGroup] = useState<Record<string, string>>({})

  const load = (id: string) => {
    setLoading(true)
    setErrorMsg(null)
    setOkMsg(null)
    setEvents([])
    setClasses([])
    setSuffixByGroup({})
    Promise.all([
      adminApi.selectRows<EventRow>(`
        SELECT
          e.id, e.name, e.start_date,
          (
            SELECT class
            FROM series_entries se
            WHERE se.event_id = e.id AND se.class IS NOT NULL AND btrim(se.class) <> ''
            GROUP BY class
            ORDER BY COUNT(*) DESC
            LIMIT 1
          ) AS derived_class
        FROM events e
        WHERE e.series_id = '${id}'
        ORDER BY e.start_date ASC, e.name ASC
      `),
      adminApi.selectRows<ClassRow>(`
        SELECT label, sort_order
        FROM series_classes
        WHERE series_id = '${id}'
        ORDER BY sort_order ASC, label ASC
      `),
    ])
      .then(([evs, cls]) => {
        setEvents(evs)
        setClasses(cls)
      })
      .catch((e) => setErrorMsg((e as Error).message ?? 'Load failed'))
      .finally(() => setLoading(false))
  }

  // Build groups keyed by derived_class (or the existing suffix as a
  // fallback for events with no entries linked yet). If a series_classes
  // row matches the derived value (case-insensitive, normalised), we use
  // the canonical spelling; otherwise the derived label itself.
  // [EPIC-240 follow-up] Fall back to existingSuffix(name) when the
  // event has no series_entries — keeps admins from having to type a
  // suffix for orphan events that already have a sensible one.
  const groups = useMemo<Group[]>(() => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
    const canon = new Map<string, string>(classes.map((c) => [norm(c.label), c.label]))
    const resolveKey = (e: EventRow): string => {
      if (e.derived_class) return canon.get(norm(e.derived_class)) ?? e.derived_class
      const sfx = existingSuffix(e.name)
      if (sfx) return canon.get(norm(sfx)) ?? sfx
      return '__unknown__'
    }
    const m = new Map<string, EventRow[]>()
    for (const e of events) {
      const k = resolveKey(e)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(e)
    }
    return Array.from(m.entries()).map(([classKey, rows]) => ({
      classKey,
      events: rows,
      suffix: suffixByGroup[classKey] ?? (classKey === '__unknown__' ? '' : classKey),
    }))
  }, [events, classes, suffixByGroup])

  const setSuffix = (classKey: string, val: string) =>
    setSuffixByGroup((m) => ({ ...m, [classKey]: val }))

  // Build the pending UPDATE list — only events whose new name
  // actually differs from the current name. Skip events where suffix
  // is empty (admin hasn't decided yet).
  const planned = useMemo(() => {
    const out: { id: string; from: string; to: string }[] = []
    for (const g of groups) {
      const sfx = g.suffix.trim()
      if (!sfx) continue
      for (const e of g.events) {
        const prefix = venuePrefix(e.name)
        if (!prefix) continue   // can't build "{venue} · {suffix}" without a prefix
        const next = `${prefix} · ${sfx}`
        if (next !== (e.name ?? '')) {
          out.push({ id: e.id, from: e.name ?? '', to: next })
        }
      }
    }
    return out
  }, [groups])

  const apply = async () => {
    if (planned.length === 0) { setErrorMsg('Nothing to change — every name already matches its target.'); return }
    setSubmitting(true)
    setErrorMsg(null)
    setOkMsg(null)
    try {
      // Group by target name so we can do one UPDATE per distinct name.
      const byName = new Map<string, string[]>()
      for (const p of planned) {
        if (!byName.has(p.to)) byName.set(p.to, [])
        byName.get(p.to)!.push(p.id)
      }
      let total = 0
      for (const [name, ids] of byName) {
        const sql = `UPDATE events SET name = ${quoteLiteral(name)} WHERE id IN (${uuidList(ids, 'event-names apply')})`
        total += await adminApi.runMutation(sql)
      }
      setOkMsg(`Renamed ${total} event${total === 1 ? '' : 's'}. Reloading…`)
      load(seriesId)
    } catch (e) {
      setErrorMsg((e as Error).message ?? 'Apply failed')
    } finally {
      setSubmitting(false)
    }
  }

  const card = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16 }

  return (
    <div data-testid='cleanup-step-8'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Step 8 — Standardise event names</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Keeps the venue prefix (everything before <code style={{ color: '#F5F5F5' }}>·</code>) and replaces the suffix
        per class group. Run Step 7 first so the suggestions match canonical class labels.
      </p>

      <SeriesPicker
        value={seriesId}
        onChange={(id) => { setSeriesId(id); if (id) load(id); else { setEvents([]); setClasses([]) } }}
      />

      {errorMsg && <div style={{ color: '#DC2626', background: '#0D0D0D', border: '1px solid #DC262640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{errorMsg}</div>}
      {okMsg && <div style={{ color: '#16A34A', background: '#0D0D0D', border: '1px solid #16A34A40', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{okMsg}</div>}

      {!seriesId ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Pick a series to begin.</div>
      ) : loading ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Loading events…</div>
      ) : events.length === 0 ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>No events for this series.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
            {groups.map((g) => (
              <div key={g.classKey} style={card} data-testid={`cleanup-name-group-${g.classKey}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Class group</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F5F5' }}>
                      {g.classKey === '__unknown__' ? '(no class on entries)' : g.classKey}
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>{g.events.length} event{g.events.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <input
                    data-testid={`cleanup-name-suffix-${g.classKey}`}
                    placeholder='Suffix (e.g. BMW Nexen Tyre E46)'
                    value={g.suffix}
                    onChange={(e) => setSuffix(g.classKey, e.target.value)}
                    style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none', width: 320 }}
                  />
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#888' }}>
                  {g.events.map((e) => {
                    const prefix = venuePrefix(e.name)
                    const sfx = g.suffix.trim()
                    const next = prefix && sfx ? `${prefix} · ${sfx}` : null
                    const willChange = next !== null && next !== (e.name ?? '')
                    return (
                      <li key={e.id} style={{ marginBottom: 4 }}>
                        <span style={{ color: willChange ? '#F5F5F5' : '#666' }}>
                          {e.name ?? '(untitled)'}
                        </span>
                        {willChange && (
                          <>
                            <span style={{ color: '#666', margin: '0 6px' }}>→</span>
                            <span style={{ color: '#16A34A' }}>{next}</span>
                          </>
                        )}
                        {!prefix && (
                          <span style={{ color: '#D97706', marginLeft: 8 }}>· no venue prefix — skipped</span>
                        )}
                        {prefix && existingSuffix(e.name) && existingSuffix(e.name) !== sfx && (
                          <span style={{ color: '#666', marginLeft: 8, fontSize: 10 }}>
                            (was suffix: "{existingSuffix(e.name)}")
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Pending changes</div>
            <div style={{ fontSize: 13, color: '#F5F5F5', fontFamily: 'monospace' }}>
              {planned.length === 0 ? 'No changes pending — type a suffix in any group above.' : `${planned.length} event${planned.length === 1 ? '' : 's'} will be renamed.`}
            </div>
          </div>

          <button type='button' data-testid='cleanup-names-apply'
            onClick={apply} disabled={submitting || planned.length === 0}
            style={{
              background: submitting || planned.length === 0 ? '#3a1010' : '#DC2626',
              border: 'none', color: '#F5F5F5',
              cursor: submitting || planned.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: 13, padding: '10px 20px', borderRadius: 4, fontWeight: 600,
            }}
          >
            {submitting ? 'Applying…' : `Apply ${planned.length} rename${planned.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </div>
  )
}
