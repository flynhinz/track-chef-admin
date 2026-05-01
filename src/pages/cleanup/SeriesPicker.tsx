// [EPIC-240] Series picker for the cleanup wizard. Shared across the
// three step pages so the "select a series" UX is identical.

import { useEffect, useState } from 'react'
import { adminApi } from '../../lib/adminApi'

export interface CleanupSeries {
  id: string
  name: string
  season: string | null
  tenant_name: string | null
}

const SERIES_SQL = `
  SELECT s.id, s.name, s.season, t.name as tenant_name
  FROM series s
  LEFT JOIN tenants t ON t.id = s.tenant_id
  ORDER BY s.name ASC, s.season ASC
`

interface Props {
  value: string
  onChange: (id: string, row: CleanupSeries | null) => void
  testId?: string
}

export default function SeriesPicker({ value, onChange, testId }: Props) {
  const [rows, setRows] = useState<CleanupSeries[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.selectRows<CleanupSeries>(SERIES_SQL)
      .then((data) => setRows(data))
      .catch((e) => console.error('[cleanup] series load failed', e))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Series</div>
      <select
        data-testid={testId ?? 'cleanup-series-picker'}
        value={value}
        onChange={(e) => {
          const id = e.target.value
          onChange(id, rows.find((r) => r.id === id) ?? null)
        }}
        disabled={loading}
        style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none', minWidth: 360 }}
      >
        <option value=''>{loading ? 'Loading…' : '— Pick a series —'}</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}{r.season ? ` (${r.season})` : ''}{r.tenant_name ? ` — ${r.tenant_name}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
