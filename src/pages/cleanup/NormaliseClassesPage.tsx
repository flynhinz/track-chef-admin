// [EPIC-240 Step 2] Merge variant class strings on series_entries.class
// into one canonical label per group. Speedhive ships things like
// "BMW RDS E46" / "BMW RDS - NEXEN E46 Class" / "BMW Nexen Tyre E46"
// for the same physical class — this is the only step that can collapse
// them. Run BEFORE Step 7 so series_classes is built from clean labels.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import SeriesPicker from './SeriesPicker'
import { quoteLiteral, assertUuid } from '../../lib/cleanupSql'
import { nameScore } from '../../lib/fuzzy'

interface ClassRow { class: string; driver_count: number }
interface VariantGroup {
  // The canonical label admin will keep (typed or pre-filled with the
  // most common variant). All variants in `members` get re-written to
  // this on apply.
  canonical: string
  members: ClassRow[]
}

const SPLIT_HINT_RE = /\s\/\s|\s\+\s|\sand\s/i

export default function NormaliseClassesPage() {
  const [seriesId, setSeriesId] = useState('')
  const [rows, setRows] = useState<ClassRow[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Group state — each group keyed by an internal id; canonical is
  // editable, members can be moved between groups.
  const [groups, setGroups] = useState<Record<string, VariantGroup>>({})

  const load = (id: string) => {
    setLoading(true)
    setErrorMsg(null)
    setOkMsg(null)
    setRows([])
    setGroups({})
    adminApi.selectRows<ClassRow>(`
      SELECT class, COUNT(*)::int as driver_count
      FROM series_entries
      WHERE series_id = '${assertUuid(id, 'series id')}'
        AND class IS NOT NULL AND btrim(class) <> ''
      GROUP BY class
      ORDER BY COUNT(*) DESC, class ASC
    `)
      .then((data) => {
        setRows(data)
        setGroups(autoGroup(data))
      })
      .catch((e) => setErrorMsg((e as Error).message ?? 'Load failed'))
      .finally(() => setLoading(false))
  }

  const card = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16 }

  const setCanonical = (gid: string, val: string) =>
    setGroups((g) => ({ ...g, [gid]: { ...g[gid], canonical: val } }))

  const moveMember = (fromGid: string, label: string, toGid: string) => {
    setGroups((g) => {
      const from = g[fromGid]
      const to = g[toGid]
      if (!from || !to) return g
      const member = from.members.find((m) => m.class === label)
      if (!member) return g
      const next: Record<string, VariantGroup> = { ...g }
      next[fromGid] = { ...from, members: from.members.filter((m) => m.class !== label) }
      next[toGid] = { ...to, members: [...to.members, member].sort((a, b) => b.driver_count - a.driver_count) }
      // Drop empty groups.
      if (next[fromGid].members.length === 0) delete next[fromGid]
      return next
    })
  }

  const splitOff = (gid: string, label: string) => {
    setGroups((g) => {
      const from = g[gid]
      if (!from) return g
      const member = from.members.find((m) => m.class === label)
      if (!member) return g
      const newGid = `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const next: Record<string, VariantGroup> = { ...g }
      next[gid] = { ...from, members: from.members.filter((m) => m.class !== label) }
      next[newGid] = { canonical: label, members: [member] }
      if (next[gid].members.length === 0) delete next[gid]
      return next
    })
  }

  const groupList = useMemo(() => Object.entries(groups), [groups])

  // Plan the work: only variants whose class !== canonical (and canonical
  // non-empty) become UPDATEs.
  const planned = useMemo(() => {
    const out: { canonical: string; from: string; rows: number }[] = []
    for (const [, g] of Object.entries(groups)) {
      const canon = g.canonical.trim()
      if (!canon) continue
      for (const m of g.members) {
        if (m.class !== canon) out.push({ canonical: canon, from: m.class, rows: m.driver_count })
      }
    }
    return out
  }, [groups])

  const apply = async () => {
    if (!seriesId) return
    if (planned.length === 0) { setErrorMsg('Nothing to merge — every variant already matches its canonical.'); return }
    setSubmitting(true)
    setErrorMsg(null)
    setOkMsg(null)
    try {
      const sid = assertUuid(seriesId, 'series id')
      let total = 0
      for (const p of planned) {
        const sql = `UPDATE series_entries SET class = ${quoteLiteral(p.canonical)} WHERE series_id = '${sid}' AND class = ${quoteLiteral(p.from)}`
        total += await adminApi.runMutation(sql)
      }
      setOkMsg(`Normalised ${total} entr${total === 1 ? 'y' : 'ies'} across ${planned.length} variant${planned.length === 1 ? '' : 's'}. Reloading…`)
      load(seriesId)
    } catch (e) {
      setErrorMsg((e as Error).message ?? 'Apply failed')
    } finally {
      setSubmitting(false)
    }
  }

  const totalRows = rows.reduce((s, r) => s + r.driver_count, 0)
  const variantCount = rows.length
  const groupCount = groupList.length

  return (
    <div data-testid='cleanup-step-2'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Step 2 — Normalise classes</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Auto-groups variants of the same physical class. Edit the canonical label in each group,
        move misplaced members between groups, then apply. <strong>Run before Step 7</strong> so
        series_classes promotes clean labels.
      </p>

      <SeriesPicker value={seriesId} onChange={(id) => { setSeriesId(id); if (id) load(id); else { setRows([]); setGroups({}) } }} />

      {errorMsg && <div style={{ color: '#DC2626', background: '#0D0D0D', border: '1px solid #DC262640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{errorMsg}</div>}
      {okMsg && <div style={{ color: '#16A34A', background: '#0D0D0D', border: '1px solid #16A34A40', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{okMsg}</div>}

      {!seriesId ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Pick a series to begin.</div>
      ) : loading ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Loading classes…</div>
      ) : rows.length === 0 ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>No classes set on entries for this series.</div>
      ) : (
        <>
          <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 24 }}>
            <div><span style={{ color: '#888', fontSize: 11 }}>Variants</span><div style={{ fontFamily: 'monospace', color: '#F5F5F5' }}>{variantCount}</div></div>
            <div><span style={{ color: '#888', fontSize: 11 }}>Groups</span><div style={{ fontFamily: 'monospace', color: '#F5F5F5' }}>{groupCount}</div></div>
            <div><span style={{ color: '#888', fontSize: 11 }}>Entries</span><div style={{ fontFamily: 'monospace', color: '#F5F5F5' }}>{totalRows}</div></div>
            <div><span style={{ color: '#888', fontSize: 11 }}>Pending merges</span><div style={{ fontFamily: 'monospace', color: planned.length > 0 ? '#DC2626' : '#888' }}>{planned.length}</div></div>
          </div>

          <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
            {groupList.map(([gid, g]) => {
              const splitWarn = g.members.some((m) => SPLIT_HINT_RE.test(m.class))
              return (
                <div key={gid} style={card} data-testid={`cleanup-class-group-${gid}`}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <input
                      data-testid={`cleanup-class-canonical-${gid}`}
                      value={g.canonical}
                      onChange={(e) => setCanonical(gid, e.target.value)}
                      placeholder='Canonical label'
                      style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 14, fontWeight: 600, outline: 'none', flex: 1 }}
                    />
                    <span style={{ fontSize: 11, color: '#888' }}>{g.members.length} variant{g.members.length === 1 ? '' : 's'} · {g.members.reduce((s, m) => s + m.driver_count, 0)} entries</span>
                  </div>
                  {splitWarn && (
                    <div style={{ color: '#D97706', fontSize: 11, marginBottom: 8 }}>
                      ⚠️ A label contains "/", "+", or "and" — may be a multi-class collapse needing a split (this wizard merges only).
                    </div>
                  )}
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                    {g.members.map((m) => {
                      const isCanon = m.class === g.canonical.trim()
                      return (
                        <li key={m.class} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#F5F5F5', padding: '4px 8px', background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4 }}>
                          <span style={{ flex: 1 }}>{m.class}</span>
                          {isCanon && <span style={{ fontSize: 10, color: '#16A34A', background: '#16A34A20', border: '1px solid #16A34A40', padding: '1px 6px', borderRadius: 3 }}>CANONICAL</span>}
                          <span style={{ fontSize: 11, color: '#888' }}>{m.driver_count}</span>
                          <button type='button' onClick={() => splitOff(gid, m.class)} disabled={g.members.length <= 1}
                            style={{ background: 'none', border: '1px solid #2A2A2A', color: g.members.length <= 1 ? '#444' : '#F5F5F5', cursor: g.members.length <= 1 ? 'not-allowed' : 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
                            title='Split this variant into its own group'
                          >Split</button>
                          <select
                            value=''
                            onChange={(e) => { if (e.target.value) moveMember(gid, m.class, e.target.value) }}
                            disabled={groupList.length <= 1}
                            style={{ background: '#141414', border: '1px solid #2A2A2A', color: '#F5F5F5', fontSize: 11, padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
                          >
                            <option value=''>Move to…</option>
                            {groupList.filter(([oid]) => oid !== gid).map(([oid, og]) => (
                              <option key={oid} value={oid}>{og.canonical || '(unset)'}</option>
                            ))}
                          </select>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>

          <button type='button' data-testid='cleanup-classes-merge'
            onClick={apply} disabled={submitting || planned.length === 0}
            style={{
              background: submitting || planned.length === 0 ? '#3a1010' : '#DC2626',
              border: 'none', color: '#F5F5F5',
              cursor: submitting || planned.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: 13, padding: '10px 20px', borderRadius: 4, fontWeight: 600,
            }}
          >
            {submitting ? 'Applying…' : `Apply ${planned.length} merge${planned.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </div>
  )
}

// Auto-group variants by name similarity. Top variant by driver_count
// per group is the seed canonical. Threshold 70 keeps "BMW RDS E46" and
// "BMW Nexen Tyre E46" together while not over-merging unrelated names.
function autoGroup(rows: ClassRow[]): Record<string, VariantGroup> {
  const groups: Record<string, VariantGroup> = {}
  const sorted = [...rows].sort((a, b) => b.driver_count - a.driver_count)
  for (const r of sorted) {
    let placed = false
    for (const [gid, g] of Object.entries(groups)) {
      if (nameScore(r.class, g.canonical) >= 70) {
        groups[gid] = { ...g, members: [...g.members, r] }
        placed = true
        break
      }
    }
    if (!placed) {
      const gid = `g_${Object.keys(groups).length}`
      groups[gid] = { canonical: r.class, members: [r] }
    }
  }
  return groups
}
