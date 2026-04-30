import { getToken } from './supabase'
const FUNCTION_URL = import.meta.env.VITE_SUPABASE_ADMIN_FUNCTION_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
async function callAdmin(action: string, payload?: Record<string, unknown>) {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')
  const res = await fetch(FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': ANON_KEY }, body: JSON.stringify({ action, payload }) })
  if (!res.ok) {
    let body: any = null
    try { body = await res.json() } catch { /* ignore */ }
    throw new Error(body?.error ?? `Admin API error: ${res.status}`)
  }
  return res.json()
}

// [BUG-292] The admin UI used to check is_super_admin via a direct
// `.from('profiles')` query — that hits the anon client + RLS, which
// refuses reads on other users' rows and occasionally on the caller's
// own row when the session is mid-refresh. Route the check through the
// admin-query EF instead: the EF's gate already runs with the service
// client, so a 2xx response means the caller IS a super admin.
//
// [BUG-292 follow-up] The first cut returned `false` silently for both
//   a) race condition (signInWithPassword resolved but getSession hasn't
//      written the token yet) and
//   b) VITE_SUPABASE_ADMIN_FUNCTION_URL missing in the Cloudflare Pages
//      environment,
// so an operator staring at "Access denied" had no way to tell which.
//
// verifySuperAdminDetail returns the specific reason for the UI to
// surface; the thin boolean wrapper is preserved for the two route
// guards that only care about the allow/deny bit.
export type SuperAdminDenyReason =
  | 'no-url'        // VITE_SUPABASE_ADMIN_FUNCTION_URL missing in env
  | 'no-token'      // no valid session token available
  | 'forbidden'     // EF returned 401/403 — JWT mismatch or not super admin
  | 'http-error'    // EF returned a non-2xx that isn't auth-scoped
  | 'network'       // fetch threw (no network, CORS, etc.)

export type SuperAdminCheck =
  | { ok: true }
  | { ok: false; reason: SuperAdminDenyReason; status?: number; body?: string }

async function postVerify(token: string): Promise<Response> {
  return fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': ANON_KEY,
    },
    body: JSON.stringify({ action: 'verify_super_admin', payload: {} }),
  })
}

/**
 * Detailed verification — exposes the specific reason for a deny so the
 * UI can tell "no env var" from "not a super admin" from "network dropped".
 * Accepts an optional explicit token to skip the getSession round-trip
 * (callers that just completed signInWithPassword can pass the fresh
 * access_token directly, avoiding the persistSession write race).
 */
export async function verifySuperAdminDetail(
  explicitToken?: string | null,
): Promise<SuperAdminCheck> {
  if (!FUNCTION_URL) {
    console.warn('[verifySuperAdmin] VITE_SUPABASE_ADMIN_FUNCTION_URL is not set')
    return { ok: false, reason: 'no-url' }
  }
  const token = (explicitToken ?? '').trim() || (await getToken())
  if (!token) {
    console.warn('[verifySuperAdmin] no session token available')
    return { ok: false, reason: 'no-token' }
  }
  try {
    const res = await postVerify(token)
    if (res.ok) return { ok: true }
    let body = ''
    try { body = (await res.text()).slice(0, 300) } catch { /* ignore */ }
    const reason: SuperAdminDenyReason =
      res.status === 401 || res.status === 403 ? 'forbidden' : 'http-error'
    console.warn('[verifySuperAdmin] denied:', { status: res.status, body })
    return { ok: false, reason, status: res.status, body }
  } catch (e) {
    console.warn('[verifySuperAdmin] network error:', e)
    return { ok: false, reason: 'network' }
  }
}

/** Boolean wrapper — unchanged contract for route guards. */
export async function verifySuperAdmin(explicitToken?: string | null): Promise<boolean> {
  const r = await verifySuperAdminDetail(explicitToken)
  return r.ok
}

/** Human-friendly message for the deny banner. */
export function superAdminDenyMessage(check: SuperAdminCheck): string {
  if (check.ok) return ''
  switch (check.reason) {
    case 'no-url':
      return 'Admin portal is misconfigured — VITE_SUPABASE_ADMIN_FUNCTION_URL is missing. Contact an administrator.'
    case 'no-token':
      return 'Session unavailable. Please sign in again.'
    case 'forbidden':
      return 'Access denied. Authorised administrators only.'
    case 'http-error':
      return `Admin API returned ${check.status ?? '?'}. Please try again.`
    case 'network':
      return 'Network error contacting the admin API. Check your connection and try again.'
    default:
      return 'Access denied.'
  }
}

// [BUG-317] Platform-wide round_communications row for the Announcements tab.
export interface AdminAnnouncement {
  id: string
  tenant_id: string | null
  event_id: string | null
  series_id: string | null
  subject: string | null
  status: string | null
  sent_at: string | null
  sent_count: number | null
  failed_count: number | null
  created_at: string
  event_name: string | null
  series_name: string | null
  tenant_name: string | null
}

// [BUG-293] Help-Centre article shape returned by list_help_articles —
// flattened join of persona_content_translations + persona_content.
export interface HelpArticle {
  id: string              // translation row id (target of update_help_article)
  content_id: string      // FK → persona_content.id
  persona_id: string | null
  content_type: string | null
  slug: string | null
  language_code: string
  title: string
  body: string
  status: string
  updated_at: string | null
}

export interface BuildBug { id: string; bug_ref: string; description: string | null; fixed_confirmed: boolean; confirmed_at: string | null }
export interface BuildTestRun { id: string; kind: 'unit' | 'regression' | 'e2e'; total: number; passed: number; failed: number; skipped: number; commit_hash: string | null; details_url: string | null; created_at: string }
export interface Build { id: string; build_ref: string; title: string; notes: string | null; status: 'open' | 'testing' | 'verified' | 'rejected'; created_at: string; admin_build_bugs: BuildBug[]; latest_test_runs?: Partial<Record<'unit' | 'regression' | 'e2e', BuildTestRun>> }

export const adminApi = {
  getAllTenants: () => callAdmin('all_tenants'),
  getAllUsers: (tenantId?: string) => callAdmin('all_users', tenantId ? { tenant_id: tenantId } : {}),
  deleteProfile: (profileId: string) => callAdmin('delete_profile', { profile_id: profileId }),
  deleteTenant: (tenantId: string) => callAdmin('delete_tenant', { tenant_id: tenantId }),
  createUser: (p: { email: string; display_name: string; tenant_id: string | null; password: string; must_reset: boolean }) => callAdmin('create_user', p),
  resetPassword: (p: { user_id: string; password: string; must_reset: boolean }) => callAdmin('reset_password', p),
  listBuilds: (): Promise<Build[]> => callAdmin('list_builds'),
  upsertBuild: (p: { id?: string; build_ref: string; title: string; notes?: string; status?: string }) => callAdmin('upsert_build', p),
  deleteBuild: (id: string) => callAdmin('delete_build', { id }),
  addBuildBug: (p: { build_id: string; bug_ref: string; description?: string }) => callAdmin('add_build_bug', p),
  toggleBuildBug: (id: string, fixed_confirmed: boolean) => callAdmin('toggle_build_bug', { id, fixed_confirmed }),
  deleteBuildBug: (id: string) => callAdmin('delete_build_bug', { id }),
  recentEvents: (p?: { limit?: number; event_name?: string; tenant_id?: string }) => callAdmin('recent_events', p ?? {}),
  usageStats: (): Promise<{ dau: number; wau: number; mau: number; top_events_7d: { name: string; count: number }[]; top_pages_7d: { name: string; count: number }[] }> => callAdmin('usage_stats'),
  // [BUG-519] The admin_run_sql RPC misclassifies a leading-whitespace
  // SELECT as a "command" because its first-word detection uses
  // btrim(sql_text) — Postgres btrim with no args only strips spaces,
  // not newlines/tabs. Template-literal SQL ("`\n  SELECT ...`") then
  // returns {kind:'command', affected:N} with no rows. Trim every SQL
  // here so the RPC's first-word match always sees SELECT/WITH/etc.
  runSql: (sql: string): Promise<{ kind: 'rows'; rows: Record<string, unknown>[] } | { kind: 'command'; command: string; affected: number } | { kind: 'error'; error: string; sqlstate?: string }> => callAdmin('run_sql', { sql: sql.trim() }),
  // [BUG-454] Thin SELECT wrapper for the new tab dashboards.
  // [BUG-514] Tolerate the multiple response shapes the run_sql EF can
  // produce (legacy {kind:'rows',rows:[...]}, plain {rows:[...]},
  // PostgREST-style {data:[...]}, or just an array). Anything else gets
  // logged + thrown with the raw payload so the next regression is
  // diagnosable from the browser console without guessing.
  // [BUG-519] Trim leading whitespace before sending — see runSql.
  selectRows: async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    const trimmed = sql.trim()
    const r: unknown = await callAdmin('run_sql', { sql: trimmed })
    if (Array.isArray(r)) return r as T[]
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>
      if (o.kind === 'error') throw new Error(String(o.error ?? 'SQL error'))
      if (Array.isArray(o.rows)) return o.rows as T[]
      if (Array.isArray(o.data)) return o.data as T[]
      if (Array.isArray(o.result)) return o.result as T[]
      // [BUG-519] If we still get a 'command' back for a SELECT, the
      // RPC's first-word detection has fallen through (e.g. starts
      // with a comment). Surface what happened — the next regression
      // should be diagnosable without guessing.
      if (o.kind === 'command') {
        console.error('[selectRows] RPC classified SELECT as command. SQL first chars:', JSON.stringify(trimmed.slice(0, 40)))
        throw new Error('SQL misclassified as command — first token is not SELECT/WITH/SHOW/EXPLAIN/VALUES/TABLE')
      }
    }
    console.error('[selectRows] unexpected SQL response shape:', r, 'sql:', trimmed.slice(0, 200))
    throw new Error('Unexpected SQL response')
  },
  reportTestRun: (p: { build_ref: string; kind: 'unit' | 'regression' | 'e2e'; total: number; passed: number; failed: number; skipped?: number; commit_hash?: string; details_url?: string }) => callAdmin('report_test_run', p),
  listTestRuns: (build_id?: string): Promise<BuildTestRun[]> => callAdmin('list_test_runs', build_id ? { build_id } : {}),
  // [BUG-293] Help Centre management.
  listHelpArticles: (): Promise<HelpArticle[]> => callAdmin('list_help_articles'),
  updateHelpArticle: (p: { id: string; title: string; body: string }): Promise<HelpArticle> =>
    callAdmin('update_help_article', p),
  // [BUG-317] Platform-wide round_communications view for the Announcements tab.
  listAnnouncements: (): Promise<AdminAnnouncement[]> => callAdmin('list_announcements'),
  // [EPIC-149] EF Debug Console — log viewer + verbose toggles.
  listEfLogs: (p?: { function_slug?: string; level?: 'info' | 'warn' | 'error' | 'debug'; session_id?: string; since?: string; limit?: number }): Promise<EfLog[]> =>
    callAdmin('list_ef_logs', p ?? {}),
  clearEfLogs: (p?: { function_slug?: string }): Promise<{ success: boolean; deleted: number | null; scope: string }> =>
    callAdmin('clear_ef_logs', p ?? {}),
  toggleEfVerbose: (function_slug: string, verbose_enabled: boolean): Promise<EfConfig> =>
    callAdmin('toggle_ef_verbose', { function_slug, verbose_enabled }),
  listEfConfig: (): Promise<EfConfig[]> => callAdmin('list_ef_config'),
}

// [EPIC-149] EF log row returned by list_ef_logs and pushed by realtime.
export interface EfLog {
  id: string
  function_slug: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  payload: Record<string, unknown> | null
  session_id: string | null
  created_at: string
}

export interface EfConfig {
  function_slug: string
  verbose_enabled: boolean
  updated_at: string | null
}
