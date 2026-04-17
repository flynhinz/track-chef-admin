#!/usr/bin/env node
// Post test-run results to the admin portal's admin-query Edge Function.
// Expected env vars:
//   VITE_SUPABASE_ADMIN_FUNCTION_URL — the admin-query function URL
//   ADMIN_REPORTER_TOKEN             — a super-admin access token (service-role-backed session)
//   BUILD_REF                        — e.g. BUILD-16 (must match a row in admin_builds)
//   TEST_KIND                        — unit | regression | e2e (default: unit)
//   COMMIT_HASH (optional), DETAILS_URL (optional)
//
// Reads vitest JSON from stdin OR from ./test-results.json and sums passed/failed/skipped.
// Usage in CI:
//   vitest run --reporter=json --outputFile=test-results.json \
//     && node scripts/report-test-run.mjs

import { readFileSync } from 'node:fs'

const fnUrl = process.env.VITE_SUPABASE_ADMIN_FUNCTION_URL
const token = process.env.ADMIN_REPORTER_TOKEN
const buildRef = process.env.BUILD_REF
const kind = process.env.TEST_KIND || 'unit'
const commitHash = process.env.COMMIT_HASH || process.env.GITHUB_SHA || null
const detailsUrl = process.env.DETAILS_URL || null

if (!fnUrl || !token || !buildRef) {
  console.error('[report-test-run] Missing required env: VITE_SUPABASE_ADMIN_FUNCTION_URL, ADMIN_REPORTER_TOKEN, BUILD_REF')
  process.exit(1)
}

const src = process.env.RESULTS_FILE || 'test-results.json'
let raw
try { raw = readFileSync(src, 'utf8') }
catch (e) { console.error(`[report-test-run] Could not read ${src}: ${e.message}`); process.exit(1) }
const data = JSON.parse(raw)

let total = 0, passed = 0, failed = 0, skipped = 0
for (const f of data.testResults ?? []) {
  for (const a of f.assertionResults ?? []) {
    total++
    if (a.status === 'passed') passed++
    else if (a.status === 'failed') failed++
    else if (a.status === 'pending' || a.status === 'skipped' || a.status === 'todo') skipped++
  }
}

console.log(`[report-test-run] ${buildRef} ${kind}: ${passed}✓ ${failed}✗ ${skipped}↷ / ${total}`)

const res = await fetch(fnUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    action: 'report_test_run',
    payload: { build_ref: buildRef, kind, total, passed, failed, skipped, commit_hash: commitHash, details_url: detailsUrl },
  }),
})

if (!res.ok) {
  const body = await res.text()
  console.error(`[report-test-run] HTTP ${res.status}: ${body}`)
  process.exit(1)
}
const out = await res.json()
console.log(`[report-test-run] reported run id=${out.id}`)
