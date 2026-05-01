// [EPIC-240 Step 7] Promote distinct series_entries.class values into
// the canonical series_classes table for a series. Skips labels that
// are already promoted. Drag-reorder before applying to set sort_order.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import SeriesPicker, { type CleanupSeries } from './SeriesPicker'
import { assertUuid, quoteLiteral } from '../../lib/cleanupSql'

interface ClassRow { class: string | null; driver_count: number }
interface ExistingClassRow { id: string; label: string; sort_order: number }

interface PickItem {
  label: string
  driver_count: number
  // Once user adds → assigned a position (0-based). null = not promoted yet.
  position: number | null
}

export default function SeriesClassesPage() {
  const [seriesId, setSeriesId] = useState('')
  const [series, setSeries] = useState<CleanupSeries | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [items, setItems] = useState<PickItem[]>([])
  const [existing, setExisting] = useState<ExistingClassRow[]>([])

  const load = (id: string) => {
    setLoading(true)
    setErrorMsg(null)
    setOkMsg(null)
    setItems([])
    setExisting([])
    Promise.all([
      adminApi.selectRows<ClassRow>(`
        SELECT class, COUNT(*)::int as driver_count
        FROM series_entries
        WHERE series_id = '${id}' AND class IS NOT NULL AND btrim(class) <> ''
        GROUP BY class
        ORDER BY COUNT(*) DESC, class ASC
      `),
      adminApi.selectRows<ExistingClassRow>(`
        SELECT id, label, sort_order
        FROM series_classes
        WHERE series_id = '${id}'
        ORDER BY sort_order ASC, label ASC
      `),
    ])
      .then(([distinct, exist]) => {
        const existingLabels = new Set(exist.map((r) => r.label))
        const next: PickItem[] = (distinct ?? [])
          .filter((r) => r.class !== null && !existingLabels.has(r.class as string))
          .map((r) => ({ label: r.class as string, driver_count: r.driver_count, position: null }))
        setItems(next)
        setExisting(exist ?? [])
      })
      .catch((e) => setErrorMsg((e as Error).message ?? 'Load failed'))
      .finally(() => setLoading(false))
  }

  // Promoted = items in the order list. Unpromoted = pills you can add.
  const promoted = useMemo(
    () => items.filter((i) => i.position !== null).sort((a, b) => (a.position! - b.position!)),
    [items],
  )
  const unpromoted = useMemo(
    () => items.filter((i) => i.position === null),
    [items],
  )

  const promote = (label: string) => {
    setItems((prev) => {
      const max = prev.reduce((m, i) => (i.position !== null && i.position > m ? i.position : m), -1)
      return prev.map((i) => i.label === label ? { ...i, position: max + 1 } : i)
    })
  }
  const unpromote = (label: string) => {
    setItems((prev) => {
      const removed = prev.find((i) => i.label === label)
      const removedPos = removed?.position ?? -1
      return prev.map((i) => {
        if (i.label === label) return { ...i, position: null }
        if (i.position !== null && i.position > removedPos) return { ...i, position: i.position - 1 }
        return i
      })
    })
  }
  const move = (label: string, dir: -1 | 1) => {
    setItems((prev) => {
      const list = prev.filter((i) => i.position !== null).sort((a, b) => a.position! - b.position!)
      const idx = list.findIndex((i) => i.label === label)
      if (idx < 0) return prev
      const swap = idx + dir
      if (swap < 0 || swap >= list.length) return prev
      const a = list[idx], b = list[swap]
      return prev.map((i) => {
        if (i.label === a.label) return { ...i, position: b.position }
        if (i.label === b.label) return { ...i, position: a.position }
        return i
      })
    })
  }
  const promoteAll = () => {
    setItems((prev) => {
      let pos = prev.reduce((m, i) => (i.position !== null && i.position > m ? i.position : m), -1)
      return prev.map((i) => i.position === null ? { ...i, position: ++pos } : i)
    })
  }

  const apply = async () => {
    if (!seriesId || !series) return
    if (promoted.length === 0) { setErrorMsg('Promote at least one class before applying.'); return }
    setSubmitting(true)
    setErrorMsg(null)
    setOkMsg(null)
    try {
      // Look up tenant_id for the series — series_classes requires it.
      const tRows = await adminApi.selectRows<{ tenant_id: string }>(
        `SELECT tenant_id FROM series WHERE id = '${assertUuid(seriesId, 'series id')}' LIMIT 1`,
      )
      const tenantId = tRows[0]?.tenant_id
      if (!tenantId) throw new Error('Could not resolve tenant_id for this series.')
      assertUuid(tenantId, 'tenant id')

      // Build a multi-row INSERT with sort_order starting from
      // (max existing + 1) so we never collide with already-promoted
      // entries on (series_id, sort_order) if there were any.
      const startOrder = existing.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1
      const values = promoted.map((p, i) => `('${seriesId}', '${tenantId}', ${quoteLiteral(p.label)}, ${startOrder + i})`).join(',')
      const sql = `INSERT INTO series_classes (series_id, tenant_id, label, sort_order) VALUES ${values}`
      const affected = await adminApi.runMutation(sql)
      setOkMsg(`Promoted ${affected} class${affected === 1 ? '' : 'es'} to the canonical list. Reloading…`)
      load(seriesId)
    } catch (e) {
      setErrorMsg((e as Error).message ?? 'Apply failed')
    } finally {
      setSubmitting(false)
    }
  }

  const card = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16 }

  return (
    <div data-testid='cleanup-step-7'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Step 7 — Series classes</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Promote class labels seen on entries into the canonical <code style={{ color: '#F5F5F5' }}>series_classes</code> list,
        with sort order. Already-promoted labels are excluded automatically.
      </p>

      <SeriesPicker
        value={seriesId}
        onChange={(id, row) => { setSeriesId(id); setSeries(row); if (id) load(id); else { setItems([]); setExisting([]) } }}
      />

      {errorMsg && <div style={{ color: '#DC2626', background: '#0D0D0D', border: '1px solid #DC262640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{errorMsg}</div>}
      {okMsg && <div style={{ color: '#16A34A', background: '#0D0D0D', border: '1px solid #16A34A40', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{okMsg}</div>}

      {!seriesId ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Pick a series to begin.</div>
      ) : loading ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Loading classes…</div>
      ) : (
        <>
          {existing.length > 0 && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Already promoted ({existing.length})
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {existing.map((e) => (
                  <span key={e.id} style={{ fontSize: 12, color: '#888', background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 999, padding: '4px 10px' }}>
                    {e.sort_order}. {e.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {items.length === 0 ? (
            <div style={{ ...card, color: '#888', fontSize: 13 }}>
              No new class labels to promote — every distinct entry class is already in <code style={{ color: '#F5F5F5' }}>series_classes</code>.
            </div>
          ) : (
            <>
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Available ({unpromoted.length})
                  </div>
                  {unpromoted.length > 0 && (
                    <button type='button' data-testid='cleanup-promote-all' onClick={promoteAll}
                      style={{ background: 'none', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 4 }}
                    >
                      Promote all
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {unpromoted.length === 0 && (
                    <span style={{ color: '#888', fontSize: 12 }}>(all promoted — set order below, then Apply)</span>
                  )}
                  {unpromoted.map((i) => (
                    <button key={i.label} type='button'
                      data-testid={`cleanup-promote-${i.label}`}
                      onClick={() => promote(i.label)}
                      style={{ fontSize: 12, color: '#F5F5F5', background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 999, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      + {i.label} <span style={{ color: '#888', marginLeft: 4 }}>({i.driver_count})</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ ...card, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Order to apply ({promoted.length})
                </div>
                {promoted.length === 0 ? (
                  <div style={{ color: '#888', fontSize: 12 }}>Click pills above to add them to the order list.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {promoted.map((p, idx) => (
                      <div key={p.label} data-testid={`cleanup-order-row-${p.label}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: '6px 10px' }}
                      >
                        <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', minWidth: 22 }}>{idx + 1}.</span>
                        <span style={{ flex: 1, fontSize: 13, color: '#F5F5F5' }}>{p.label}</span>
                        <span style={{ fontSize: 11, color: '#888' }}>{p.driver_count} drivers</span>
                        <button type='button' onClick={() => move(p.label, -1)} disabled={idx === 0}
                          style={{ background: 'none', border: '1px solid #2A2A2A', color: idx === 0 ? '#444' : '#F5F5F5', cursor: idx === 0 ? 'not-allowed' : 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
                        >↑</button>
                        <button type='button' onClick={() => move(p.label, 1)} disabled={idx === promoted.length - 1}
                          style={{ background: 'none', border: '1px solid #2A2A2A', color: idx === promoted.length - 1 ? '#444' : '#F5F5F5', cursor: idx === promoted.length - 1 ? 'not-allowed' : 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
                        >↓</button>
                        <button type='button' onClick={() => unpromote(p.label)}
                          style={{ background: 'none', border: '1px solid #DC262640', color: '#DC2626', cursor: 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button type='button' data-testid='cleanup-classes-apply'
                onClick={apply} disabled={submitting || promoted.length === 0}
                style={{
                  background: submitting || promoted.length === 0 ? '#3a1010' : '#DC2626',
                  border: 'none', color: '#F5F5F5',
                  cursor: submitting || promoted.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 13, padding: '10px 20px', borderRadius: 4, fontWeight: 600,
                }}
              >
                {submitting ? 'Applying…' : `Apply ${promoted.length} class${promoted.length === 1 ? '' : 'es'}`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
