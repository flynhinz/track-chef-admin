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

import {
  superAdminDenyMessage,
  verifySuperAdmin,
  verifySuperAdminDetail,
} from '../lib/adminApi'
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

// ── [BUG-292 follow-up] detailed verify path ────────────────────────────────

describe('[BUG-292 follow-up] verifySuperAdminDetail reasons', () => {
  const originalFetch = globalThis.fetch
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_ADMIN_FUNCTION_URL', 'https://test.supabase.co/functions/v1/admin-query')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    warnSpy.mockRestore()
  })

  it('explicit token skips the getSession round-trip (avoids post-login race)', async () => {
    const getTokenSpy = vi.mocked(getToken).mockResolvedValue('')
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = fetchSpy as any

    const r = await verifySuperAdminDetail('fresh-jwt')
    expect(r).toEqual({ ok: true })
    // getSession must NOT have been consulted when an explicit token was given.
    expect(getTokenSpy).not.toHaveBeenCalled()
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer fresh-jwt')
  })

  it('no-token — empty explicit token falls back to getSession and surfaces the reason', async () => {
    vi.mocked(getToken).mockResolvedValue('')
    const r = await verifySuperAdminDetail('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-token')
  })

  it('forbidden — 403 from EF surfaces reason=forbidden with status+body', async () => {
    vi.mocked(getToken).mockResolvedValue('jwt')
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    ) as any
    const r = await verifySuperAdminDetail()
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('forbidden')
      expect(r.status).toBe(403)
      expect(r.body).toContain('Forbidden')
    }
  })

  it('forbidden — 401 from Supabase JWT gate maps to reason=forbidden', async () => {
    vi.mocked(getToken).mockResolvedValue('jwt')
    globalThis.fetch = vi.fn(async () =>
      new Response('Invalid JWT', { status: 401 }),
    ) as any
    const r = await verifySuperAdminDetail()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('forbidden')
  })

  it('http-error — non-auth non-ok status surfaces distinctly', async () => {
    vi.mocked(getToken).mockResolvedValue('jwt')
    globalThis.fetch = vi.fn(async () => new Response('oops', { status: 500 })) as any
    const r = await verifySuperAdminDetail()
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('http-error')
      expect(r.status).toBe(500)
    }
  })

  it('network — fetch throws → reason=network', async () => {
    vi.mocked(getToken).mockResolvedValue('jwt')
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as any
    const r = await verifySuperAdminDetail()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('network')
  })

  it('warns to console on every deny path so Cloudflare logs show why', async () => {
    vi.mocked(getToken).mockResolvedValue('')
    await verifySuperAdminDetail()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('[BUG-292 follow-up] superAdminDenyMessage', () => {
  it('calls out the missing env var explicitly', () => {
    const msg = superAdminDenyMessage({ ok: false, reason: 'no-url' })
    expect(msg).toMatch(/VITE_SUPABASE_ADMIN_FUNCTION_URL/)
  })

  it('no-token asks the user to sign in again', () => {
    expect(superAdminDenyMessage({ ok: false, reason: 'no-token' })).toMatch(/sign in/i)
  })

  it('forbidden keeps the canonical "Access denied" wording', () => {
    expect(superAdminDenyMessage({ ok: false, reason: 'forbidden' })).toMatch(/Access denied/)
  })

  it('http-error includes the status code', () => {
    const msg = superAdminDenyMessage({ ok: false, reason: 'http-error', status: 502 })
    expect(msg).toMatch(/502/)
  })

  it('network tells the user to check their connection', () => {
    expect(superAdminDenyMessage({ ok: false, reason: 'network' })).toMatch(/Network/)
  })

  it('returns empty string on ok', () => {
    expect(superAdminDenyMessage({ ok: true })).toBe('')
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

describe('[BUG-292] LoginPage uses the detailed verify helper', () => {
  it('imports verifySuperAdminDetail + superAdminDenyMessage from adminApi', () => {
    expect(LOGIN).toMatch(
      /import \{[^}]*verifySuperAdminDetail[^}]*\} from '\.\.\/lib\/adminApi'/,
    )
    expect(LOGIN).toMatch(
      /import \{[^}]*superAdminDenyMessage[^}]*\} from '\.\.\/lib\/adminApi'/,
    )
  })
  it('no longer reads profiles.is_super_admin directly', () => {
    // Strip single-line comments first so the explanatory "// …
    // .from('profiles') …" lines don't trigger a false positive.
    const code = LOGIN.replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\.from\('profiles'\)/)
  })
  it('passes the freshly-issued access token into the verifier (no getSession race)', () => {
    expect(LOGIN).toMatch(/data\.session\?\.access_token/)
    expect(LOGIN).toMatch(/verifySuperAdminDetail\(token\)/)
  })
  it('surfaces the specific deny reason via superAdminDenyMessage', () => {
    expect(LOGIN).toMatch(/setError\(superAdminDenyMessage\(check\)\)/)
  })
  it('still signs the user out when the verification denies', () => {
    expect(LOGIN).toMatch(/if \(!check\.ok\) \{[\s\S]{0,200}signOut/)
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
