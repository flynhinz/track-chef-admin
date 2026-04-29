// [EPIC-211] Series Seeder — review page (admin portal port).
// Coordinator toggles events in/out, picks an action per driver
// (create / skip / link), then confirms the import. On confirm we
// push admin_decisions + flip status to 'importing', fire
// action='import', and redirect to the status page.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { styles, tokens, badge } from './seederStyles'
// [BUG-515] Fuzzy fallback when transponder + race-number don't match —
// catches "Stephanie Chambers" vs "Steph Chambers" / "Smith" vs "Smyth"
// cases that previously created duplicate driver entries.
import { nameScore } from '../../lib/fuzzy'

interface StagedSession {
  speedhive_session_id: number
  speedhive_session_name: string
  speedhive_session_type: string
  start_time: string
  label: string | null
  driver_count: number
}
interface StagedDriver {
  key: string
  name: string
  race_number: string | null
  transponder: string | null
  class: string | null
}
interface StagedEvent {
  speedhive_event_id: number
  speedhive_event_name: string
  speedhive_group_name: string
  start_date: string
  location_name: string | null
  sessions: StagedSession[]
  drivers: StagedDriver[]
}
interface JobRow {
  id: string
  status: string
  series_name: string
  target_series_id: string | null
  target_tenant_id: string
  staged_data: { events?: StagedEvent[] } | null
}
interface ExistingEntry {
  id: string
  driver_name: string | null
  race_number: string | null
  speedhive_transponder: string | null
  // [BUG-513] Link source series so the picker can show which series an
  // existing entry came from when we widen the lookup tenant-wide.
  series_id: string | null
  series_name: string | null
  series_season: string | null
}

type DriverAction = 'create' | 'skip' | 'link'
type MatchReason = 'transponder' | 'race_number' | 'name' | 'manual' | null
interface DriverDecision {
  action: DriverAction
  link_to_entry_id?: string
  // [BUG-515] What we matched on + how confident — surfaced in the
  // row UI and persisted in admin_decisions for the EF to log.
  match_reason?: MatchReason
  match_score?: number
}

export default function SeriesSeederReviewPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const nav = useNavigate()

  const [job, setJob] = useState<JobRow | null>(null)
  const [existingEntries, setExistingEntries] = useState<ExistingEntry[]>([])
  const [eventInclude, setEventInclude] = useState<Record<string, boolean>>({})
  const [driverActions, setDriverActions] = useState<Record<string, DriverDecision>>({})
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [authedUserId, setAuthedUserId] = useState<string | null>(null)
  const [initialised, setInitialised] = useState(false)

  // Capture caller for confirmed_by.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setAuthedUserId(data.session?.user.id ?? null))
  }, [])

  // Job + existing entries.
  // [BUG-513] Look up existing entries across the coordinator's whole
  // tenant — not just the target series. A backfill / new-season import
  // typically seeds into an empty series, but the same drivers already
  // exist on the coordinator's *current* series in the same tenant.
  // [BUG-516] Fetch series_entries + series in two plain queries and
  // join client-side. The previous embedded-relation syntax
  // ("series:series_id(name, season)") was 400-ing through PostgREST,
  // which left existingEntries silently empty — every staged driver
  // then fell through to "Create new entry" even when transponders
  // matched exactly. Separate queries always work.
  useEffect(() => {
    if (!jobId) return
    void (async () => {
      const { data, error } = await (supabase as any).from('series_import_jobs').select('*').eq('id', jobId).single()
      if (error) { console.error('[seeder] review load', error); return }
      setJob(data as JobRow)
      const targetTenantId = (data as JobRow).target_tenant_id
      if (!targetTenantId) return
      const [{ data: ents, error: entsErr }, { data: srs, error: srsErr }] = await Promise.all([
        (supabase as any)
          .from('series_entries')
          .select('id, driver_name, race_number, speedhive_transponder, series_id')
          .eq('tenant_id', targetTenantId)
          .eq('is_active', true),
        (supabase as any)
          .from('series')
          .select('id, name, season')
          .eq('tenant_id', targetTenantId),
      ])
      if (entsErr) console.error('[seeder] series_entries load', entsErr)
      if (srsErr) console.error('[seeder] series load', srsErr)
      const seriesById = new Map<string, { name: string | null; season: string | null }>(
        ((srs ?? []) as { id: string; name: string | null; season: string | null }[]).map(
          (s) => [s.id, { name: s.name, season: s.season }],
        ),
      )
      const flattened: ExistingEntry[] = (ents ?? []).map((r: any) => {
        const s = r.series_id ? seriesById.get(r.series_id) : undefined
        return {
          id: r.id,
          driver_name: r.driver_name,
          race_number: r.race_number,
          speedhive_transponder: r.speedhive_transponder,
          series_id: r.series_id,
          series_name: s?.name ?? null,
          series_season: s?.season ?? null,
        }
      })
      console.info(`[seeder] loaded ${flattened.length} existing entries for tenant ${targetTenantId}`)
      setExistingEntries(flattened)
    })()
  }, [jobId])

  const stagedEvents = useMemo<StagedEvent[]>(() => job?.staged_data?.events ?? [], [job])

  // Initialise toggles + per-driver default actions exactly once after
  // both the job + existing-entries lookup have resolved.
  useEffect(() => {
    if (initialised) return
    if (!stagedEvents.length) return
    const ev: Record<string, boolean> = {}
    const drv: Record<string, DriverDecision> = {}
    // [BUG-513] Prefer same-series matches before falling back tenant-wide,
    // so a backfill into a new series still links to the *current*-series
    // entry when one exists.
    const targetSeriesId = job?.target_series_id ?? null
    const sameSeries = targetSeriesId ? existingEntries.filter((x) => x.series_id === targetSeriesId) : []
    const tieredFind = (pred: (x: ExistingEntry) => boolean): ExistingEntry | undefined =>
      sameSeries.find(pred) ?? existingEntries.find(pred)
    // [BUG-515] Tiered fuzzy fallback after exact tp/race_number tries.
    // Walk every existing entry, compute nameScore, prefer same-series
    // when scores tie. Auto-link at >=75; if 60-74 still link but mark
    // as 'manual' so the coordinator visually reviews.
    const bestNameMatch = (incoming: string): { entry: ExistingEntry; score: number } | null => {
      if (!incoming.trim()) return null
      let best: { entry: ExistingEntry; score: number; sameSeries: boolean } | null = null
      for (const x of existingEntries) {
        if (!x.driver_name) continue
        const score = nameScore(incoming, x.driver_name)
        const isSame = !!targetSeriesId && x.series_id === targetSeriesId
        if (
          !best ||
          score > best.score ||
          (score === best.score && isSame && !best.sameSeries)
        ) {
          best = { entry: x, score, sameSeries: isSame }
        }
      }
      return best && best.score >= 60 ? { entry: best.entry, score: best.score } : null
    }
    for (const e of stagedEvents) {
      ev[String(e.speedhive_event_id)] = true
      for (const d of e.drivers) {
        let auto: DriverDecision = { action: 'create' }
        if (existingEntries.length > 0) {
          const byTp = d.transponder
            ? tieredFind((x) => !!x.speedhive_transponder && x.speedhive_transponder === d.transponder)
            : undefined
          if (byTp) auto = { action: 'link', link_to_entry_id: byTp.id, match_reason: 'transponder', match_score: 100 }
          else {
            const byNum = d.race_number
              ? tieredFind((x) => x.race_number === d.race_number)
              : undefined
            if (byNum) auto = { action: 'link', link_to_entry_id: byNum.id, match_reason: 'race_number', match_score: 95 }
            else {
              const byName = bestNameMatch(d.name)
              if (byName && byName.score >= 75) {
                auto = { action: 'link', link_to_entry_id: byName.entry.id, match_reason: 'name', match_score: byName.score }
              } else if (byName) {
                // 60-74 — surface as a hint but keep on 'create' so a
                // wrong fuzzy hit doesn't silently merge. Coordinator
                // sees the suggestion in the row and confirms.
                auto = { action: 'create', match_reason: 'name', match_score: byName.score, link_to_entry_id: byName.entry.id }
              }
            }
          }
        }
        drv[d.key] = auto
      }
    }
    setEventInclude(ev)
    setDriverActions(drv)
    setInitialised(true)
  }, [stagedEvents, existingEntries, initialised, job?.target_series_id])

  const uniqueDrivers = useMemo(() => {
    const map = new Map<string, StagedDriver>()
    for (const e of stagedEvents) for (const d of e.drivers) if (!map.has(d.key)) map.set(d.key, d)
    return Array.from(map.values())
  }, [stagedEvents])

  const counts = useMemo(() => {
    let create = 0, skip = 0, link = 0
    for (const v of Object.values(driverActions)) {
      if (v.action === 'create') create += 1
      else if (v.action === 'skip') skip += 1
      else link += 1
    }
    const includedEvents = Object.values(eventInclude).filter(Boolean).length
    return { create, skip, link, includedEvents }
  }, [driverActions, eventInclude])

  const confirmImport = async () => {
    if (!jobId || !authedUserId) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const decisions = {
        events: Object.fromEntries(Object.entries(eventInclude).map(([k, v]) => [k, { include: v }])),
        drivers: driverActions,
      }
      const { error: upErr } = await (supabase as any)
        .from('series_import_jobs')
        .update({ admin_decisions: decisions, status: 'importing' })
        .eq('id', jobId)
      if (upErr) throw upErr
      void (supabase as any).functions.invoke('sync-speedhive', {
        body: { mode: 'seed_series', action: 'import', job_id: jobId, confirmed_by: authedUserId },
      })
      nav(`/series-seeder/${jobId}`)
    } catch (e) {
      console.error('[seeder] confirm failed', e)
      setErrorMsg((e as Error).message ?? 'Could not start import')
      setSubmitting(false)
    }
  }

  if (!job) return <div style={{ ...styles.page, color: tokens.muted, padding: 40 }}>Loading…</div>

  return (
    <div style={styles.page} data-testid="series-seeder-review">
      <div>
        <h1 style={styles.h1}>{job.series_name}</h1>
        <p style={styles.sub}>Review staged events + drivers, confirm to import.</p>
      </div>

      {errorMsg && <div style={styles.errorBanner}>{errorMsg}</div>}

      {/* Events */}
      <div style={{ ...styles.card, ...styles.section }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: tokens.text, margin: 0 }}>Events ({stagedEvents.length})</h2>
        {stagedEvents.length === 0 && <p style={styles.sub}>No events staged.</p>}
        {stagedEvents.map((e) => {
          const id = String(e.speedhive_event_id)
          const included = eventInclude[id] !== false
          return (
            <div key={id} style={{ ...styles.card, padding: 12 }} data-testid={`seeder-event-${id}`}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={included}
                  onChange={(ev) => setEventInclude((prev) => ({ ...prev, [id]: ev.target.checked }))}
                  data-testid={`seeder-event-toggle-${id}`}
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{e.speedhive_event_name}</span>
                  <br />
                  <span style={{ fontSize: 11, color: tokens.muted }}>
                    {e.start_date.slice(0, 10)} · {e.location_name ?? '—'} · {e.sessions.filter((s) => s.label).length} sessions · {e.drivers.length} drivers
                  </span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {e.sessions.filter((s) => s.label).map((s) => (
                      <span key={s.speedhive_session_id} style={badge('muted')}>
                        {s.label} · {s.driver_count}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            </div>
          )
        })}
      </div>

      {/* Drivers */}
      <div style={{ ...styles.card, ...styles.section }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: tokens.text, margin: 0 }}>Drivers ({uniqueDrivers.length})</h2>
        {uniqueDrivers.length === 0 && <p style={styles.sub}>No drivers found in staged data.</p>}
        <div>
          {uniqueDrivers.map((d) => {
            const cur: DriverDecision = driverActions[d.key] ?? { action: 'create' }
            // [BUG-515] What-we-matched-on hint. The auto-match writes
            // match_reason + match_score even when we didn't auto-link
            // (60-74 fuzzy hits stay on 'create' but surface here so
            // the coordinator can flip to Link with one click).
            const matched = cur.link_to_entry_id
              ? existingEntries.find((x) => x.id === cur.link_to_entry_id)
              : undefined
            const reasonLabel: Record<NonNullable<MatchReason>, string> = {
              transponder: 'transponder match',
              race_number: 'race # match',
              name: 'name match',
              manual: 'manual',
            }
            return (
              <div
                key={d.key}
                data-testid={`seeder-driver-${d.key}`}
                style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.2fr', gap: 8, alignItems: 'center', fontSize: 12, padding: '6px 0', borderBottom: `1px solid ${tokens.border}` }}
              >
                <div>
                  <div style={{ color: tokens.text }}>{d.name}</div>
                  <div style={{ color: tokens.muted, fontSize: 11 }}>
                    #{d.race_number ?? '—'}{d.transponder ? ` · TP ${d.transponder}` : ''}{d.class ? ` · ${d.class}` : ''}
                  </div>
                  {(matched || (cur.match_reason === 'name' && cur.link_to_entry_id)) && cur.match_reason && cur.match_score !== undefined && (
                    <div
                      data-testid={`seeder-driver-match-${d.key}`}
                      style={{ marginTop: 4, fontSize: 11, color: tokens.muted, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                    >
                      <span style={badge(cur.match_score >= 90 ? 'ok' : cur.match_score >= 75 ? 'ok' : 'warn')}>
                        {cur.match_score}%
                      </span>
                      <span>
                        {cur.action === 'link' ? '→ linked to ' : '→ suggested '}
                        <strong style={{ color: tokens.text }}>
                          {matched?.driver_name ?? '—'}
                        </strong>
                        {matched?.race_number ? ` #${matched.race_number}` : ''}
                        {matched?.series_name ? ` — ${matched.series_name}` : ''}
                        {' '}({reasonLabel[cur.match_reason]})
                        {cur.action !== 'link' && cur.match_score >= 60 && (
                          <button
                            type="button"
                            data-testid={`seeder-driver-accept-${d.key}`}
                            onClick={() => setDriverActions((prev) => ({
                              ...prev,
                              [d.key]: { ...prev[d.key], action: 'link', match_reason: prev[d.key]?.match_reason ?? 'manual' },
                            }))}
                            style={{ ...styles.btnGhost, padding: '2px 8px', fontSize: 11, marginLeft: 6 }}
                          >
                            Accept link
                          </button>
                        )}
                      </span>
                    </div>
                  )}
                </div>
                <select
                  data-testid={`seeder-driver-action-${d.key}`}
                  value={cur.action}
                  onChange={(e) => {
                    const v = e.target.value as DriverAction
                    setDriverActions((prev) => ({
                      ...prev,
                      [d.key]: {
                        ...prev[d.key],
                        action: v,
                        link_to_entry_id: v === 'link' ? prev[d.key]?.link_to_entry_id : undefined,
                        match_reason: v === 'link' ? (prev[d.key]?.match_reason ?? 'manual') : prev[d.key]?.match_reason,
                      },
                    }))
                  }}
                  style={{ ...styles.select, padding: '4px 8px' }}
                >
                  <option value="create">Create new entry</option>
                  <option value="skip">Skip</option>
                  <option value="link" disabled={existingEntries.length === 0}>Link to existing</option>
                </select>
                <div>
                  {cur.action === 'link' && (
                    <select
                      data-testid={`seeder-driver-link-${d.key}`}
                      value={cur.link_to_entry_id ?? ''}
                      onChange={(e) => setDriverActions((prev) => ({
                        ...prev,
                        [d.key]: { ...prev[d.key], action: 'link', link_to_entry_id: e.target.value, match_reason: 'manual' },
                      }))}
                      style={{ ...styles.select, padding: '4px 8px' }}
                    >
                      <option value="">Pick entry…</option>
                      {existingEntries.map((x) => {
                        // [BUG-513] Show source series so coordinator can tell
                        // which season's entry they're linking against.
                        const seriesLabel = x.series_name
                          ? ` — ${x.series_name}${x.series_season ? ` ${x.series_season}` : ''}`
                          : ''
                        return (
                          <option key={x.id} value={x.id}>
                            {x.driver_name ?? '—'} #{x.race_number ?? '—'}{seriesLabel}
                          </option>
                        )
                      })}
                    </select>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Summary + actions */}
      <div
        style={{ ...styles.card, position: 'sticky', bottom: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
        data-testid="seeder-summary"
      >
        <div style={{ fontSize: 12, color: tokens.muted }}>
          {counts.includedEvents} event{counts.includedEvents === 1 ? '' : 's'} ·{' '}
          {counts.create} new · {counts.link} linked · {counts.skip} skipped
        </div>
        <div style={styles.row}>
          <button type="button" data-testid="seeder-cancel" onClick={() => nav('/series-seeder')} style={styles.btnGhost}>Cancel</button>
          <button
            type="button"
            data-testid="seeder-confirm"
            onClick={confirmImport}
            disabled={submitting}
            style={{ ...styles.btn, ...(submitting ? styles.btnDisabled : {}) }}
          >
            {submitting ? 'Starting…' : 'Confirm import'}
          </button>
        </div>
      </div>
    </div>
  )
}
