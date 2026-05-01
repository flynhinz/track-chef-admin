// [EPIC-240 Step 1] Merge a duplicate series into a canonical one.
// Speedhive can import the same series twice under slightly different
// names; this wizard re-points every child row at the canonical series
// then deletes the duplicate.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import SeriesPicker, { type CleanupSeries } from './SeriesPicker'
import { assertUuid } from '../../lib/cleanupSql'

interface SeriesDetail {
  id: string
  name: string
  slug: string | null
  season: string | null
  tenant_id: string | null
  tenant_name: string | null
  events: number
  entries: number
  created_at: string
}

const DETAIL_SQL = (id: string) => `
  SELECT
    s.id, s.name, s.slug, s.season, s.tenant_id,
    t.name as tenant_name,
    s.created_at,
    (SELECT COUNT(*)::int FROM events e WHERE e.series_id = s.id) as events,
    (SELECT COUNT(*)::int FROM series_entries se WHERE se.series_id = s.id) as entries
  FROM series s
  LEFT JOIN tenants t ON t.id = s.tenant_id
  WHERE s.id = '${id}'
  LIMIT 1
`

export default function DeduplicateSeriesPage() {
  const [dupeId, setDupeId] = useState('')
  const [canonId, setCanonId] = useState('')
  const [dupe, setDupe] = useState<SeriesDetail | null>(null)
  const [canon, setCanon] = useState<SeriesDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadDetail = async (id: string): Promise<SeriesDetail | null> => {
    if (!id) return null
    const rows = await adminApi.selectRows<SeriesDetail>(DETAIL_SQL(assertUuid(id, 'series detail')))
    return rows[0] ?? null
  }

  useEffect(() => {
    if (!dupeId) { setDupe(null); return }
    setLoading(true)
    loadDetail(dupeId).then(setDupe).catch((e) => setErrorMsg((e as Error).message)).finally(() => setLoading(false))
  }, [dupeId])

  useEffect(() => {
    if (!canonId) { setCanon(null); return }
    setLoading(true)
    loadDetail(canonId).then(setCanon).catch((e) => setErrorMsg((e as Error).message)).finally(() => setLoading(false))
  }, [canonId])

  const sameTenant = useMemo(
    () => dupe && canon && dupe.tenant_id && canon.tenant_id && dupe.tenant_id === canon.tenant_id,
    [dupe, canon],
  )

  const apply = async () => {
    if (!dupe || !canon) { setErrorMsg('Pick both a duplicate and a canonical series.'); return }
    if (dupe.id === canon.id) { setErrorMsg('Duplicate and canonical cannot be the same row.'); return }
    if (!confirm(`Merge "${dupe.name}" → "${canon.name}" and DELETE the duplicate? This is not reversible.`)) return
    setSubmitting(true)
    setErrorMsg(null)
    setOkMsg(null)
    try {
      const dId = `'${assertUuid(dupe.id, 'duplicate id')}'`
      const cId = `'${assertUuid(canon.id, 'canonical id')}'`
      const steps: { label: string; sql: string }[] = [
        { label: 'events',                  sql: `UPDATE events SET series_id = ${cId} WHERE series_id = ${dId}` },
        { label: 'series_entries',          sql: `UPDATE series_entries SET series_id = ${cId} WHERE series_id = ${dId}` },
        { label: 'championship_standings',  sql: `UPDATE championship_standings SET series_id = ${cId} WHERE series_id = ${dId}` },
        { label: 'standings_sets',          sql: `UPDATE standings_sets SET series_id = ${cId} WHERE series_id = ${dId}` },
        { label: 'points_systems',          sql: `UPDATE points_systems SET series_id = ${cId} WHERE series_id = ${dId}` },
        { label: 'series_classes',          sql: `UPDATE series_classes SET series_id = ${cId} WHERE series_id = ${dId}` },
        { label: 'delete duplicate series', sql: `DELETE FROM series WHERE id = ${dId}` },
      ]
      const results: string[] = []
      for (const step of steps) {
        const affected = await adminApi.runMutation(step.sql)
        results.push(`${step.label}: ${affected}`)
      }
      setOkMsg(`Merge complete. ${results.join(' · ')}`)
      setDupeId('')
      setDupe(null)
    } catch (e) {
      setErrorMsg((e as Error).message ?? 'Merge failed')
    } finally {
      setSubmitting(false)
    }
  }

  const card = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16 }
  const detailCard = (label: string, s: SeriesDetail | null, accent: string) => (
    <div style={{ ...card, borderColor: accent }}>
      <div style={{ fontSize: 11, color: accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{label}</div>
      {s ? (
        <div style={{ fontSize: 13, color: '#F5F5F5', display: 'grid', gap: 4 }}>
          <div><strong>{s.name}</strong>{s.season ? ` (${s.season})` : ''}</div>
          <div style={{ color: '#888', fontSize: 12 }}>tenant: {s.tenant_name ?? '—'}</div>
          <div style={{ color: '#888', fontSize: 12 }}>slug: {s.slug ?? '—'}</div>
          <div style={{ color: '#888', fontSize: 12 }}>created: {new Date(s.created_at).toLocaleDateString('en-NZ')}</div>
          <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12 }}>
            <span style={{ color: '#F5F5F5' }}>{s.events}</span><span style={{ color: '#888' }}> events · </span>
            <span style={{ color: '#F5F5F5' }}>{s.entries}</span><span style={{ color: '#888' }}> entries</span>
          </div>
        </div>
      ) : (
        <div style={{ color: '#888', fontSize: 12 }}>—</div>
      )}
    </div>
  )

  return (
    <div data-testid='cleanup-step-1'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Step 1 — Deduplicate series</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Pick the duplicate (the row to delete) and the canonical (the row to keep). Every event,
        entry, standings row, points system, and class is re-pointed at the canonical series, then
        the duplicate is deleted.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: '#DC2626', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Duplicate (to delete)</div>
          <SeriesPicker value={dupeId} onChange={(id) => setDupeId(id)} testId='cleanup-dupe-picker' />
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#16A34A', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Canonical (to keep)</div>
          <SeriesPicker value={canonId} onChange={(id) => setCanonId(id)} testId='cleanup-canon-picker' />
        </div>
      </div>

      {errorMsg && <div style={{ color: '#DC2626', background: '#0D0D0D', border: '1px solid #DC262640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{errorMsg}</div>}
      {okMsg && <div style={{ color: '#16A34A', background: '#0D0D0D', border: '1px solid #16A34A40', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{okMsg}</div>}

      {(dupe || canon) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {detailCard('Duplicate', dupe, '#DC2626')}
          {detailCard('Canonical', canon, '#16A34A')}
        </div>
      )}

      {dupe && canon && dupe.id === canon.id && (
        <div style={{ color: '#D97706', background: '#0D0D0D', border: '1px solid #D9770640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>
          Both pickers point at the same series — pick a different canonical to merge into.
        </div>
      )}

      {dupe && canon && dupe.id !== canon.id && !sameTenant && (
        <div style={{ color: '#D97706', background: '#0D0D0D', border: '1px solid #D9770640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>
          Cross-tenant merge — duplicate's tenant_id will not change on the moved rows. Confirm this is intentional.
        </div>
      )}

      {dupe && canon && dupe.id !== canon.id && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Preview</div>
          <div style={{ fontSize: 13, color: '#F5F5F5' }}>
            <strong>{dupe.events}</strong> events and <strong>{dupe.entries}</strong> entries
            {' '}will be migrated from <span style={{ color: '#DC2626' }}>{dupe.name}</span>
            {' '}to <span style={{ color: '#16A34A' }}>{canon.name}</span>, then the duplicate row will be deleted.
          </div>
        </div>
      )}

      <button
        type='button'
        data-testid='cleanup-dedupe-apply'
        onClick={apply}
        disabled={submitting || loading || !dupe || !canon || dupe.id === canon.id}
        style={{
          background: submitting || !dupe || !canon || dupe.id === canon?.id ? '#3a1010' : '#DC2626',
          border: 'none', color: '#F5F5F5',
          cursor: submitting || !dupe || !canon || dupe.id === canon?.id ? 'not-allowed' : 'pointer',
          fontSize: 13, padding: '10px 20px', borderRadius: 4, fontWeight: 600,
        }}
      >
        {submitting ? 'Merging…' : 'Merge & delete duplicate'}
      </button>
    </div>
  )
}
