// [BUG-537] Add Series Coordinator modal — only supported path for
// provisioning a new coordinator. Submits to the admin-query EF
// 'create_coordinator' action (creates / repairs auth user, tenant,
// profile, user_roles, and emails a recovery link via Resend).

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { adminApi } from '../lib/adminApi'

interface SeriesRow { id: string; name: string; season: string | null; tenant_id: string | null }

export interface CoordinatorResult {
  name: string
  email: string
  recovery_link: string | null
  warnings: string[]
}

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: (result: CoordinatorResult) => void
}

export default function AddCoordinatorModal({ open, onClose, onSuccess }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [seriesId, setSeriesId] = useState('')
  const [series, setSeries] = useState<SeriesRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset on open so a re-open doesn't show stale state.
  useEffect(() => {
    if (!open) return
    setName(''); setEmail(''); setSeriesId(''); setErrorMsg(null); setSubmitting(false)
  }, [open])

  // Series list across all tenants — coordinator can be linked to any.
  useEffect(() => {
    if (!open) return
    void (async () => {
      const { data, error } = await (supabase as any)
        .from('series')
        .select('id, name, season, tenant_id')
        .order('name', { ascending: true })
      if (error) console.error('[AddCoordinator] series load failed', error)
      setSeries((data ?? []) as SeriesRow[])
    })()
  }, [open])

  const valid = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const submit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const result = await adminApi.createCoordinator({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        series_id: seriesId || null,
      })
      onSuccess({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        recovery_link: result.recovery_link,
        warnings: result.warnings ?? [],
      })
    } catch (e) {
      console.error('[AddCoordinator] failed', e)
      setErrorMsg((e as Error).message ?? 'Provisioning failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const input = { background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' as const }
  const label = { fontSize: 11, color: '#888', marginBottom: 4, display: 'block' }

  return (
    <div
      data-testid='add-coordinator-modal'
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
    >
      <div
        style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 24, width: '100%', maxWidth: 480 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#F5F5F5' }}>Add Series Coordinator</h2>
          <button
            type='button'
            data-testid='add-coordinator-close'
            onClick={onClose}
            disabled={submitting}
            style={{ background: 'none', border: 'none', color: '#888', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 20, padding: 4 }}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#888', marginTop: 0, marginBottom: 20 }}>
          Creates an auth user, a tenant named after them, the
          series-coordinator role, and emails a password-reset link.
        </p>

        {errorMsg && (
          <div style={{ background: '#0D0D0D', border: '1px solid #DC262640', color: '#DC2626', padding: 10, borderRadius: 4, fontSize: 12, marginBottom: 14 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={label} htmlFor='coord-name'>Full name <span style={{ color: '#DC2626' }}>*</span></label>
          <input
            id='coord-name'
            data-testid='coord-name'
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. Greg BMW'
            style={input}
            disabled={submitting}
            autoFocus
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label} htmlFor='coord-email'>Email <span style={{ color: '#DC2626' }}>*</span></label>
          <input
            id='coord-email'
            data-testid='coord-email'
            type='email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder='coordinator@example.com'
            style={input}
            disabled={submitting}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={label} htmlFor='coord-series'>Series (optional — links series.tenant_id to the new tenant)</label>
          <select
            id='coord-series'
            data-testid='coord-series'
            value={seriesId}
            onChange={(e) => setSeriesId(e.target.value)}
            style={input}
            disabled={submitting}
          >
            <option value=''>— Don't link a series —</option>
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.season ? ` (${s.season})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type='button'
            data-testid='coord-cancel'
            onClick={onClose}
            disabled={submitting}
            style={{ background: 'none', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 13, padding: '8px 16px', borderRadius: 4 }}
          >
            Cancel
          </button>
          <button
            type='button'
            data-testid='coord-submit'
            onClick={submit}
            disabled={!valid || submitting}
            style={{
              background: !valid || submitting ? '#3a1010' : '#DC2626',
              border: 'none', color: '#F5F5F5',
              cursor: !valid || submitting ? 'not-allowed' : 'pointer',
              fontSize: 13, padding: '8px 16px', borderRadius: 4, fontWeight: 600,
              opacity: !valid || submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Provisioning…' : 'Create coordinator'}
          </button>
        </div>
      </div>
    </div>
  )
}
