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

interface SeedPreset {
  series_name: string
  speedhive_group_name: string
  date_from: string
  date_to: string
  notes?: string
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
  const [emailTo, setEmailTo] = useState('mark@i6mm.nz')

  const [newTenantName, setNewTenantName] = useState('')
  const [newTenantEmail, setNewTenantEmail] = useState('')
  const [newTenantPassword, setNewTenantPassword] = useState('EG123456')

  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [tenantSeries, setTenantSeries] = useState<SeriesRow[]>([])

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  // [EPIC-211 FUZZY] Coordinator-confirmed selection from the scoring
  // screen. Empty until the first test_connection completes; the top-
  // scored group is auto-checked there.
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const isNewTenant = targetTenantId === NEW_TENANT_SENTINEL

  // Tenants list — load once.
  useEffect(() => {
    void (async () => {
      const { data, error } = await (supabase as any).from('tenants').select('id, name').order('name')
      if (error) console.error('[seeder] tenants load failed', error)
      setTenants((data ?? []) as TenantRow[])
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

  const applyPreset = (idx: string) => {
    const p = PRESETS[Number(idx)]
    if (!p) return
    setSeriesName(p.series_name)
    setGroupName(p.speedhive_group_name)
    setDateFrom(p.date_from)
    setDateTo(p.date_to)
    setTestResult(null)
    setSelectedGroups([])
  }

  const canTest = !!groupName.trim() && !!dateFrom && !!dateTo
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

  const testConnection = async () => {
    if (!canTest) return
    setTesting(true)
    setErrorMsg(null)
    setOkMsg(null)
    setTestResult(null)
    try {
      const tenantForProbe = isNewTenant || !targetTenantId
        ? (tenants[0]?.id ?? '')
        : targetTenantId
      if (!tenantForProbe) throw new Error('No tenants available — pick one or load tenants')
      const { data: tempJob, error: insErr } = await (supabase as any)
        .from('series_import_jobs')
        .insert({
          tenant_id: tenantForProbe,
          target_tenant_id: tenantForProbe,
          series_name: `__test__ ${seriesName || groupName}`,
          speedhive_group_name: groupName,
          date_from: dateFrom,
          date_to: dateTo,
          email_to: emailTo,
          status: 'discovering',
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
      // Auto-select the top-scored group if it clears 60 (the
      // word-overlap floor); coordinator can change before submitting.
      const top = result.scored_groups?.[0]
      if (top && top.score >= 60) {
        setSelectedGroups([top.name])
      } else {
        setSelectedGroups([])
      }
      const candCount = result.scored_groups?.length ?? 0
      if (candCount === 0) {
        setErrorMsg(`No groups found in ${result.events_in_window} event(s). Check date window or Speedhive availability.`)
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
          staged_data: { selected_group_names: selectedGroups },
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

      <div style={{ ...styles.card, ...styles.section }}>
        <div style={styles.section}>
          <label style={styles.label}>Quick preset</label>
          <select
            style={styles.select}
            data-testid="seeder-preset"
            defaultValue=""
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="">Pick a known series…</option>
            {PRESETS.map((p, i) => (
              <option key={i} value={String(i)}>
                {p.series_name}{p.notes ? ` · ${p.notes}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.section}>
          <label style={styles.label} htmlFor="seeder-name">Series name</label>
          <input id="seeder-name" data-testid="seeder-name" style={styles.input} value={seriesName} onChange={(e) => setSeriesName(e.target.value)} placeholder="e.g. BMW Race Drivers Series NZ" />
        </div>

        <div style={styles.section}>
          <label style={styles.label} htmlFor="seeder-group">Speedhive group name</label>
          <div style={styles.row}>
            <input id="seeder-group" data-testid="seeder-group" style={{ ...styles.input, flex: 1, minWidth: 240 }} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. BMW Race Driver Series" />
            <button
              type="button"
              data-testid="seeder-test"
              onClick={testConnection}
              disabled={!canTest || testing}
              style={{ ...styles.btnGhost, ...((!canTest || testing) ? styles.btnDisabled : {}) }}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          </div>
          {testResult && (
            <div style={{ ...styles.card, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="seeder-test-result">
              <div style={{ fontSize: 12, color: tokens.muted }}>
                Probed {testResult.probed} of {testResult.events_in_window} event(s) ·
                {' '}{testResult.scored_groups.length} unique group(s) found
              </div>
              <p style={{ fontSize: 12, color: tokens.text, margin: 0 }}>
                Tick the group(s) that belong to <strong>{seriesName || 'this series'}</strong>.
                Multiple groups (e.g. classes) → all imported under one series.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                  <span style={{ fontSize: 11, color: tokens.muted }}>No groups scored — try adjusting the date window.</span>
                )}
              </div>
              {testResult.all_group_names_seen.length > testResult.scored_groups.length && (
                <details style={{ fontSize: 11, color: tokens.muted }}>
                  <summary style={{ cursor: 'pointer' }}>All group names seen ({testResult.all_group_names_seen.length})</summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                    {testResult.all_group_names_seen.map((g) => <li key={g}>{g}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
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
            <select
              data-testid="seeder-target-series"
              style={styles.select}
              value={targetSeriesId}
              onChange={(e) => setTargetSeriesId(e.target.value)}
            >
              <option value="">Create new series</option>
              {tenantSeries.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.season})</option>)}
            </select>
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
    </div>
  )
}
