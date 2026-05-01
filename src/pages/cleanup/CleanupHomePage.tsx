// [EPIC-240] Cleanup wizard landing — all 8 steps, ordered in the
// recommended workflow sequence (1 → 2 → 7 → 8 → 6 → 3 → 5 → 4).
// Series picker at the top drives a status check per card so the page
// reads as a health dashboard for the chosen series.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../../lib/adminApi'
import SeriesPicker from './SeriesPicker'
import { assertUuid } from '../../lib/cleanupSql'
import { nameScore } from '../../lib/fuzzy'

interface StepCard {
  step: number
  path: string
  title: string
  what: string
  why: string
}

// Workflow order, NOT step number order.
const STEPS: StepCard[] = [
  {
    step: 1,
    path: '/cleanup/deduplicate-series',
    title: 'Deduplicate series',
    what: 'Pick the duplicate row + the canonical row, re-point children, delete the dupe.',
    why: 'Speedhive can import the same series twice under slightly different names — this collapses them.',
  },
  {
    step: 2,
    path: '/cleanup/normalise-classes',
    title: 'Normalise classes',
    what: 'Auto-group variant class names per series and merge into one canonical label per group.',
    why: 'Speedhive ships variants ("BMW RDS E46" vs "BMW Nexen Tyre E46"). Step 7 promotes whatever lands here.',
  },
  {
    step: 7,
    path: '/cleanup/series-classes',
    title: 'Seed series_classes',
    what: 'Promote distinct series_entries.class values into the canonical class list with sort order.',
    why: 'Empty series_classes → class picker scrapes series_entries and may leak labels from other series (CLEANUP-01 / BUG-564).',
  },
  {
    step: 8,
    path: '/cleanup/event-names',
    title: 'Standardise event names',
    what: 'Group events by class, set a consistent suffix per group (e.g. "{venue} · {class label}").',
    why: 'Speedhive event names vary per venue/round even for the same grid — see BMW E46 example in addendum.',
  },
  {
    step: 6,
    path: '/cleanup/round-numbers',
    title: 'Set round numbers',
    what: 'Group events by start_date, type a round number per weekend, apply.',
    why: 'Speedhive imports leave round_number = null. GTRNZ / Mazda / Formula First are all in this state.',
  },
  {
    step: 3,
    path: '/cleanup/link-circuits',
    title: 'Link circuits',
    what: 'Map each event to a circuits row via fuzzy match on venue text.',
    why: 'Driver-mode features (PB walls, circuit history, weather) all key off circuit_id — empty after a fresh import.',
  },
  {
    step: 5,
    path: '/cleanup/email-completeness',
    title: 'Email completeness',
    what: 'Audit series_entries for missing emails, edit inline, export CSV for the coordinator.',
    why: 'Bulk send-driver-invite is gated on a clean email column.',
  },
  {
    step: 4,
    path: '/cleanup/mark-finalised',
    title: 'Mark results as Finalised',
    what: 'Bulk-promote race_results from provisional → finalised so points and standings calculate.',
    why: 'Last step — runs after every other field is stable so points don\'t shift again.',
  },
]

type StatusKind = 'ok' | 'warn' | 'unknown'
interface StepStatus { kind: StatusKind; label: string }
type StatusMap = Record<number, StepStatus>

const UNKNOWN: StepStatus = { kind: 'unknown', label: '—' }

export default function CleanupHomePage() {
  const nav = useNavigate()
  const [seriesId, setSeriesId] = useState('')
  const [statuses, setStatuses] = useState<StatusMap>({})
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  useEffect(() => {
    if (!seriesId) { setStatuses({}); return }
    setStatusLoading(true)
    setStatusError(null)
    runStatusChecks(seriesId)
      .then(setStatuses)
      .catch((e) => setStatusError((e as Error).message ?? 'Status check failed'))
      .finally(() => setStatusLoading(false))
  }, [seriesId])

  const statusFor = (step: number): StepStatus => statuses[step] ?? UNKNOWN

  return (
    <div data-testid='cleanup-home'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Series Cleanup</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
        Steps that run after a Speedhive import to bring a fresh series up to coordinator-ready state.
      </p>
      <p style={{ color: '#666', fontSize: 12, marginBottom: 16 }}>
        Recommended order (cards below are in this sequence): <code style={{ color: '#F5F5F5' }}>1 → 2 → 7 → 8 → 6 → 3 → 5 → 4</code>.
        Each step is independently runnable — re-run any one without repeating the others.
      </p>

      <div style={{ marginBottom: 16 }}>
        <SeriesPicker value={seriesId} onChange={(id) => setSeriesId(id)} testId='cleanup-home-picker' />
        {statusLoading && <div style={{ fontSize: 11, color: '#888' }}>Checking series health…</div>}
        {statusError && <div style={{ fontSize: 11, color: '#DC2626' }}>{statusError}</div>}
        {!seriesId && <div style={{ fontSize: 11, color: '#888' }}>Pick a series above to see step health.</div>}
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {STEPS.map((s) => (
          <button
            key={s.step}
            type='button'
            data-testid={`cleanup-card-${s.step}`}
            onClick={() => nav(s.path)}
            style={{
              textAlign: 'left',
              background: '#141414',
              border: '1px solid #2A2A2A',
              borderRadius: 8,
              padding: 20,
              cursor: 'pointer',
              color: '#F5F5F5',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 11, color: '#DC2626', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Step {s.step}
              </div>
              <StatusPill status={statusFor(s.step)} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: '#F5F5F5', marginBottom: 8 }}>{s.what}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{s.why}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: StepStatus }) {
  const style: React.CSSProperties = (() => {
    if (status.kind === 'ok')   return { color: '#16A34A', background: '#16A34A20', border: '1px solid #16A34A40' }
    if (status.kind === 'warn') return { color: '#D97706', background: '#D9770620', border: '1px solid #D9770640' }
    return                              { color: '#888',    background: '#88888820', border: '1px solid #88888840' }
  })()
  const icon = status.kind === 'ok' ? '✓' : status.kind === 'warn' ? '⚠' : ''
  return (
    <span style={{ ...style, fontSize: 10, padding: '2px 8px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
      {icon ? `${icon} ` : ''}{status.label}
    </span>
  )
}

// Runs eight cheap COUNT queries (one per step) in parallel and
// converts each result to a StepStatus.
async function runStatusChecks(seriesIdRaw: string): Promise<StatusMap> {
  const sid = assertUuid(seriesIdRaw, 'series id')
  // Look up name + tenant first so Step 1 can find similarly-named
  // series in the same tenant.
  const meta = (await adminApi.selectRows<{ name: string; tenant_id: string | null }>(
    `SELECT name, tenant_id FROM series WHERE id = '${sid}' LIMIT 1`,
  ))[0]
  const out: StatusMap = {}

  // ── Step 1: similarly-named series in same tenant
  let dupes: { name: string }[] = []
  if (meta?.tenant_id) {
    dupes = await adminApi.selectRows<{ name: string }>(
      `SELECT name FROM series WHERE tenant_id = '${assertUuid(meta.tenant_id, 'tenant id')}' AND id <> '${sid}'`,
    )
  }
  const fuzzyDupes = meta ? dupes.filter((d) => nameScore(meta.name, d.name) >= 70) : []
  out[1] = fuzzyDupes.length === 0
    ? { kind: 'ok', label: 'No duplicates' }
    : { kind: 'warn', label: `${fuzzyDupes.length} similar name${fuzzyDupes.length === 1 ? '' : 's'}` }

  // ── Run the rest of the counts in parallel
  const [
    classesDistinct, classesPromoted, eventsNoDot,
    eventsNullRound, eventsNullCircuit,
    entriesNoEmail, sessionsProvisional,
    suspectVariants,
  ] = await Promise.all([
    countOne(`SELECT COUNT(DISTINCT class)::int as n FROM series_entries WHERE series_id = '${sid}' AND class IS NOT NULL AND btrim(class) <> ''`),
    countOne(`SELECT COUNT(*)::int as n FROM series_classes WHERE series_id = '${sid}'`),
    countOne(`SELECT COUNT(*)::int as n FROM events WHERE series_id = '${sid}' AND (name IS NULL OR position('·' in name) = 0)`),
    countOne(`SELECT COUNT(*)::int as n FROM events WHERE series_id = '${sid}' AND round_number IS NULL`),
    countOne(`SELECT COUNT(*)::int as n FROM events WHERE series_id = '${sid}' AND circuit_id IS NULL`),
    countOne(`SELECT COUNT(*)::int as n FROM series_entries WHERE series_id = '${sid}' AND (email IS NULL OR btrim(email) = '')`),
    countOne(`
      SELECT COUNT(*)::int as n FROM race_results rr
      JOIN sessions s ON s.id = rr.session_id
      JOIN events e ON e.id = s.event_id
      WHERE e.series_id = '${sid}' AND rr.result_status = 'provisional'
    `),
    countOne(`SELECT COUNT(*)::int as n FROM series_entries WHERE series_id = '${sid}' AND (class ILIKE '% / %' OR class ILIKE '% + %' OR class ILIKE '% and %' OR class ~ '\\s-\\s')`),
  ])

  // ── Step 2: needs attention if class variants suspect OR distinct count beats series_classes count
  out[2] = (classesDistinct > classesPromoted || suspectVariants > 0)
    ? { kind: 'warn', label: classesDistinct > classesPromoted ? `${classesDistinct - classesPromoted} unmerged variant${classesDistinct - classesPromoted === 1 ? '' : 's'}` : `${suspectVariants} suspect label${suspectVariants === 1 ? '' : 's'}` }
    : { kind: 'ok', label: 'Aligned' }

  // ── Step 7: empty series_classes
  out[7] = classesPromoted === 0
    ? { kind: 'warn', label: 'Empty class list' }
    : { kind: 'ok', label: `${classesPromoted} class${classesPromoted === 1 ? '' : 'es'}` }

  // ── Step 8: events without "·" in their name
  out[8] = eventsNoDot === 0
    ? { kind: 'ok', label: 'Names standardised' }
    : { kind: 'warn', label: `${eventsNoDot} need rename` }

  // ── Step 6: events with null round_number
  out[6] = eventsNullRound === 0
    ? { kind: 'ok', label: 'All numbered' }
    : { kind: 'warn', label: `${eventsNullRound} unnumbered` }

  // ── Step 3: events with null circuit_id
  out[3] = eventsNullCircuit === 0
    ? { kind: 'ok', label: 'All linked' }
    : { kind: 'warn', label: `${eventsNullCircuit} unlinked` }

  // ── Step 5: entries with null/blank email
  out[5] = entriesNoEmail === 0
    ? { kind: 'ok', label: 'All emails set' }
    : { kind: 'warn', label: `${entriesNoEmail} missing email` }

  // ── Step 4: race_results still provisional
  out[4] = sessionsProvisional === 0
    ? { kind: 'ok', label: 'All finalised' }
    : { kind: 'warn', label: `${sessionsProvisional} provisional` }

  return out
}

async function countOne(sql: string): Promise<number> {
  const rows = await adminApi.selectRows<{ n: number }>(sql)
  return Number(rows[0]?.n ?? 0)
}
