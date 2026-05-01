// [EPIC-240] Cleanup-wizard SQL safety helpers. Keeps the run_sql call
// sites declarative and ensures every value the admin types or
// receives is validated before going into a SQL string. Pure functions.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export function assertUuid(v: unknown, ctx: string): string {
  if (!isUuid(v)) throw new Error(`Invalid UUID in ${ctx}: ${String(v).slice(0, 60)}`)
  return v as string
}

export function assertInt(v: unknown, ctx: string): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Invalid integer in ${ctx}: ${String(v).slice(0, 60)}`)
  }
  return n
}

// Postgres single-quote escaping — double every single quote, wrap.
// Rejects null bytes (PG rejects them anyway; we surface a clean
// error). NEVER concatenate raw user text into SQL — always pipe
// through this.
export function quoteLiteral(s: string): string {
  if (s.indexOf('\0') !== -1) throw new Error('Null byte in SQL literal')
  return `'${s.replace(/'/g, "''")}'`
}

// Comma-separated UUID list for IN-clauses. Validates each.
export function uuidList(ids: string[], ctx: string): string {
  if (ids.length === 0) throw new Error(`Empty UUID list in ${ctx}`)
  return ids.map((id) => `'${assertUuid(id, ctx)}'`).join(',')
}
