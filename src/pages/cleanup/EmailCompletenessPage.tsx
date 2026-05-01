// [EPIC-240 Step 5] Audit series_entries for missing emails. Inline-edit
// to fill them in; "Copy missing list" emits a CSV the admin can hand
// to the coordinator for collection.

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import SeriesPicker from './SeriesPicker'
import { assertUuid, quoteLiteral } from '../../lib/cleanupSql'

interface EntryRow {
  id: string
  race_number: string | null
  driver_name: string | null
  class: string | null
  email: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function EmailCompletenessPage() {
  const [seriesId, setSeriesId] = useState('')
  const [rows, setRows] = useState<EntryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [updatedThisSession, setUpdatedThisSession] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = (id: string) => {
    setLoading(true)
    setErrorMsg(null)
    setRows([])
    adminApi.selectRows<EntryRow>(`
      SELECT id, race_number, driver_name, class, email
      FROM series_entries
      WHERE series_id = '${assertUuid(id, 'series id')}'
      ORDER BY (email IS NULL OR btrim(email) = '') DESC,
               COALESCE(NULLIF(race_number, ''), '~'), driver_name
    `)
      .then((data) => setRows(data))
      .catch((e) => setErrorMsg((e as Error).message ?? 'Load failed'))
      .finally(() => setLoading(false))
  }

  const startEdit = (row: EntryRow) => {
    setEditingId(row.id)
    setDraft(row.email ?? '')
    setErrorMsg(null)
  }
  const cancelEdit = () => { setEditingId(null); setDraft('') }

  const save = async (rowId: string) => {
    const v = draft.trim()
    if (v && !EMAIL_RE.test(v)) {
      setErrorMsg(`Invalid email: ${v}`)
      return
    }
    setSavingId(rowId)
    setErrorMsg(null)
    try {
      const sql = v
        ? `UPDATE series_entries SET email = ${quoteLiteral(v.toLowerCase())} WHERE id = '${assertUuid(rowId, 'entry id')}'`
        : `UPDATE series_entries SET email = NULL WHERE id = '${assertUuid(rowId, 'entry id')}'`
      await adminApi.runMutation(sql)
      setRows((rs) => rs.map((r) => r.id === rowId ? { ...r, email: v ? v.toLowerCase() : null } : r))
      setUpdatedThisSession((n) => n + 1)
      setEditingId(null)
      setDraft('')
    } catch (e) {
      setErrorMsg((e as Error).message ?? 'Save failed')
    } finally {
      setSavingId(null)
    }
  }

  const isMissing = (r: EntryRow) => !r.email || !r.email.trim()
  const missing = useMemo(() => rows.filter(isMissing), [rows])

  const copyMissingCsv = async () => {
    const lines = [
      'race_number,driver_name,class',
      ...missing.map((r) => [r.race_number ?? '', r.driver_name ?? '', r.class ?? ''].map(csvCell).join(',')),
    ]
    const csv = lines.join('\r\n')
    try {
      await navigator.clipboard.writeText(csv)
      setErrorMsg(null)
      // Use error banner slot for OK feedback to keep the layout simple.
      window.setTimeout(() => null, 0)
    } catch {
      // Fallback — open a textarea-style window so the user can copy.
      window.prompt('Copy this CSV:', csv)
    }
  }

  const card = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 16 }

  return (
    <div data-testid='cleanup-step-5'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Step 5 — Email completeness</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Lists every series_entry without an email so it can be filled in here, or exported as
        CSV for the coordinator to chase. Inline-click an email cell to edit; Enter to save, Esc to
        cancel. Bulk send-driver-invite is gated on this column being clean.
      </p>

      <SeriesPicker value={seriesId} onChange={(id) => { setSeriesId(id); if (id) load(id); else setRows([]) }} />

      {errorMsg && <div style={{ color: '#DC2626', background: '#0D0D0D', border: '1px solid #DC262640', borderRadius: 4, padding: 10, fontSize: 12, marginBottom: 12 }}>{errorMsg}</div>}

      {!seriesId ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Pick a series to begin.</div>
      ) : loading ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>Loading entries…</div>
      ) : rows.length === 0 ? (
        <div style={{ ...card, color: '#888', fontSize: 13 }}>No entries on this series yet.</div>
      ) : (
        <>
          <div style={{ ...card, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, color: '#F5F5F5' }}>
              <strong>{missing.length}</strong> of <strong>{rows.length}</strong> drivers missing email
              {updatedThisSession > 0 && <span style={{ color: '#16A34A' }}> · {updatedThisSession} updated this session</span>}
            </div>
            <button type='button' data-testid='cleanup-email-copy'
              onClick={copyMissingCsv} disabled={missing.length === 0}
              style={{ background: 'none', border: '1px solid #2A2A2A', color: missing.length === 0 ? '#555' : '#F5F5F5', cursor: missing.length === 0 ? 'not-allowed' : 'pointer', fontSize: 12, padding: '6px 12px', borderRadius: 4 }}
            >Copy missing list (CSV)</button>
          </div>

          <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#0D0D0D' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 70 }}>#</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Driver</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Class</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 130 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const editing = editingId === r.id
                  const missingHere = isMissing(r)
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #2A2A2A' }} data-testid={`cleanup-email-row-${r.id}`}>
                      <td style={{ padding: '8px 12px', color: '#888', fontFamily: 'monospace' }}>{r.race_number ?? '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#F5F5F5' }}>{r.driver_name ?? '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#888' }}>{r.class ?? '—'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {editing ? (
                          <input
                            data-testid={`cleanup-email-input-${r.id}`}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => save(r.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            autoFocus
                            disabled={savingId === r.id}
                            placeholder='driver@example.com'
                            style={{ background: '#0D0D0D', border: '1px solid #DC262640', borderRadius: 4, padding: '4px 8px', color: '#F5F5F5', fontSize: 12, outline: 'none', width: '100%' }}
                          />
                        ) : (
                          <button type='button' onClick={() => startEdit(r)} style={{ background: 'none', border: 'none', color: missingHere ? '#888' : '#F5F5F5', cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
                            {r.email ?? '— click to add —'}
                          </button>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {missingHere ? (
                          <span style={{ fontSize: 11, color: '#D97706', background: '#D9770620', border: '1px solid #D9770640', padding: '2px 8px', borderRadius: 3 }}>Missing email</span>
                        ) : (
                          <span style={{ fontSize: 11, color: '#16A34A', background: '#16A34A20', border: '1px solid #16A34A40', padding: '2px 8px', borderRadius: 3 }}>Ready to invite</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function csvCell(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
