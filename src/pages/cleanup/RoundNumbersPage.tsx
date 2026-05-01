// [EPIC-240 Step 6] Set round_number on events that came in null from
// Speedhive. Groups by start_date so a single weekend's events all
// share the same round_number — multi-grid series (BMW, GTRNZ) and
// endurance rounds (101, 102 → renders as E1, E2) both work.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import SeriesPicker from './SeriesPicker'
import { assertInt, uuidList } from '../../lib/cleanupSql'

interface EventRow {
  id: string
  name: string | null
  start_date: string
  location_name: string | null
}

export default function RoundNumbersPage() {
  const [seriesId, setSeriesId] = useState('')
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Per-date round-number input. Keyed by start_date.
  const [roundByDate, setRoundByDate] = useState<Record<string, string>>({})

  const load = (id: string) => {
    setLoading(true)
    setErrorMsg(null)
    setOkMsg(null)
    setEvents([])
    setRoundByDate({})
    adminApi.selectRows<EventRow>(`
      SELECT e.id, e.name, e.start_date, c.name as location_name
      FROM events e
      LEFT JOIN circuits c ON c.id = e.circuit_id
      WHERE e.series_id = '${id}'
        AND e.round_number IS NULL
      ORDER BY e.start_date ASC, e.name ASC
    `)
      .then((rows) => setEvents(rows))
      .catch((e) => setErrorMsg((e as Error).message ?? 'Load failed'))
      .finally(() => setLoading(false))
  }

  // Group events by start_date. One date = one weekend = one round.
  const groups = useMemo(() => {
    const m = new Map<string, EventRow[]>()
    for (const e of events) {
      const day = (e.start_date ?? '').slice(0, 10)
      if (!m.has(day)) m.set(day, [])
      m.get(day)!.push(e)
    }
    return Array.from(m.entries())
      .map(([day, rows]) => ({ day, rows }))
      .sort((a, b) => a.day.localeCompare(b.day))
  }, [events])

  // Preview: tally how many events end up at each round_number.
  const preview = useMemo(() => {
    const tally = new Map<string, number>()
    for (const g of groups) {
      const n = roundByDate[g.day]?.trim()
      if (!n) continue
      tally.set(n, (tally.get(n) ?? 0) + g.rows.length)
    }
    return Array.from(tally.entries())
      .map(([rn, count]) => {
        const num = Number(rn)
        const label = Number.isInteger(num) && num >= 100 ? `E${num - 100}` : `R${num}`
        return { round_number: num, label, count }
      })
      .sort((a, b) => a.round_number - b.round_number)
  }, [roundByDate, groups])

  const apply = async () => {
    setSubmitting(true)
    setErrorMsg(null)
    setOkMsg(null)
    try {
      // Validate every input first, build the UPDATE list, then send.
      const updates: { round: number; ids: string[] }[] = []
      for (const g of groups) {
        const raw = roundByDate[g.day]?.trim()
        if (!raw) continue
        const round = assertInt(raw, `round number for ${g.day}`)
        updates.push({ round, ids: g.rows.map((r) => r.id) })
      }
      if (updates.length === 0) throw new Error('No round numbers entered.')

      let totalAffected = 0
      for (const u of updates) {
        const sql = `UPDATE events SET round_number = ${u.round} WHERE id IN (${uuidList(u.ids, 'round-numbers apply')})`
        const affected = await adminApi.runMutation(sql)
        totalAffected += affected
      }
      setOkMsg(`Updated round_number on ${totalAffected} event${totalAffected === 1 ? '' : 's'}. Reloading…`)
      load(seriesId)
    } catch (e) {
      setErrorMsg((e as Error).message ?? 'Apply failed')
    } finally {
      setSubmitting(false)
    }
  }

  const card = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16 }

  return (
    <div data-testid='cleanup-step-6'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Step 6 — Round numbers</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Type a round number for each weekend. All events on the same day get the same round.
        Use 1, 2, 3 for sprint rounds and 101, 102 for endurance rounds (renders as E1, E2).
      </p>

      <SeriesPicker
        value={seriesId}
        onChange={(id) => { setSeriesId(id); if (id) load(id); else setEvents([]) }}
      />

      {errorMsg && <div style={{ color: '#DC2626', background: '#0D0D0D', border: '1px solid #DC262640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{errorMsg}</div>}
      {okMsg && <div style={{ color: '#16A34A', background: '#0D0D0D', border: '1px solid #16A34A40', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{okMsg}</div>}

      {!seriesId ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Pick a series to begin.</div>
      ) : loading ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Loading events…</div>
      ) : events.length === 0 ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>
          No events with <code style={{ color: '#F5F5F5' }}>round_number IS NULL</code> for this series — nothing to do.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
            {groups.map((g) => (
              <div key={g.day} style={card} data-testid={`cleanup-round-group-${g.day}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F5F5' }}>
                      {new Date(g.day + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                    <div style={{ fontSize: 11, color: '#888' }}>{g.rows.length} event{g.rows.length === 1 ? '' : 's'}</div>
                  </div>
                  <input
                    data-testid={`cleanup-round-input-${g.day}`}
                    type='number'
                    placeholder='Round #'
                    value={roundByDate[g.day] ?? ''}
                    onChange={(e) => setRoundByDate((m) => ({ ...m, [g.day]: e.target.value }))}
                    style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 14, outline: 'none', width: 90 }}
                  />
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#888' }}>
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      {r.name ?? '(untitled)'}
                      {r.location_name ? <span style={{ color: '#666' }}> — {r.location_name}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {preview.length > 0 && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Preview</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13, color: '#F5F5F5' }}>
                {preview.map((p) => (
                  <span key={p.round_number}>
                    <strong>{p.label}</strong> × {p.count} event{p.count === 1 ? '' : 's'}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            type='button'
            data-testid='cleanup-round-apply'
            onClick={apply}
            disabled={submitting || preview.length === 0}
            style={{
              background: submitting || preview.length === 0 ? '#3a1010' : '#DC2626',
              border: 'none', color: '#F5F5F5',
              cursor: submitting || preview.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: 13, padding: '10px 20px', borderRadius: 4, fontWeight: 600,
            }}
          >
            {submitting ? 'Applying…' : 'Apply round numbers'}
          </button>
        </>
      )}
    </div>
  )
}
