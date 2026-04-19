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
// Returns `false` on no session, auth failure (401), forbidden (403),
// or any other non-ok response — callers can treat `false` as "deny".
export async function verifySuperAdmin(): Promise<boolean> {
  const token = await getToken()
  if (!token) return false
  try {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({ action: 'verify_super_admin', payload: {} }),
    })
    return res.ok
  } catch {
    return false
  }
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
  runSql: (sql: string): Promise<{ kind: 'rows'; rows: Record<string, unknown>[] } | { kind: 'command'; command: string; affected: number } | { kind: 'error'; error: string; sqlstate?: string }> => callAdmin('run_sql', { sql }),
  reportTestRun: (p: { build_ref: string; kind: 'unit' | 'regression' | 'e2e'; total: number; passed: number; failed: number; skipped?: number; commit_hash?: string; details_url?: string }) => callAdmin('report_test_run', p),
  listTestRuns: (build_id?: string): Promise<BuildTestRun[]> => callAdmin('list_test_runs', build_id ? { build_id } : {}),
}
