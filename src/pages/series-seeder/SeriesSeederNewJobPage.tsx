// [EPIC-211] Series Seeder — new job form (admin portal port).
//
// Coordinator picks: series name, Speedhive group, date window, target
// tenant (existing or "+ Create new tenant…"), optional target series
// (= backfill mode), notification email. On Start Discovery:
//   1. If "Create new tenant" — invoke seed_series action
//      'create_tenant_with_user' first; tenant + auth user + profile +
//      role provisioned by the EF.
//   2. INSERT into series_import_jobs.
//   3. Fire-and-forget action='discover' tick; redirect to status page.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { styles, tokens, badge } from './seederStyles'
// [BUG-515] Fuzzy match the typed series-name + derived season against
// the tenant's existing series so a backfill auto-suggests linking
// instead of letting the coordinator silently create a duplicate.
import { canonSeason, nameScore, rankMatches, seasonFromDates } from '../../lib/fuzzy'

interface SeedPreset {
  series_name: string
  speedhive_group_name: string
  date_from: string
  date_to: string
  notes?: string
  source?: 'curated' | 'history'
}

// [BUG-447 v2] Auto-tick logic uses BRAND-TOKEN matching, not
// hardcoded variant lists — the user-typed input (e.g. "BMW Race
// Driver Series") is split into words; the uncommon ones are the
// brand signal ("BMW") and any scored group whose name contains one
// of those tokens gets auto-ticked. So "BMW Race Driver Series -
// Endurance", "BMW RDS - Open GT/A/B", and any future BMW variant
// all auto-tick from a single preset, with no per-name maintenance.
// Common-word stoplist below.
const STOPWORDS = new Set([
  'series', 'racing', 'race', 'cup', 'driver', 'drivers',
  'championship', 'class', 'classes', 'nz', 'and', 'the', 'of',
  'oceania', 'fr', 'open',
])

function brandTokens(input: string): string[] {
  return input
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

const PRESETS: SeedPreset[] = [
  { series_name: 'BMW Race Drivers Series NZ',     speedhive_group_name: 'BMW Race Driver Series', date_from: '2025-10-01', date_to: '2026-04-30', notes: 'Multi-class' },
  { series_name: 'Mazda Racing Series',            speedhive_group_name: 'Mazda Racing Series',    date_from: '2025-10-01', date_to: '2026-04-30', notes: 'RX8 rotary' },
  { series_name: 'Motul Honda Cup',                speedhive_group_name: 'Honda Cup',              date_from: '2025-10-01', date_to: '2026-04-30' },
  { series_name: 'NZ Formula First',               speedhive_group_name: 'Formula First',          date_from: '2025-10-01', date_to: '2026-04-30' },
  { series_name: 'Castrol Toyota FR Oceania',      speedhive_group_name: 'Toyota Racing',          date_from: '2025-10-01', date_to: '2026-04-30', notes: 'CTFROT' },
  { series_name: 'GTRNZ',                          speedhive_group_name: 'GTRNZ',                  date_from: '2025-10-01', date_to: '2026-04-30', notes: '4 classes, 70+ cars' },
  { series_name: 'Bridgestone GR86 Championship',  speedhive_group_name: 'GR86',                   date_from: '2025-10-01', date_to: '2026-04-30' },
  { series_name: 'PCNZ 2022/23 backfill',          speedhive_group_name: 'Porsche Race Series',    date_from: '2022-10-01', date_to: '2023-04-30', notes: 'Backfill' },
  { series_name: 'PCNZ 2023/24 backfill',          speedhive_group_name: 'Porsche Race Series',    date_from: '2023-10-01', date_to: '2024-04-30', notes: 'Backfill' },
  { series_name: 'PCNZ 2024/25 backfill',          speedhive_group_name: 'Porsche Race Series',    date_from: '2024-10-01', date_to: '2025-04-30', notes: 'Backfill' },
]

const NEW_TENANT_SENTINEL = '__new_tenant__'

interface TenantRow { id: string; name: string }
interface SeriesRow { id: string; name: string; season: string }
// [EPIC-211 FUZZY] test_connection now returns a scored list of every
// group seen in the window, sorted desc by fuzzyScore. Coordinator
// ticks one or many; multi-select stages each group as its own TC
// event under the same series (BMW = three classes, three events per
// round).
interface ScoredGroup {
  name: string
  score: number
  event_count: number
  last_event_name: string
  last_date: string
}
interface TestResult {
  events_in_window: number
  probed: number
  input: string
  scored_groups: ScoredGroup[]
  all_group_names_seen: string[]
}

export default function SeriesSeederNewJobPage() {
  const nav = useNavigate()

  const [seriesName, setSeriesName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [targetTenantId, setTargetTenantId] = useState('')
  const [targetSeriesId, setTargetSeriesId] = useState('')
  const [emailTo, setEmailTo] = useState('admin@track-chef.com')

  const [newTenantName, setNewTenantName] = useState('')
  const [newTenantEmail, setNewTenantEmail] = useState('')
  const [newTenantPassword, setNewTenantPassword] = useState('EG123456')

  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [tenantSeries, setTenantSeries] = useState<SeriesRow[]>([])
  // [BUG-517] Previously-attempted imports surfaced as additional presets
  // so the dropdown grows as the seeder is used — coordinator no longer
  // capped at the 10 baked-in entries. Pulled from series_import_jobs.
  const [historyPresets, setHistoryPresets] = useState<SeedPreset[]>([])

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  // [EPIC-211 FUZZY] Coordinator-confirmed selection from the scoring
  // screen. Empty until the first test_connection completes; the top-
  // scored group is auto-checked there.
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  // [BUG-451] When ON (default), Find Groups + Discover restrict to
  // events whose location.name matches a circuits.speedhive_name_aliases
  // entry — drops speedways / oval / unknown venues. Persisted in the
  // job's staged_data so the EF honours it for both stages.
  const [onlyKnownCircuits, setOnlyKnownCircuits] = useState(true)

  const isNewTenant = targetTenantId === NEW_TENANT_SENTINEL

  // Tenants list — load once.
  useEffect(() => {
    void (async () => {
      const { data, error } = await (supabase as any).from('tenants').select('id, name').order('name')
      if (error) console.error('[seeder] tenants load failed', error)
      setTenants((data ?? []) as TenantRow[])
    })()
  }, [])

  // [BUG-517] Load historical import jobs as additional presets. Newest
  // first; deduped by (series_name + group + date window). Skips junk
  // probe rows ("__test__"). Curated PRESETS still win on dupe.
  useEffect(() => {
    void (async () => {
      const { data, error } = await (supabase as any)
        .from('series_import_jobs')
        .select('series_name, speedhive_group_name, date_from, date_to, status, created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) { console.warn('[seeder] history load failed', error); return }
      const seen = new Set<string>()
      const curatedKeys = new Set(
        PRESETS.map((p) => `${p.series_name}|${p.speedhive_group_name}|${p.date_from}|${p.date_to}`),
      )
      const out: SeedPreset[] = []
      for (const row of (data ?? []) as { series_name: string | null; speedhive_group_name: string | null; date_from: string | null; date_to: string | null; status: string | null }[]) {
        if (!row.series_name || !row.speedhive_group_name || !row.date_from || !row.date_to) continue
        if (row.series_name.startsWith('__test__')) continue
        const key = `${row.series_name}|${row.speedhive_group_name}|${row.date_from}|${row.date_to}`
        if (seen.has(key) || curatedKeys.has(key)) continue
        seen.add(key)
        out.push({
          series_name: row.series_name,
          speedhive_group_name: row.speedhive_group_name,
          date_from: row.date_from,
          date_to: row.date_to,
          notes: row.status ?? undefined,
          source: 'history',
        })
      }
      setHistoryPresets(out)
    })()
  }, [])

  // Series list scoped to chosen tenant — refresh when tenant changes.
  useEffect(() => {
    if (!targetTenantId || isNewTenant) { setTenantSeries([]); return }
    void (async () => {
      const { data, error } = await (supabase as any)
        .from('series')
        .select('id, name, season')
        .eq('tenant_id', targetTenantId)
        .order('created_at', { ascending: false })
      if (error) console.error('[seeder] series load failed', error)
      setTenantSeries((data ?? []) as SeriesRow[])
    })()
  }, [targetTenantId, isNewTenant])

  // [BUG-517] Single combined list — curated PRESETS first, then any
  // historical imports loaded from series_import_jobs. Indexed so the
  // <select> value is just a position into this array.
  const allPresets = useMemo<SeedPreset[]>(
    () => [...PRESETS.map((p) => ({ ...p, source: 'curated' as const })), ...historyPresets],
    [historyPresets],
  )

  // [BUG-450] Picking a preset only fills the fields — nothing is
  // probed until the coordinator clicks Find Groups. Lets them
  // adjust dates or the group input first without each change
  // firing a request.
  // [BUG-517] '__custom__' clears every field so the coordinator can
  // type a brand-new series freely from a known reset state.
  const applyPreset = (idx: string) => {
    if (idx === '__custom__') {
      setSeriesName(''); setGroupName(''); setDateFrom(''); setDateTo('')
      setTestResult(null); setSelectedGroups([])
      return
    }
    const p = allPresets[Number(idx)]
    if (!p) return
    setSeriesName(p.series_name)
    setGroupName(p.speedhive_group_name)
    setDateFrom(p.date_from)
    setDateTo(p.date_to)
    setTestResult(null)
    setSelectedGroups([])
  }

  const canTest = !!groupName.trim() && !!dateFrom && !!dateTo
  // [BUG-518] Browse mode requires only the date window — the EF
  // probes every event in that range and returns every group name
  // seen, so the coordinator can discover series without knowing the
  // Speedhive group name up-front.
  const canBrowse = !!dateFrom && !!dateTo
  const newTenantValid = !!newTenantName.trim() && !!newTenantEmail.trim() && newTenantPassword.length >= 6
  // Discovery cannot start until the coordinator has confirmed at
  // least one Speedhive group from the scoring screen — without that
  // the EF discover loop has nothing to filter on.
  const canSubmit = useMemo(
    () =>
      !!seriesName.trim() &&
      canTest &&
      !!targetTenantId &&
      (!isNewTenant || newTenantValid) &&
      !!emailTo.trim() &&
      selectedGroups.length > 0,
    [seriesName, canTest, targetTenantId, isNewTenant, newTenantValid, emailTo, selectedGroups],
  )

  // [BUG-518] When browse=true, group name isn't required — we send a
  // wildcard so the EF still scores but no group is filtered out, and
  // every Speedhive group seen in the window comes back in
  // scored_groups for the coordinator to tick.
  const testConnection = async (browse = false) => {
    if (browse ? !canBrowse : !canTest) return
    setTesting(true)
    setErrorMsg(null)
    setOkMsg(null)
    setTestResult(null)
    try {
      const tenantForProbe = isNewTenant || !targetTenantId
        ? (tenants[0]?.id ?? '')
        : targetTenantId
      if (!tenantForProbe) throw new Error('No tenants available — pick one or load tenants')
      const probeGroupName = browse ? '*' : groupName
      const { data: tempJob, error: insErr } = await (supabase as any)
        .from('series_import_jobs')
        .insert({
          tenant_id: tenantForProbe,
          target_tenant_id: tenantForProbe,
          series_name: `__test__ ${seriesName || probeGroupName}`,
          speedhive_group_name: probeGroupName,
          date_from: dateFrom,
          date_to: dateTo,
          email_to: emailTo,
          status: 'discovering',
          // [BUG-451] EF reads only_known_circuits from staged_data
          // for both test_connection and discover.
          staged_data: { only_known_circuits: onlyKnownCircuits, browse_mode: browse },
        })
        .select('id')
        .single()
      if (insErr || !tempJob) throw insErr ?? new Error('Probe job insert failed')
      const { data, error } = await (supabase as any).functions.invoke('sync-speedhive', {
        body: { mode: 'seed_series', action: 'test_connection', job_id: tempJob.id },
      })
      await (supabase as any).from('series_import_jobs').delete().eq('id', tempJob.id)
      if (error) throw error
      const result = data as TestResult
      setTestResult(result)
      // [BUG-447 v2] Brand-token auto-tick. Extract the uncommon words
      // from the user's input (BMW, Mazda, Porsche…) and tick every
      // scored group whose name contains any of them — substring,
      // case-insensitive. Catches every Speedhive naming variant for a
      // brand without per-name maintenance. Falls back to top-scored
      // single group if no brand tokens are extractable from the input.
      // [BUG-518] In browse mode the brand-tick heuristic is meaningless
      // (no brand input), so leave selectedGroups empty — coordinator
      // ticks what they want from the full list.
      const brands = browse ? [] : brandTokens(groupName)
      const brandMatches = brands.length > 0
        ? result.scored_groups
            .filter((g) =>
              brands.some((b) =>
                g.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(b),
              ),
            )
            .map((g) => g.name)
        : []
      if (brandMatches.length > 0) {
        setSelectedGroups(brandMatches)
      } else if (!browse) {
        const top = result.scored_groups?.[0]
        setSelectedGroups(top && top.score >= 60 ? [top.name] : [])
      } else {
        setSelectedGroups([])
      }
      const candCount = result.scored_groups?.length ?? 0
      if (candCount === 0) {
        setErrorMsg(`No groups found in ${result.events_in_window} event(s). Check date window or Speedhive availability.`)
      } else if (browse) {
        setOkMsg(`Found ${candCount} group(s) across ${result.events_in_window} event(s) — tick the ones you want to import`)
      } else if (brandMatches.length > 0) {
        setOkMsg(`Auto-selected ${brandMatches.length} group(s) matching "${brands.join(', ')}" — review and adjust below`)
      } else {
        setOkMsg(`Found ${candCount} candidate group(s) — review scores below`)
      }
    } catch (e) {
      console.error('[seeder] test_connection failed', e)
      setErrorMsg((e as Error).message ?? 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  const startDiscovery = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setErrorMsg(null)
    setOkMsg(null)
    try {
      let resolvedTenantId = targetTenantId
      if (isNewTenant) {
        const { data: tu, error: tuErr } = await (supabase as any).functions.invoke('sync-speedhive', {
          body: {
            mode: 'seed_series',
            action: 'create_tenant_with_user',
            tenant_name: newTenantName,
            email: newTenantEmail,
            password: newTenantPassword,
            display_name: `${newTenantName} Coordinator`,
          },
        })
        if (tuErr) throw tuErr
        if (!tu?.tenant_id) throw new Error(tu?.error ?? 'Tenant create failed')
        resolvedTenantId = tu.tenant_id as string
      }
      const { data: job, error: insErr } = await (supabase as any)
        .from('series_import_jobs')
        .insert({
          tenant_id: resolvedTenantId,
          target_tenant_id: resolvedTenantId,
          target_series_id: targetSeriesId || null,
          series_name: seriesName,
          speedhive_group_name: groupName,
          date_from: dateFrom,
          date_to: dateTo,
          email_to: emailTo,
          status: 'discovering',
          // [EPIC-211 FUZZY] Coordinator-confirmed selection from the
          // scoring screen. EF discover loop filters each event's
          // groups against this list (case-insensitive exact). Stored
          // alongside the legacy single speedhive_group_name (kept as
          // a label / fallback).
          // [BUG-451] only_known_circuits gates the Speedhive events
          // list to circuits.speedhive_name_aliases matches.
          staged_data: {
            selected_group_names: selectedGroups,
            only_known_circuits: onlyKnownCircuits,
          },
        })
        .select('id')
        .single()
      if (insErr || !job) throw insErr ?? new Error('Could not create job')
      void (supabase as any).functions.invoke('sync-speedhive', {
        body: { mode: 'seed_series', action: 'discover', job_id: job.id },
      })
      nav(`/series-seeder/${job.id}`)
    } catch (e) {
      console.error('[seeder] start failed', e)
      setErrorMsg((e as Error).message ?? 'Could not start job')
      setSubmitting(false)
    }
  }

  return (
    <div style={styles.page} data-testid="series-seeder-new">
      <div>
        <h1 style={styles.h1}>Series Seeder</h1>
        <p style={styles.sub}>Discover, stage and import an entire Speedhive series.</p>
      </div>

      {errorMsg && <div style={styles.errorBanner}>{errorMsg}</div>}
      {okMsg && <div style={styles.okBanner}>{okMsg}</div>}

      {/* [BUG-450] Step 1 — Series + dates. Nothing is probed until the
          user clicks Find Groups. Picking a preset only fills the
          fields. */}
      <div style={{ ...styles.card, ...styles.section }} data-testid="seeder-step-series">
        <div style={{ fontSize: 11, color: tokens.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Step 1 · Series &amp; dates
        </div>

        <div style={styles.section}>
          <label style={styles.label}>
            Quick preset
            <span style={{ fontSize: 11, color: tokens.muted, marginLeft: 8, fontWeight: 400 }}>
              ({PRESETS.length} curated · {historyPresets.length} from history) — or type any series in the fields below
            </span>
          </label>
          <select
            style={styles.select}
            data-testid="seeder-preset"
            defaultValue=""
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="">Pick a known series…</option>
            <option value="__custom__">+ Custom (clear fields, type freely below)</option>
            <optgroup label="Curated">
              {PRESETS.map((p, i) => (
                <option key={`c-${i}`} value={String(i)}>
                  {p.series_name}{p.notes ? ` · ${p.notes}` : ''}
                </option>
              ))}
            </optgroup>
            {historyPresets.length > 0 && (
              <optgroup label="Previously imported">
                {historyPresets.map((p, i) => (
                  <option key={`h-${i}`} value={String(PRESETS.length + i)}>
                    {p.series_name} · {p.date_from?.slice(0, 7)} → {p.date_to?.slice(0, 7)}{p.notes ? ` · ${p.notes}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div style={styles.section}>
          <label style={styles.label} htmlFor="seeder-name">Series name</label>
          <input id="seeder-name" data-testid="seeder-name" style={styles.input} value={seriesName} onChange={(e) => setSeriesName(e.target.value)} placeholder="e.g. BMW Race Drivers Series NZ" />
        </div>

        <div style={styles.section}>
          <label style={styles.label} htmlFor="seeder-group">Speedhive group name</label>
          <input id="seeder-group" data-testid="seeder-group" style={styles.input} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. BMW Race Driver Series" />
        </div>

        <div style={styles.grid2}>
          <div style={styles.section}>
            <label style={styles.label} htmlFor="seeder-from">Date from</label>
            <input id="seeder-from" data-testid="seeder-from" type="date" style={styles.input} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div style={styles.section}>
            <label style={styles.label} htmlFor="seeder-to">Date to</label>
            <input id="seeder-to" data-testid="seeder-to" type="date" style={styles.input} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        {/* [BUG-451] Default-on filter to events at known circuits.
            Strips Speedhive's speedway / oval / unknown-venue noise
            so a wide window doesn't churn through irrelevant events.
            Untick to scan everything. */}
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: tokens.text, cursor: 'pointer' }}
          data-testid="seeder-only-known-circuits-label"
        >
          <input
            type="checkbox"
            checked={onlyKnownCircuits}
            onChange={(e) => setOnlyKnownCircuits(e.target.checked)}
            data-testid="seeder-only-known-circuits"
          />
          Only events at our circuits
          <span style={{ fontSize: 11, color: tokens.muted }}>
            (drops speedways / unknown venues)
          </span>
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-testid="seeder-test"
            onClick={() => testConnection(false)}
            disabled={!canTest || testing}
            style={{ ...styles.btn, ...((!canTest || testing) ? styles.btnDisabled : {}), flex: 1 }}
          >
            {testing ? 'Scanning…' : 'Find groups'}
          </button>
          {/* [BUG-518] Discover everything in the date window without
              needing a group name — surfaces every series Speedhive
              has so the coordinator can pick from a real list. */}
          <button
            type="button"
            data-testid="seeder-browse"
            onClick={() => testConnection(true)}
            disabled={!canBrowse || testing}
            title={canBrowse ? 'Probe every event in this window and list every group seen' : 'Pick a date range first'}
            style={{ ...styles.btnGhost, ...((!canBrowse || testing) ? styles.btnDisabled : {}), flex: 1 }}
          >
            {testing ? '…' : 'Browse what’s available →'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: tokens.muted, margin: 0 }}>
          Don’t know the group name? Pick a date range and hit
          <strong> Browse what’s available</strong> to see every series
          Speedhive has in that window.
        </p>

        {/* Wait indicator — same pattern as Status page's 'discovering'
            badge: accent badge + muted explanation line. */}
        {testing && (
          <div
            role="status"
            aria-live="polite"
            data-testid="seeder-scanning"
            style={{ ...styles.row, padding: '6px 0' }}
          >
            <span style={badge('accent')}>scanning</span>
            <span style={{ fontSize: 11, color: tokens.muted }}>
              Probing every event in the date window — this can take 30–60s on a wide range.
            </span>
          </div>
        )}
      </div>

      {/* [BUG-450] Step 2 — Group selection (only after Find Groups
          finishes). Hidden until there's a result so the form stays
          short on first load. */}
      {testResult && (
        <div style={{ ...styles.card, ...styles.section }} data-testid="seeder-step-groups">
          <div style={{ fontSize: 11, color: tokens.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Step 2 · Pick groups
          </div>
          <div style={{ fontSize: 12, color: tokens.muted }}>
            Probed {testResult.probed} of {testResult.events_in_window} event(s) ·
            {' '}{testResult.scored_groups.length} unique group name(s) ·
            {' '}{selectedGroups.length} ticked
          </div>
          <p style={{ fontSize: 12, color: tokens.text, margin: 0 }}>
            Tick the group(s) that belong to <strong>{seriesName || 'this series'}</strong>.
            Multiple groups (e.g. classes) → all imported under one series.
            Brand-matched names (containing "{brandTokens(groupName).join('", "') || '—'}") were auto-ticked.
          </p>
          {/* [BUG-452] Single scrollable picker — no score threshold,
              every group is tickable. Anything below the brand-match
              gets a muted score badge so the user can tell what's
              likely-relevant from likely-noise without hiding it. */}
          <div
            style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              maxHeight: 480, overflowY: 'auto',
              padding: 4, border: `1px solid ${tokens.border}`, borderRadius: 6,
            }}
          >
            {testResult.scored_groups.map((g) => {
              const checked = selectedGroups.includes(g.name)
              const variant: 'ok' | 'warn' | 'muted' = g.score >= 80 ? 'ok' : g.score >= 60 ? 'warn' : 'muted'
              return (
                <label
                  key={g.name}
                  data-testid={`seeder-group-row-${g.name}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    borderRadius: 6, border: `1px solid ${checked ? tokens.accent : tokens.border}`,
                    background: checked ? 'rgba(220,38,38,0.08)' : 'transparent', cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    data-testid={`seeder-group-check-${g.name}`}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedGroups((prev) => Array.from(new Set([...prev, g.name])))
                      else setSelectedGroups((prev) => prev.filter((n) => n !== g.name))
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 12, color: tokens.text }}>{g.name}</span>
                  <span style={{ fontSize: 11, color: tokens.muted }}>{g.event_count} event(s)</span>
                  <span style={badge(variant)}>{g.score}</span>
                </label>
              )
            })}
            {testResult.scored_groups.length === 0 && (
              <span style={{ fontSize: 11, color: tokens.muted, padding: 8 }}>No groups found — try adjusting the date window or unticking "Only events at our circuits".</span>
            )}
          </div>
        </div>
      )}

      {/* [BUG-450] Step 3 — Target + start. Only shown after Step 1
          + 2 are done (groups picked) so the form stays focused. */}
      {selectedGroups.length > 0 && (
      <div style={{ ...styles.card, ...styles.section }} data-testid="seeder-step-target">
        <div style={{ fontSize: 11, color: tokens.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Step 3 · Target &amp; start
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Target tenant</label>
          <select
            data-testid="seeder-tenant"
            style={styles.select}
            value={targetTenantId}
            onChange={(e) => { setTargetTenantId(e.target.value); setTargetSeriesId('') }}
          >
            <option value="">Pick a tenant…</option>
            <option value={NEW_TENANT_SENTINEL}>+ Create new tenant…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {isNewTenant && (
          <div style={{ ...styles.card, borderColor: 'rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.05)', display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="seeder-new-tenant">
            <p style={{ ...styles.sub, marginTop: 0 }}>Provisions tenant + a series-coordinator login in one step.</p>
            <div style={styles.section}>
              <label style={styles.label} htmlFor="seeder-new-tenant-name">Tenant name</label>
              <input id="seeder-new-tenant-name" data-testid="seeder-new-tenant-name" style={styles.input} value={newTenantName} onChange={(e) => setNewTenantName(e.target.value)} />
            </div>
            <div style={styles.section}>
              <label style={styles.label} htmlFor="seeder-new-tenant-email">Coordinator email</label>
              <input id="seeder-new-tenant-email" data-testid="seeder-new-tenant-email" type="email" style={styles.input} value={newTenantEmail} onChange={(e) => setNewTenantEmail(e.target.value)} />
            </div>
            <div style={styles.section}>
              <label style={styles.label} htmlFor="seeder-new-tenant-password">Coordinator password</label>
              <input id="seeder-new-tenant-password" data-testid="seeder-new-tenant-password" style={styles.input} value={newTenantPassword} onChange={(e) => setNewTenantPassword(e.target.value)} />
            </div>
          </div>
        )}

        {!isNewTenant && (
          <div style={styles.section}>
            <label style={styles.label}>Target series (optional — backfill into existing)</label>
            <SeriesMatchPicker
              tenantSeries={tenantSeries}
              seriesName={seriesName}
              dateFrom={dateFrom}
              dateTo={dateTo}
              value={targetSeriesId}
              onChange={setTargetSeriesId}
            />
          </div>
        )}

        <div style={styles.section}>
          <label style={styles.label} htmlFor="seeder-email">Notification email</label>
          <input id="seeder-email" data-testid="seeder-email" style={styles.input} value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
        </div>

        <div>
          <button
            type="button"
            data-testid="seeder-start"
            onClick={startDiscovery}
            disabled={!canSubmit || submitting}
            style={{ ...styles.btn, ...((!canSubmit || submitting) ? styles.btnDisabled : {}), width: '100%' }}
          >
            {submitting ? 'Starting…' : 'Start discovery →'}
          </button>
        </div>
      </div>
      )}
    </div>
  )
}

// [BUG-515] Fuzzy target-series picker. Combines a name score (0-100)
// with a season match (+15 boost when the canonicalised seasons agree)
// and surfaces:
//   • a banner with the top suggestion + score + "what matched"
//   • the dropdown reordered desc by score, each option carrying its %
//   • auto-select the top suggestion when score >= 75 and the user
//     hasn't already manually chosen something
// Fixes the regression where a backfill silently created a duplicate
// series because the coordinator didn't spot the existing one in a
// long alphabetical dropdown.
function SeriesMatchPicker({
  tenantSeries, seriesName, dateFrom, dateTo, value, onChange,
}: {
  tenantSeries: { id: string; name: string; season: string }[]
  seriesName: string
  dateFrom: string
  dateTo: string
  value: string
  onChange: (id: string) => void
}) {
  const derivedSeason = useMemo(() => seasonFromDates(dateFrom, dateTo), [dateFrom, dateTo])

  // Score = name fuzzy + season-equality boost. Name carries the bulk
  // of the signal; season disambiguates same-name across years.
  const ranked = useMemo(() => {
    if (!seriesName.trim() || tenantSeries.length === 0) return []
    const targetSeasonCanon = canonSeason(derivedSeason)
    return rankMatches(seriesName, tenantSeries, (s) => s.name)
      .map(({ item, score }) => {
        const seasonBoost =
          targetSeasonCanon && canonSeason(item.season) === targetSeasonCanon ? 15 : 0
        return { item, score: Math.min(100, score + seasonBoost), seasonBoost }
      })
      .sort((a, b) => b.score - a.score)
  }, [seriesName, tenantSeries, derivedSeason])

  const top = ranked[0]
  const userTouched = value !== ''

  // Auto-pick on a confident match — but only when the user hasn't
  // already chosen something explicitly. Re-runs as the typed name
  // tightens the score above the threshold.
  useEffect(() => {
    if (userTouched) return
    if (top && top.score >= 75) onChange(top.item.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.item.id, top?.score])

  const variant = (s: number): 'ok' | 'warn' | 'muted' =>
    s >= 90 ? 'ok' : s >= 75 ? 'ok' : s >= 60 ? 'warn' : 'muted'

  return (
    <>
      {top && top.score >= 60 && (
        <div
          data-testid="seeder-series-match-banner"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', marginBottom: 6,
            border: `1px solid ${top.score >= 75 ? tokens.accent : tokens.border}`,
            background: top.score >= 75 ? 'rgba(220,38,38,0.08)' : 'transparent',
            borderRadius: 6, fontSize: 12, color: tokens.text,
          }}
        >
          <span style={badge(variant(top.score))}>{top.score}%</span>
          <span style={{ flex: 1 }}>
            Matched <strong>{top.item.name}</strong> ({top.item.season || '—'})
            {' '}— name “{seriesName}” vs “{top.item.name}”
            {derivedSeason && top.seasonBoost > 0 && (
              <> · season <strong>{canonSeason(derivedSeason)}</strong> agrees</>
            )}
            {top.score >= 75
              ? ' · auto-selected (untick or change below to override)'
              : ' · review and pick below if this is the right one'}
          </span>
        </div>
      )}
      <select
        data-testid="seeder-target-series"
        style={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Create new series</option>
        {(ranked.length > 0 ? ranked.map((r) => r.item) : tenantSeries).map((s) => {
          const score = ranked.find((r) => r.item.id === s.id)?.score
          return (
            <option key={s.id} value={s.id}>
              {s.name} ({s.season}){score !== undefined ? ` · ${score}%` : ''}
            </option>
          )
        })}
      </select>
    </>
  )
}
