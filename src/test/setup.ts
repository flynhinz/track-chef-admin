import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// [BUG-292 follow-up] adminApi.ts reads env vars at module load — vitest's
// vi.stubEnv() in beforeEach() fires too late. Seed safe placeholder values
// into import.meta.env here (before any test-file imports) so modules can
// resolve FUNCTION_URL / ANON_KEY on first load. Individual tests still
// exercise the "missing env" path via direct stubbing where it matters.
const env = import.meta.env as Record<string, string>
if (!env.VITE_SUPABASE_ADMIN_FUNCTION_URL) {
  env.VITE_SUPABASE_ADMIN_FUNCTION_URL = 'https://test.supabase.co/functions/v1/admin-query'
}
if (!env.VITE_SUPABASE_ANON_KEY) {
  env.VITE_SUPABASE_ANON_KEY = 'anon-key'
}
if (!env.VITE_SUPABASE_URL) {
  env.VITE_SUPABASE_URL = 'https://test.supabase.co'
}

afterEach(() => {
  cleanup()
})

// jsdom doesn't implement window.confirm — tests can override per-case
if (typeof window !== 'undefined' && !window.confirm) {
  Object.defineProperty(window, 'confirm', { value: () => true, writable: true })
}
