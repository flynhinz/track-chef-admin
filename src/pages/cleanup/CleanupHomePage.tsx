// [EPIC-240] Cleanup wizard landing — links to each step. Each step
// is independently runnable; this page exists so admins have one
// nav entry to remember instead of three.

import { useNavigate } from 'react-router-dom'

interface StepCard {
  step: number
  path: string
  title: string
  what: string
  why: string
}

const STEPS: StepCard[] = [
  {
    step: 6,
    path: '/cleanup/round-numbers',
    title: 'Step 6 — Set round numbers',
    what: 'Group events by start_date, type a round number per weekend, apply.',
    why: 'Speedhive imports leave round_number = null. GTRNZ / Mazda / Formula First are all in this state.',
  },
  {
    step: 7,
    path: '/cleanup/series-classes',
    title: 'Step 7 — Seed series_classes',
    what: 'Promote distinct series_entries.class values into the canonical class list with sort order.',
    why: 'Empty series_classes → class picker scrapes series_entries and may leak labels from other series (CLEANUP-01 / BUG-564).',
  },
  {
    step: 8,
    path: '/cleanup/event-names',
    title: 'Step 8 — Standardise event names',
    what: 'Group events by class, set a consistent suffix per group (e.g. "{venue} · {class label}").',
    why: 'Speedhive event names vary per venue/round even for the same grid — see BMW E46 example in addendum.',
  },
]

export default function CleanupHomePage() {
  const nav = useNavigate()
  return (
    <div data-testid='cleanup-home'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Series Cleanup</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
        Steps that run after a Speedhive import to bring a fresh series up to coordinator-ready state.
      </p>
      <p style={{ color: '#666', fontSize: 12, marginBottom: 24 }}>
        Recommended order for a new series: <code style={{ color: '#F5F5F5' }}>1 → 2 → 7 → 8 → 6 → 3 → 5 → 4</code>.
        Each step is independently runnable — re-run any one without repeating the others.
      </p>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {STEPS.map((s) => (
          <button
            key={s.step}
            type='button'
            data-testid={`cleanup-card-${s.step}`}
            onClick={() => nav(s.path)}
            style={{
              textAlign: 'left',
              background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8,
              padding: 20, cursor: 'pointer', color: '#F5F5F5',
            }}
          >
            <div style={{ fontSize: 11, color: '#DC2626', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Step {s.step}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{s.title.replace(/^Step \d+ — /, '')}</div>
            <div style={{ fontSize: 12, color: '#F5F5F5', marginBottom: 8 }}>{s.what}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{s.why}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
