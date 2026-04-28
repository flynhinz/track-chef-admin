// [EPIC-211] Series Seeder — status polling (admin portal port).
// Polls the job every 10s, fires the next discover tick on each
// refresh while status === 'discovering'. Auto-routes to /review when
// staged or /complete when imported.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { styles, tokens, badge } from './seederStyles'

// [BUG-447] One trace row per probed candidate. Mirrors the EF
// TraceRow shape; see supabase/functions/sync-speedhive/index.ts.
interface TraceRow {
  event_id: number
  event_name: string
  start_date: string
  year_month: string
  location: string | null
  sh_groups_seen: string[]
  status: 'match' | 'partial' | 'skipped' | 'error'
  matched_groups: string[]
  reason: string
  manual?: boolean
}

interface JobRow {
  id: string
  status: string
  series_name: string
  speedhive_group_name: string
  date_from: string
  date_to: string
  events_found: number | null
  sessions_found: number | null
  results_found: number | null
  drivers_found: number | null
  error_message: string | null
  staged_data: {
    candidates_total?: number
    candidates_processed?: number
    selected_group_names?: string[]
    trace?: TraceRow[]
    // [BUG-453] Import-phase progress, written by seedImport after
    // each event so the Status page can show a live progress bar
    // during status='importing'.
    import_total?: number
    import_processed?: number
    import_results_so_far?: number
    import_drivers_so_far?: number
    import_current_event_name?: string
  } | null
}

const POLL_MS = 10_000

export default function SeriesSeederStatusPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const nav = useNavigate()
  const [job, setJob] = useState<JobRow | null>(null)
  const [tickError, setTickError] = useState<string | null>(null)
  const tickingRef = useRef(false)

  useEffect(() => {
    if (!jobId) return
    let cancelled = false

    const load = async () => {
      const { data, error } = await (supabase as any)
        .from('series_import_jobs')
        .select('*')
        .eq('id', jobId)
        .single()
      if (cancelled) return
      if (error) {
        console.error('[seeder] status load failed', error)
        return
      }
      setJob(data as JobRow)
    }

    void load()
    const t = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [jobId])

  // Auto-route + drive next discover tick.
  useEffect(() => {
    if (!job || !jobId) return
    if (job.status === 'staged') { nav(`/series-seeder/${jobId}/review`, { replace: true }); return }
    if (job.status === 'complete') { nav(`/series-seeder/${jobId}/complete`, { replace: true }); return }
    if (job.status === 'discovering' && !tickingRef.current) {
      tickingRef.current = true
      void (supabase as any).functions
        .invoke('sync-speedhive', { body: { mode: 'seed_series', action: 'discover', job_id: jobId } })
        .then(({ error }: { error: { message?: string } | null }) => {
          if (error) setTickError(error.message ?? 'Tick failed')
        })
        .catch((e: Error) => {
          console.error('[seeder] tick failed', e)
          setTickError(e.message)
        })
        .finally(() => { tickingRef.current = false })
    }
  }, [job, jobId, nav])

  const retry = async () => {
    if (!jobId) return
    setTickError(null)
    await (supabase as any).from('series_import_jobs')
      .update({ status: 'discovering', error_message: null })
      .eq('id', jobId)
    void (supabase as any).functions.invoke('sync-speedhive', {
      body: { mode: 'seed_series', action: 'discover', job_id: jobId },
    })
  }

  if (!job) {
    return <div style={{ ...styles.page, color: tokens.muted, padding: 40 }}>Loading…</div>
  }

  // [BUG-453] During status='importing' we show import progress
  // (events imported / total) instead of the discover progress.
  const isImporting = job.status === 'importing'
  const total = isImporting
    ? (job.staged_data?.import_total ?? 0)
    : (job.staged_data?.candidates_total ?? 0)
  const processed = isImporting
    ? (job.staged_data?.import_processed ?? 0)
    : (job.staged_data?.candidates_processed ?? 0)
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0
  const currentEventName = isImporting ? job.staged_data?.import_current_event_name : null

  return (
    <div style={styles.page} data-testid="series-seeder-status">
      <div>
        <h1 style={styles.h1}>{job.series_name}</h1>
        <p style={styles.sub}>{job.speedhive_group_name} · {job.date_from} → {job.date_to}</p>
      </div>

      <div style={{ ...styles.card, ...styles.section }} data-testid="seeder-status-card">
        <div style={styles.row}>
          <span
            style={badge(job.status === 'failed' ? 'warn' : 'accent')}
            data-testid="seeder-status-badge"
          >
            {job.status}
          </span>
          {total > 0 && (
            <span style={{ fontSize: 11, color: tokens.muted }}>
              {processed} of {total} events ({pct}%)
              {isImporting && currentEventName && ` · ${currentEventName}`}
            </span>
          )}
        </div>

        {total > 0 && (
          <div
            style={{ height: 6, width: '100%', borderRadius: 999, background: tokens.bg, overflow: 'hidden' }}
            data-testid="seeder-progress"
          >
            <div style={{ height: '100%', width: `${pct}%`, background: tokens.accent, transition: 'width 200ms ease' }} />
          </div>
        )}

        <div style={{ fontSize: 13, color: tokens.text }} data-testid="seeder-counts">
          {job.events_found ?? 0} events · {job.drivers_found ?? 0} drivers ·{' '}
          {job.results_found ?? 0} results found
        </div>

        {(job.status === 'failed' || tickError) && (
          <div style={styles.section}>
            <div style={styles.errorBanner} data-testid="seeder-error">
              {job.error_message ?? tickError}
            </div>
            <button type="button" data-testid="seeder-retry" onClick={retry} style={styles.btn}>Retry</button>
          </div>
        )}

        {job.status === 'discovering' && (
          <p style={{ ...styles.sub, marginTop: 0 }}>Auto-refreshing every {POLL_MS / 1000}s — leave this page open or come back later.</p>
        )}
        {isImporting && (
          <p style={{ ...styles.sub, marginTop: 0 }}>
            Importing into the target series — creating events, sessions, results, and recalculating standings.
            {' '}Auto-refreshing every {POLL_MS / 1000}s; the page jumps to a summary when done.
          </p>
        )}
      </div>

      {/* [BUG-447] Verbose trace, grouped by month. One row per probed
          event with status badge + the SH groups Speedhive returned.
          For skipped/partial rows the user can pick missing groups
          inline and POST manual_match. */}
      <DiscoveryTrace
        jobId={job.id}
        trace={job.staged_data?.trace ?? []}
        selectedGroupNames={job.staged_data?.selected_group_names ?? []}
      />
    </div>
  )
}

// [BUG-447] Verbose trace renderer. Groups by year_month, latest
// month first. Each row shows event date · name · location · status
// badge · matched-or-seen groups. Skipped/partial rows expose a
// "Match manually" button that opens an inline checkbox list of the
// SH groups that event actually had — ticking + Stage POSTs
// manual_match to the EF.
function DiscoveryTrace({
  jobId,
  trace,
  selectedGroupNames,
}: {
  jobId: string
  trace: TraceRow[]
  selectedGroupNames: string[]
}) {
  // Local UI state — which months are expanded (default: latest only),
  // which event_id has its manual-match panel open, and which group
  // names are ticked inside that panel.
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({})
  const [openManualEvent, setOpenManualEvent] = useState<number | null>(null)
  const [manualPicks, setManualPicks] = useState<string[]>([])
  const [busyEventId, setBusyEventId] = useState<number | null>(null)
  const [manualError, setManualError] = useState<string | null>(null)

  if (trace.length === 0) return null

  // Group by year_month, then sort each group by start_date desc.
  const byMonth = new Map<string, TraceRow[]>()
  for (const t of trace) {
    const k = t.year_month || 'unknown'
    if (!byMonth.has(k)) byMonth.set(k, [])
    byMonth.get(k)!.push(t)
  }
  for (const rows of byMonth.values()) {
    rows.sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
  }
  const months = Array.from(byMonth.keys()).sort((a, b) => b.localeCompare(a))

  const counts = trace.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  const toggleMonth = (k: string) =>
    setOpenMonths((prev) => ({ ...prev, [k]: !(prev[k] ?? k === months[0]) }))

  const openManual = (row: TraceRow) => {
    setOpenManualEvent(row.event_id)
    // Pre-tick anything from the selected list that DID appear in this
    // event's SH groups but somehow didn't match (defensive — should
    // be empty for skipped, useful for partial).
    const seenLower = row.sh_groups_seen.map((s) => s.toLowerCase())
    const preTick = selectedGroupNames.filter((n) => seenLower.includes(n.toLowerCase()))
    setManualPicks(preTick)
    setManualError(null)
  }

  const submitManual = async (row: TraceRow) => {
    if (manualPicks.length === 0) {
      setManualError('Pick at least one group')
      return
    }
    setBusyEventId(row.event_id)
    setManualError(null)
    try {
      const { error } = await (supabase as any).functions.invoke('sync-speedhive', {
        body: {
          mode: 'seed_series',
          action: 'manual_match',
          job_id: jobId,
          event_id: row.event_id,
          group_names: manualPicks,
        },
      })
      if (error) throw error
      setOpenManualEvent(null)
      setManualPicks([])
    } catch (e) {
      setManualError((e as Error).message ?? 'Manual match failed')
    } finally {
      setBusyEventId(null)
    }
  }

  return (
    <div style={{ ...styles.card, ...styles.section }} data-testid="seeder-trace">
      <div style={styles.row}>
        <strong style={{ fontSize: 13 }}>Discovery log</strong>
        <span style={{ fontSize: 11, color: tokens.muted }}>
          {counts.match ?? 0} match · {counts.partial ?? 0} partial · {counts.skipped ?? 0} skipped
          {counts.error ? ` · ${counts.error} error` : ''}
        </span>
      </div>

      {months.map((ym) => {
        const rows = byMonth.get(ym)!
        const isOpen = openMonths[ym] ?? ym === months[0]
        const monthMatch = rows.filter((r) => r.status === 'match' || r.status === 'partial').length
        return (
          <div key={ym} data-testid={`seeder-trace-month-${ym}`}>
            <button
              type="button"
              onClick={() => toggleMonth(ym)}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 10px',
                background: 'transparent', border: `1px solid ${tokens.border}`,
                borderRadius: 6, color: tokens.text, cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 12 }}>{isOpen ? '▾' : '▸'} {ym}</span>
              <span style={{ fontSize: 11, color: tokens.muted }}>
                {rows.length} probed · {monthMatch} matched
              </span>
            </button>
            {isOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {rows.map((row) => {
                  const variant: 'ok' | 'warn' | 'muted' =
                    row.status === 'match' ? 'ok' :
                    row.status === 'partial' ? 'warn' :
                    'muted'
                  return (
                    <div
                      key={`${row.event_id}-${row.start_date}`}
                      data-testid={`seeder-trace-row-${row.event_id}`}
                      style={{
                        padding: '6px 10px', borderRadius: 6,
                        border: `1px solid ${tokens.border}`,
                        display: 'flex', flexDirection: 'column', gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: tokens.muted, minWidth: 80 }}>{row.start_date}</span>
                        <span style={{ fontSize: 12, color: tokens.text, flex: 1, minWidth: 200 }}>
                          {row.event_name}
                          {row.location && <span style={{ color: tokens.muted }}> · {row.location}</span>}
                        </span>
                        <span style={badge(variant)}>{row.status}{row.manual ? ' · manual' : ''}</span>
                      </div>
                      <div style={{ fontSize: 11, color: tokens.muted, paddingLeft: 88 }}>
                        {row.matched_groups.length > 0
                          ? `Matched: ${row.matched_groups.join(', ')}`
                          : row.sh_groups_seen.length > 0
                            ? `Saw: ${row.sh_groups_seen.join(' · ')}`
                            : row.reason}
                      </div>
                      {(row.status === 'skipped' || row.status === 'partial' || row.status === 'error') && (
                        <div style={{ paddingLeft: 88 }}>
                          {openManualEvent === row.event_id ? (
                            <div style={{
                              padding: 8, marginTop: 4, borderRadius: 4,
                              background: 'rgba(220,38,38,0.05)',
                              border: `1px solid ${tokens.border}`,
                              display: 'flex', flexDirection: 'column', gap: 6,
                            }}>
                              <span style={{ fontSize: 11, color: tokens.muted }}>
                                Tick the group(s) to attach for this event:
                              </span>
                              {row.sh_groups_seen.length === 0 ? (
                                <span style={{ fontSize: 11, color: tokens.muted }}>
                                  Speedhive returned no groups for this event — nothing to attach.
                                </span>
                              ) : (
                                row.sh_groups_seen.map((g) => {
                                  const checked = manualPicks.includes(g)
                                  return (
                                    <label key={g} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          if (e.target.checked) setManualPicks((prev) => Array.from(new Set([...prev, g])))
                                          else setManualPicks((prev) => prev.filter((n) => n !== g))
                                        }}
                                      />
                                      <span style={{ color: tokens.text }}>{g}</span>
                                    </label>
                                  )
                                })
                              )}
                              {manualError && <span style={{ fontSize: 11, color: tokens.warn ?? '#DC2626' }}>{manualError}</span>}
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  onClick={() => submitManual(row)}
                                  disabled={busyEventId === row.event_id || row.sh_groups_seen.length === 0}
                                  data-testid={`seeder-manual-stage-${row.event_id}`}
                                  style={{ ...styles.btn, ...((busyEventId === row.event_id || row.sh_groups_seen.length === 0) ? styles.btnDisabled : {}), padding: '4px 10px', fontSize: 12 }}
                                >
                                  {busyEventId === row.event_id ? 'Staging…' : 'Stage'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setOpenManualEvent(null); setManualPicks([]); setManualError(null) }}
                                  style={{ ...styles.btnGhost, padding: '4px 10px', fontSize: 12 }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openManual(row)}
                              data-testid={`seeder-manual-open-${row.event_id}`}
                              style={{ ...styles.btnGhost, padding: '2px 8px', fontSize: 11, marginTop: 2 }}
                            >
                              Match manually
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
