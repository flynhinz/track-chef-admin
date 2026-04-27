// [EPIC-211] Series Seeder — status polling (admin portal port).
// Polls the job every 10s, fires the next discover tick on each
// refresh while status === 'discovering'. Auto-routes to /review when
// staged or /complete when imported.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { styles, tokens, badge } from './seederStyles'

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
  staged_data: { candidates_total?: number; candidates_processed?: number } | null
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

  const total = job.staged_data?.candidates_total ?? 0
  const processed = job.staged_data?.candidates_processed ?? 0
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0

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
      </div>
    </div>
  )
}
