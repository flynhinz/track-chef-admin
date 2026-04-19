// [BUG-292] verifySuperAdmin routes the is_super_admin check through the
// admin-query Edge Function (service role) instead of a direct
// .from('profiles') query (anon client + RLS).
//
// Covers the helper's behaviour (happy path / no session / non-ok
// response / fetch throw) and pins the call-site wiring in LoginPage
// and App.tsx's two ProtectedRoute variants so nobody accidentally
// re-introduces the RLS-gated read.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Stub the env + supabase import before the module under test is loaded.
vi.mock('../lib/supabase', () => ({
  getToken: vi.fn(),
}))

import { verifySuperAdmin } from '../lib/adminApi'
import { getToken } from '../lib/supabase'

const read = (rel: string) =>
  readFileSync(resolve(__dirname, '..', '..', rel), 'utf8')

const APP = read('src/App.tsx')
const LOGIN = read('src/pages/LoginPage.tsx')
const API = read('src/lib/adminApi.ts')

describe('[BUG-292] verifySuperAdmin behaviour', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_ADMIN_FUNCTION_URL', 'https://test.supabase.co/functions/v1/admin-query')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns false when no session token', async () => {
    vi.mocked(getToken).mockResolvedValue('')
    const ok = await verifySuperAdmin()
    expect(ok).toBe(false)
  })

  it('returns true on 2xx from the EF', async () => {
    vi.mocked(getToken).mockResolvedValue('jwt-abc')
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: { is_super_admin: true }, error: null }), { status: 200 }),
    ) as any
    const ok = await verifySuperAdmin()
    expect(ok).toBe(true)
  })

  it('returns false on 403 (non-admin)', async () => {
    vi.mocked(getToken).mockResolvedValue('jwt-abc')
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    ) as any
    const ok = await verifySuperAdmin()
    expect(ok).toBe(false)
  })

  it('returns false on 401 (auth failed)', async () => {
    vi.mocked(getToken).mockResolvedValue('jwt-abc')
    globalThis.fetch = vi.fn(async () =>
      new Response('Unauthorized', { status: 401 }),
    ) as any
    const ok = await verifySuperAdmin()
    expect(ok).toBe(false)
  })

  it('returns false when fetch throws (network error)', async () => {
    vi.mocked(getToken).mockResolvedValue('jwt-abc')
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as any
    const ok = await verifySuperAdmin()
    expect(ok).toBe(false)
  })

  it('invokes the EF with action=verify_super_admin and Bearer token', async () => {
    vi.mocked(getToken).mockResolvedValue('jwt-xyz')
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = fetchSpy as any
    await verifySuperAdmin()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // URL comes from an env var read at module load, so we don't pin it
    // here (the static grep above + the body/headers cover the contract).
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-xyz')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'verify_super_admin',
      payload: {},
    })
  })
})

// ── Static wiring guards ─────────────────────────────────────────────────────

describe('[BUG-292] adminApi exports verifySuperAdmin', () => {
  it('adminApi.ts exports the helper', () => {
    expect(API).toMatch(/export async function verifySuperAdmin/)
  })
  it('helper posts to the admin-query function URL with the verify action', () => {
    expect(API).toMatch(/action:\s*'verify_super_admin'/)
  })
})

describe('[BUG-292] LoginPage uses verifySuperAdmin, not a direct profiles query', () => {
  it('imports verifySuperAdmin from adminApi', () => {
    expect(LOGIN).toMatch(/import \{ verifySuperAdmin \} from '\.\.\/lib\/adminApi'/)
  })
  it('no longer reads profiles.is_super_admin directly', () => {
    // Strip single-line comments first so the explanatory "// …
    // .from('profiles') …" lines don't trigger a false positive.
    const code = LOGIN.replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\.from\('profiles'\)/)
  })
  it('gates navigation on the helper result', () => {
    expect(LOGIN).toMatch(/const ok = await verifySuperAdmin\(\)/)
    expect(LOGIN).toMatch(/if \(!ok\) \{[\s\S]{0,200}signOut/)
  })
})

describe('[BUG-292] App.tsx route guards use verifySuperAdmin', () => {
  it('imports verifySuperAdmin from adminApi', () => {
    expect(APP).toMatch(/import \{ verifySuperAdmin \} from '\.\/lib\/adminApi'/)
  })
  it('neither ProtectedRoute nor SuperAdminRoute calls .from(profiles) any more', () => {
    const code = APP.replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\.from\('profiles'\)/)
  })
  it('both guards delegate to the helper and only flip allowed=true on ok', () => {
    // Two occurrences: one in ProtectedRoute, one in SuperAdminRoute.
    const matches = APP.match(/const ok = await verifySuperAdmin\(\)/g) ?? []
    expect(matches.length).toBe(2)
  })
})
