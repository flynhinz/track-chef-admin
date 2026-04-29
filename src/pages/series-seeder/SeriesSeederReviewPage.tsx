// [EPIC-211] Series Seeder — review page (admin portal port).
// Coordinator toggles events in/out, picks an action per driver
// (create / skip / link), then confirms the import. On confirm we
// push admin_decisions + flip status to 'importing', fire
// action='import', and redirect to the status page.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { styles, tokens, badge } from './seederStyles'

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

export default function SeriesSeederReviewPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const nav = useNavigate()

  const [job, setJob] = useState<JobRow | null>(null)
  const [existingEntries, setExistingEntries] = useState<ExistingEntry[]>([])
  const [eventInclude, setEventInclude] = useState<Record<string, boolean>>({})
  const [driverActions, setDriverActions] = useState<Record<string, { action: DriverAction; link_to_entry_id?: string }>>({})
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
  // exist on the coordinator's *current* series in the same tenant. The
  // picker label includes the source series so it's clear what we link.
  useEffect(() => {
    if (!jobId) return
    void (async () => {
      const { data, error } = await (supabase as any).from('series_import_jobs').select('*').eq('id', jobId).single()
      if (error) { console.error('[seeder] review load', error); return }
      setJob(data as JobRow)
      const targetTenantId = (data as JobRow).target_tenant_id
      if (targetTenantId) {
        const { data: ents, error: entsErr } = await (supabase as any)
          .from('series_entries')
          .select('id, driver_name, race_number, speedhive_transponder, series_id, series:series_id(name, season)')
          .eq('tenant_id', targetTenantId)
          .eq('is_active', true)
        if (entsErr) console.error('[seeder] series_entries load', entsErr)
        const flattened: ExistingEntry[] = (ents ?? []).map((r: any) => ({
          id: r.id,
          driver_name: r.driver_name,
          race_number: r.race_number,
          speedhive_transponder: r.speedhive_transponder,
          series_id: r.series_id,
          series_name: r.series?.name ?? null,
          series_season: r.series?.season ?? null,
        }))
        setExistingEntries(flattened)
      }
    })()
  }, [jobId])

  const stagedEvents = useMemo<StagedEvent[]>(() => job?.staged_data?.events ?? [], [job])

  // Initialise toggles + per-driver default actions exactly once after
  // both the job + existing-entries lookup have resolved.
  useEffect(() => {
    if (initialised) return
    if (!stagedEvents.length) return
    const ev: Record<string, boolean> = {}
    const drv: Record<string, { action: DriverAction; link_to_entry_id?: string }> = {}
    // [BUG-513] Prefer same-series matches before falling back tenant-wide,
    // so a backfill into a new series still links to the *current*-series
    // entry when one exists.
    const targetSeriesId = job?.target_series_id ?? null
    const sameSeries = targetSeriesId ? existingEntries.filter((x) => x.series_id === targetSeriesId) : []
    const tieredFind = (pred: (x: ExistingEntry) => boolean): ExistingEntry | undefined =>
      sameSeries.find(pred) ?? existingEntries.find(pred)
    for (const e of stagedEvents) {
      ev[String(e.speedhive_event_id)] = true
      for (const d of e.drivers) {
        let auto: { action: DriverAction; link_to_entry_id?: string } = { action: 'create' }
        if (existingEntries.length > 0) {
          const byTp = d.transponder
            ? tieredFind((x) => !!x.speedhive_transponder && x.speedhive_transponder === d.transponder)
            : undefined
          if (byTp) auto = { action: 'link', link_to_entry_id: byTp.id }
          else {
            const byNum = d.race_number
              ? tieredFind((x) => x.race_number === d.race_number)
              : undefined
            if (byNum) auto = { action: 'link', link_to_entry_id: byNum.id }
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
            const cur = driverActions[d.key] ?? { action: 'create' as DriverAction }
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
                </div>
                <select
                  data-testid={`seeder-driver-action-${d.key}`}
                  value={cur.action}
                  onChange={(e) => {
                    const v = e.target.value as DriverAction
                    setDriverActions((prev) => ({
                      ...prev,
                      [d.key]: { action: v, link_to_entry_id: v === 'link' ? prev[d.key]?.link_to_entry_id : undefined },
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
                        [d.key]: { action: 'link', link_to_entry_id: e.target.value },
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
