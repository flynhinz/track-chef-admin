// [EPIC-211] Series Seeder — completion page (admin portal port).

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { styles, tokens } from './seederStyles'

interface JobRow {
  id: string
  status: string
  series_name: string
  target_series_id: string | null
  events_found: number | null
  drivers_found: number | null
  results_found: number | null
  error_message: string | null
}

export default function SeriesSeederCompletePage() {
  const { jobId } = useParams<{ jobId: string }>()
  const nav = useNavigate()
  const [job, setJob] = useState<JobRow | null>(null)

  useEffect(() => {
    if (!jobId) return
    void (async () => {
      const { data, error } = await (supabase as any).from('series_import_jobs').select('*').eq('id', jobId).single()
      if (error) { console.error('[seeder] complete load', error); return }
      setJob(data as JobRow)
    })()
  }, [jobId])

  if (!job) return <div style={{ ...styles.page, color: tokens.muted, padding: 40 }}>Loading…</div>

  return (
    <div style={styles.page} data-testid="series-seeder-complete">
      <div style={{ ...styles.card, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, padding: 32 }}>
        <div style={{ fontSize: 32 }}>✅</div>
        <h1 style={styles.h1}>{job.series_name} imported</h1>
        <p style={styles.sub}>
          {job.events_found ?? 0} events · {job.drivers_found ?? 0} drivers ·{' '}
          {job.results_found ?? 0} results · standings recalculated
        </p>
        {job.error_message && (
          <div style={styles.errorBanner} data-testid="seeder-complete-warnings">
            Warnings: {job.error_message}
          </div>
        )}
        <div style={{ ...styles.row, justifyContent: 'center', marginTop: 8 }}>
          <button
            type="button"
            data-testid="seeder-run-another"
            onClick={() => nav('/series-seeder')}
            style={styles.btnGhost}
          >
            Run another
          </button>
        </div>
      </div>
    </div>
  )
}
