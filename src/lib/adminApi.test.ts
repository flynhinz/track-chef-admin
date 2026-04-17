import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

vi.mock('./supabase', () => ({
  getToken: vi.fn(async () => 'fake-token'),
}))

// Import AFTER the mock so the module picks it up.
import { adminApi } from './adminApi'

describe('adminApi.callAdmin', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn()
  })

  it('sends action + payload to the Edge Function and returns JSON on success', async () => {
    ;((globalThis as any).fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ id: 't1', name: 'Tenant 1' }],
    })
    const out = await adminApi.getAllTenants()
    expect(out).toEqual([{ id: 't1', name: 'Tenant 1' }])
    const fetchCall = ((globalThis as any).fetch as Mock).mock.calls[0]
    expect(fetchCall[1].method).toBe('POST')
    expect(fetchCall[1].headers.Authorization).toBe('Bearer fake-token')
    const body = JSON.parse(fetchCall[1].body)
    expect(body.action).toBe('all_tenants')
  })

  it('surfaces Edge-Function error body when status is not ok', async () => {
    ;((globalThis as any).fetch as Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'email already registered' }),
    })
    await expect(adminApi.createUser({
      email: 'x@x.com', display_name: 'X', tenant_id: null, password: 'EG123456', must_reset: true,
    })).rejects.toThrow(/email already registered/)
  })

  it('falls back to status code if the error body is not JSON', async () => {
    ;((globalThis as any).fetch as Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    })
    await expect(adminApi.getAllUsers()).rejects.toThrow(/500/)
  })

  it('resetPassword passes must_reset through', async () => {
    ;((globalThis as any).fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    await adminApi.resetPassword({ user_id: 'u1', password: 'EG123456', must_reset: true })
    const body = JSON.parse(((globalThis as any).fetch as Mock).mock.calls[0][1].body)
    expect(body.action).toBe('reset_password')
    expect(body.payload).toEqual({ user_id: 'u1', password: 'EG123456', must_reset: true })
  })

  it('toggleBuildBug sends the fixed_confirmed flag', async () => {
    ;((globalThis as any).fetch as Mock).mockResolvedValue({ ok: true, json: async () => ({}) })
    await adminApi.toggleBuildBug('bug-1', true)
    const body = JSON.parse(((globalThis as any).fetch as Mock).mock.calls[0][1].body)
    expect(body.action).toBe('toggle_build_bug')
    expect(body.payload).toEqual({ id: 'bug-1', fixed_confirmed: true })
  })

  it('runSql wraps the sql string', async () => {
    ;((globalThis as any).fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ kind: 'rows', rows: [{ id: 1 }] }),
    })
    const r = await adminApi.runSql('select 1')
    expect(r).toEqual({ kind: 'rows', rows: [{ id: 1 }] })
    const body = JSON.parse(((globalThis as any).fetch as Mock).mock.calls[0][1].body)
    expect(body.payload).toEqual({ sql: 'select 1' })
  })
})
