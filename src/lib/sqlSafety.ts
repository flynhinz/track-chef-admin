// SQL-console safety helpers. Kept free of React so they're easy to unit test.

const MUTATING_KEYWORDS = /(^|\s|;)(UPDATE|DELETE|DROP|TRUNCATE|ALTER|INSERT|GRANT|REVOKE|CREATE|REPLACE)\s/i

export function stripComments(sql: string) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

// True when the SQL (ignoring comments) contains any mutating / DDL keyword.
// Used to decide whether to prompt the user for confirmation before running.
export function needsConfirm(sql: string) {
  const normalized = ' ' + stripComments(sql).trim().toUpperCase()
  return MUTATING_KEYWORDS.test(normalized)
}

export function firstKeyword(sql: string) {
  const trimmed = stripComments(sql).trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0].toUpperCase()
}

export interface BulkUserRow { email: string; display_name: string; password: string; tenant_id: string | null; must_reset: boolean }

export function parseBulkUsersCsv(text: string): BulkUserRow[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(line => {
      const [email, display_name, password, tenant_id, must_reset] = line.split(',').map(s => (s ?? '').trim())
      return {
        email, display_name, password,
        tenant_id: tenant_id || null,
        must_reset: (must_reset || '').toLowerCase() === 'true',
      }
    })
}
