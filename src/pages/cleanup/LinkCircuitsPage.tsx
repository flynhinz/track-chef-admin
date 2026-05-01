// [EPIC-240 Step 3] Link events to circuits. Speedhive imports leave
// events.circuit_id null and only carry a free-text venue
// (events.location / events.track_name / suffix-after-· in name). Each
// event gets the top fuzzy-matched circuits as one-click candidates.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import SeriesPicker from './SeriesPicker'
import { assertUuid } from '../../lib/cleanupSql'
import { nameScore, tokenScore } from '../../lib/fuzzy'

interface EventRow {
  id: string
  name: string | null
  start_date: string
  location: string | null
  track_name: string | null
}
interface CircuitRow {
  id: string
  name: string
  short_name: string | null
  country: string | null
  speedhive_name_aliases: string[] | null
}

function venueText(e: EventRow): string {
  // Strongest signal first.
  if (e.track_name?.trim()) return e.track_name.trim()
  if (e.location?.trim()) return e.location.trim()
  // Suffix after first "·" in event name.
  if (e.name) {
    const idx = e.name.indexOf('·')
    if (idx >= 0) {
      const after = e.name.slice(idx + 1).trim()
      if (after) return after
    }
    return e.name.trim()
  }
  return ''
}

function rankCircuits(venue: string, circuits: CircuitRow[], top = 3): { circuit: CircuitRow; score: number }[] {
  if (!venue) return []
  return circuits
    .map((c) => {
      const aliasScore = (c.speedhive_name_aliases ?? []).reduce(
        (best, a) => Math.max(best, nameScore(venue, a)),
        0,
      )
      const score = Math.max(
        nameScore(venue, c.name),
        c.short_name ? tokenScore(venue, c.short_name) : 0,
        aliasScore,
      )
      return { circuit: c, score }
    })
    .filter((m) => m.score >= 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
}

export default function LinkCircuitsPage() {
  const [seriesId, setSeriesId] = useState('')
  const [events, setEvents] = useState<EventRow[]>([])
  const [circuits, setCircuits] = useState<CircuitRow[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())

  const load = (id: string) => {
    setLoading(true)
    setErrorMsg(null)
    setOkMsg(null)
    setEvents([])
    setSkipped(new Set())
    Promise.all([
      adminApi.selectRows<EventRow>(`
        SELECT id, name, start_date, location, track_name
        FROM events
        WHERE series_id = '${assertUuid(id, 'series id')}'
          AND circuit_id IS NULL
        ORDER BY start_date ASC, name ASC
      `),
      adminApi.selectRows<CircuitRow>(`
        SELECT id, name, short_name, country, speedhive_name_aliases
        FROM circuits
        WHERE COALESCE(active, true) = true
        ORDER BY name ASC
      `),
    ])
      .then(([evs, cks]) => { setEvents(evs); setCircuits(cks) })
      .catch((e) => setErrorMsg((e as Error).message ?? 'Load failed'))
      .finally(() => setLoading(false))
  }

  const visible = useMemo(() => events.filter((e) => !skipped.has(e.id)), [events, skipped])

  const linkedCount = events.length - visible.length
  const unlinkedCount = visible.length

  const link = async (eventId: string, circuitId: string) => {
    setSubmitting(eventId)
    setErrorMsg(null)
    try {
      const sql = `UPDATE events SET circuit_id = '${assertUuid(circuitId, 'circuit id')}' WHERE id = '${assertUuid(eventId, 'event id')}'`
      await adminApi.runMutation(sql)
      // Drop the row from the visible list — successfully linked.
      setEvents((evs) => evs.filter((e) => e.id !== eventId))
      setOkMsg(`Linked. ${visible.length - 1} event${visible.length - 1 === 1 ? '' : 's'} remaining.`)
    } catch (e) {
      setErrorMsg((e as Error).message ?? 'Link failed')
    } finally {
      setSubmitting(null)
    }
  }

  const skip = (eventId: string) => {
    setSkipped((s) => { const n = new Set(s); n.add(eventId); return n })
  }

  const card = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16 }

  return (
    <div data-testid='cleanup-step-3'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Step 3 — Link circuits</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        For each event with no <code style={{ color: '#F5F5F5' }}>circuit_id</code>, pick the matching circuit.
        Driver-mode features (PB walls, circuit history, weather) all key off this link.
      </p>

      <SeriesPicker value={seriesId} onChange={(id) => { setSeriesId(id); if (id) load(id); else { setEvents([]); setCircuits([]) } }} />

      {errorMsg && <div style={{ color: '#DC2626', background: '#0D0D0D', border: '1px solid #DC262640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{errorMsg}</div>}
      {okMsg && <div style={{ color: '#16A34A', background: '#0D0D0D', border: '1px solid #16A34A40', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{okMsg}</div>}

      {!seriesId ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Pick a series to begin.</div>
      ) : loading ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Loading events…</div>
      ) : events.length === 0 ? (
        <div style={{ ...card, color: '#16A34A', fontSize: 13 }}>✓ All events for this series are already linked to a circuit.</div>
      ) : (
        <>
          <div style={{ ...card, marginBottom: 16, fontSize: 13, color: '#F5F5F5' }}>
            <strong>{linkedCount + skipped.size}</strong> processed · <strong>{unlinkedCount}</strong> remaining
            {circuits.length === 0 && <span style={{ color: '#D97706', marginLeft: 12 }}>· no active circuits available</span>}
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            {visible.map((e) => {
              const venue = venueText(e)
              const matches = rankCircuits(venue, circuits)
              return (
                <div key={e.id} style={card} data-testid={`cleanup-circuit-row-${e.id}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F5F5' }}>{e.name ?? '(untitled)'}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {new Date(e.start_date + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · venue: '}<span style={{ color: '#F5F5F5' }}>{venue || '(no venue text)'}</span>
                      </div>
                    </div>
                    <button type='button' onClick={() => skip(e.id)}
                      style={{ background: 'none', border: '1px solid #2A2A2A', color: '#888', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 4, alignSelf: 'flex-start' }}
                    >Skip</button>
                  </div>

                  {matches.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#D97706', marginBottom: 8 }}>
                      No fuzzy matches ≥ 50% — pick from the full list:
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Top matches</div>
                  )}

                  <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                    {matches.map(({ circuit, score }) => (
                      <button key={circuit.id} type='button' data-testid={`cleanup-circuit-pick-${e.id}-${circuit.id}`}
                        onClick={() => link(e.id, circuit.id)}
                        disabled={submitting === e.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: '6px 10px', cursor: submitting === e.id ? 'wait' : 'pointer', textAlign: 'left' }}
                      >
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: score >= 75 ? '#16A34A' : '#D97706', minWidth: 36 }}>{score}%</span>
                        <span style={{ flex: 1, fontSize: 13, color: '#F5F5F5' }}>{circuit.name}{circuit.short_name ? ` (${circuit.short_name})` : ''}</span>
                        {circuit.country && <span style={{ fontSize: 11, color: '#888' }}>{circuit.country}</span>}
                      </button>
                    ))}
                  </div>

                  <details>
                    <summary style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>All circuits ({circuits.length})</summary>
                    <select
                      data-testid={`cleanup-circuit-fallback-${e.id}`}
                      value=''
                      disabled={submitting === e.id}
                      onChange={(ev) => { if (ev.target.value) link(e.id, ev.target.value) }}
                      style={{ marginTop: 6, background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '6px 10px', color: '#F5F5F5', fontSize: 12, outline: 'none', width: '100%' }}
                    >
                      <option value=''>— Pick any circuit —</option>
                      {circuits.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.short_name ? ` (${c.short_name})` : ''}{c.country ? ` — ${c.country}` : ''}</option>
                      ))}
                    </select>
                  </details>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
