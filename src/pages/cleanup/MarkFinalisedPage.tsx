// [EPIC-240 Step 4] Bulk-mark historical race_results from
// 'provisional' → 'finalised' so points / standings are calculable.
// FEAT-568 introduced the three-state lifecycle (provisional →
// finalised → official); this wizard handles the back-population
// without forcing a coordinator through the per-event UI.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import SeriesPicker from './SeriesPicker'
import { assertUuid, uuidList } from '../../lib/cleanupSql'

interface EventRow {
  id: string
  name: string | null
  round_number: number | null
  start_date: string
  session_count: number
  provisional_count: number
}

export default function MarkFinalisedPage() {
  const [seriesId, setSeriesId] = useState('')
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const load = (id: string) => {
    setLoading(true)
    setErrorMsg(null)
    setOkMsg(null)
    setEvents([])
    setSelected(new Set())
    adminApi.selectRows<EventRow>(`
      SELECT
        e.id, e.name, e.round_number, e.start_date,
        (SELECT COUNT(*)::int FROM sessions s WHERE s.event_id = e.id) as session_count,
        (SELECT COUNT(*)::int FROM race_results rr
           JOIN sessions s ON s.id = rr.session_id
          WHERE s.event_id = e.id AND rr.result_status = 'provisional') as provisional_count
      FROM events e
      WHERE e.series_id = '${assertUuid(id, 'series id')}'
      ORDER BY e.round_number ASC NULLS LAST, e.start_date ASC
    `)
      .then((rows) => setEvents(rows.filter((r) => r.provisional_count > 0)))
      .catch((e) => setErrorMsg((e as Error).message ?? 'Load failed'))
      .finally(() => setLoading(false))
  }

  const toggle = (id: string) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const allChecked = events.length > 0 && events.every((e) => selected.has(e.id))
  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(events.map((e) => e.id)))
  }

  const totalSelectedRows = useMemo(
    () => events.filter((e) => selected.has(e.id)).reduce((s, e) => s + e.provisional_count, 0),
    [events, selected],
  )

  const apply = async () => {
    if (selected.size === 0) { setErrorMsg('Tick at least one event.'); return }
    if (!confirm(`Mark race_results as 'finalised' for ${selected.size} event${selected.size === 1 ? '' : 's'} (${totalSelectedRows} provisional row${totalSelectedRows === 1 ? '' : 's'})?`)) return
    setSubmitting(true)
    setErrorMsg(null)
    setOkMsg(null)
    setProgress({ done: 0, total: selected.size })
    try {
      const ids = Array.from(selected)
      let totalAffected = 0
      for (let i = 0; i < ids.length; i++) {
        const eid = assertUuid(ids[i], 'event id')
        // race_results.session_id IN (sessions where event_id = eid)
        // and current result_status = 'provisional'.
        const sql = `
          UPDATE race_results
             SET result_status = 'finalised',
                 is_published = true,
                 finalized_at = COALESCE(finalized_at, now())
           WHERE result_status = 'provisional'
             AND session_id IN (SELECT id FROM sessions WHERE event_id = '${eid}')
        `
        const affected = await adminApi.runMutation(sql)
        totalAffected += affected
        setProgress({ done: i + 1, total: ids.length })
      }
      setOkMsg(`Finalised ${totalAffected} race_result row${totalAffected === 1 ? '' : 's'} across ${ids.length} event${ids.length === 1 ? '' : 's'}. Reloading…`)
      load(seriesId)
    } catch (e) {
      setErrorMsg((e as Error).message ?? 'Apply failed')
    } finally {
      setSubmitting(false)
      setProgress(null)
    }
  }

  const card = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16 }

  return (
    <div data-testid='cleanup-step-4'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Step 4 — Mark results as Finalised</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Promotes <code style={{ color: '#F5F5F5' }}>result_status = 'provisional'</code> →{' '}
        <code style={{ color: '#F5F5F5' }}>'finalised'</code> for every race_result whose session
        belongs to a selected event. Points and standings recalculate downstream once finalised.
      </p>

      <SeriesPicker value={seriesId} onChange={(id) => { setSeriesId(id); if (id) load(id); else setEvents([]) }} />

      {errorMsg && <div style={{ color: '#DC2626', background: '#0D0D0D', border: '1px solid #DC262640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{errorMsg}</div>}
      {okMsg && <div style={{ color: '#16A34A', background: '#0D0D0D', border: '1px solid #16A34A40', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{okMsg}</div>}

      {!seriesId ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Pick a series to begin.</div>
      ) : loading ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Loading events…</div>
      ) : events.length === 0 ? (
        <div style={{ ...card, color: '#16A34A', fontSize: 13 }}>✓ No events with provisional results — this series is fully finalised.</div>
      ) : (
        <>
          <div style={{ ...card, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#F5F5F5', cursor: 'pointer' }}>
              <input type='checkbox' checked={allChecked} onChange={toggleAll} />
              {allChecked ? 'Deselect all' : 'Select all'} ({events.length})
            </label>
            <span style={{ fontSize: 12, color: '#888' }}>
              {selected.size} selected · {totalSelectedRows} provisional row{totalSelectedRows === 1 ? '' : 's'}
            </span>
          </div>

          <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#0D0D0D' }}>
                  <th style={{ width: 32, padding: '8px 12px' }} />
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Event</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 60 }}>Round</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 110 }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 80 }}>Sessions</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 100 }}>Provisional</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid #2A2A2A', cursor: 'pointer' }} onClick={() => toggle(e.id)} data-testid={`cleanup-finalise-row-${e.id}`}>
                    <td style={{ padding: '8px 12px' }}>
                      <input type='checkbox' checked={selected.has(e.id)} readOnly />
                    </td>
                    <td style={{ padding: '8px 12px', color: '#F5F5F5' }}>{e.name ?? '(untitled)'}</td>
                    <td style={{ padding: '8px 12px', color: '#888', fontFamily: 'monospace' }}>{e.round_number != null ? (e.round_number >= 100 ? `E${e.round_number - 100}` : `R${e.round_number}`) : '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#888' }}>{new Date(e.start_date + 'T00:00:00').toLocaleDateString('en-NZ')}</td>
                    <td style={{ padding: '8px 12px', color: '#888', fontFamily: 'monospace' }}>{e.session_count}</td>
                    <td style={{ padding: '8px 12px', color: e.provisional_count > 0 ? '#D97706' : '#888', fontFamily: 'monospace', fontWeight: e.provisional_count > 0 ? 600 : 400 }}>{e.provisional_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {progress && (
            <div style={{ ...card, marginBottom: 12, fontSize: 12, color: '#888' }}>
              Processing {progress.done} of {progress.total}…
              <div style={{ height: 4, background: '#0D0D0D', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(progress.done / progress.total) * 100}%`, background: '#DC2626', transition: 'width 0.2s' }} />
              </div>
            </div>
          )}

          <button type='button' data-testid='cleanup-finalise-apply'
            onClick={apply} disabled={submitting || selected.size === 0}
            style={{
              background: submitting || selected.size === 0 ? '#3a1010' : '#DC2626',
              border: 'none', color: '#F5F5F5',
              cursor: submitting || selected.size === 0 ? 'not-allowed' : 'pointer',
              fontSize: 13, padding: '10px 20px', borderRadius: 4, fontWeight: 600,
            }}
          >
            {submitting ? 'Finalising…' : `Mark ${selected.size} event${selected.size === 1 ? '' : 's'} as Finalised`}
          </button>
        </>
      )}
    </div>
  )
}
