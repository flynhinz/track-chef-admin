// [BUG-317] Admin portal fixes — Announcements wiring, SQL copy,
// combined Tenants+Users view, Dashboard signups search/sort.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) =>
  readFileSync(resolve(__dirname, '..', '..', rel), 'utf8')

const ANN = read('src/pages/AnnouncementsPage.tsx')
const SQL = read('src/pages/SqlPage.tsx')
const TENANTS = read('src/pages/TenantsPage.tsx')
const DASH = read('src/pages/DashboardPage.tsx')
const NAV = read('src/components/TopNav.tsx')
const API = read('src/lib/adminApi.ts')

// ── #7 Announcements wired ──────────────────────────────────────────────────

describe('[BUG-317 #7] Announcements tab wired to round_communications', () => {
  it('no longer uses the ComingSoon placeholder', () => {
    expect(ANN).not.toMatch(/ComingSoon/)
  })
  it('calls adminApi.listAnnouncements', () => {
    expect(ANN).toMatch(/adminApi\.listAnnouncements\(\)/)
  })
  it('adminApi exposes listAnnouncements + AdminAnnouncement type', () => {
    expect(API).toMatch(/export interface AdminAnnouncement/)
    expect(API).toMatch(/listAnnouncements.*callAdmin\('list_announcements'\)/)
  })
  it('renders columns for tenant, event, subject, status, sent, created', () => {
    expect(ANN).toMatch(/data-testid=['"]announcements-table['"]/)
    expect(ANN).toMatch(/tenant_name/)
    expect(ANN).toMatch(/event_name/)
    expect(ANN).toMatch(/sent_count/)
  })
  it('exposes search input + sortable column headers', () => {
    expect(ANN).toMatch(/data-testid=['"]announcements-search['"]/)
    expect(ANN).toMatch(/data-testid=\{`announcements-sort-\$\{f\}`\}/)
  })
  it('surfaces a graceful empty state', () => {
    expect(ANN).toMatch(/data-testid=['"]announcements-empty['"]/)
    expect(ANN).toMatch(/No announcements yet/)
  })
})

// ── #6 SQL Copy JSON ────────────────────────────────────────────────────────

describe('[BUG-317 #6] SQL console exposes Copy JSON', () => {
  it('ResultTable renders a Copy JSON button that uses navigator.clipboard', () => {
    expect(SQL).toMatch(/data-testid=['"]sql-copy-json['"]/)
    expect(SQL).toMatch(/navigator\.clipboard\.writeText\(JSON\.stringify\(rows,\s*null,\s*2\)\)/)
  })
  it('also exposes a Copy CSV button for quick spreadsheet paste', () => {
    expect(SQL).toMatch(/data-testid=['"]sql-copy-csv['"]/)
  })
})

// ── #4 Combined Tenants + Users ─────────────────────────────────────────────

describe('[BUG-317 #4] Tenants page combines users inline', () => {
  it('page heading calls out the combined view', () => {
    expect(TENANTS).toMatch(/Tenants & Users/)
  })
  it('renders expandable rows keyed per tenant id', () => {
    expect(TENANTS).toMatch(/data-testid=\{`tenant-row-\$\{t\.id\}`\}/)
    expect(TENANTS).toMatch(/data-testid=\{`tenant-users-\$\{t\.id\}`\}/)
  })
  it('loads users lazily on expand (cached by tenant id)', () => {
    expect(TENANTS).toMatch(/adminApi\.getAllUsers\(tenantId\)/)
    expect(TENANTS).toMatch(/usersByTenant/)
  })
  it('exposes search inputs at both levels', () => {
    expect(TENANTS).toMatch(/data-testid=['"]tenants-search['"]/)
    expect(TENANTS).toMatch(/data-testid=['"]tenant-users-search['"]/)
  })
  it('exposes sortable headers at both levels', () => {
    // Both tenant-level and user-level columns share the sortableTh helper
    // with data-testid={`sort-${field}`}.
    expect(TENANTS).toMatch(/sortableTh\(/)
    expect(TENANTS).toMatch(/data-testid=\{`sort-\$\{field\}`\}/)
  })
  it('Users nav entry replaced by "Tenants & Users" in TopNav', () => {
    expect(NAV).toMatch(/navItem\('\/tenants',\s*'Tenants & Users'\)/)
    expect(NAV).not.toMatch(/navItem\('\/users'/)
  })
})

// ── #3 Dashboard Recent Signups search + sort ───────────────────────────────

describe('[BUG-317 #3] Recent Signups gets search + sortable columns', () => {
  it('renders a search input bound to signupSearch state', () => {
    expect(DASH).toMatch(/data-testid=['"]signups-search['"]/)
    expect(DASH).toMatch(/filterSignups\(allUsers, signupSearch\)/)
  })
  it('uses sortSignups with a toggleSignupSort handler', () => {
    expect(DASH).toMatch(/sortSignups\(/)
    expect(DASH).toMatch(/toggleSignupSort/)
  })
  it('column headers render the sort-${field} testid', () => {
    expect(DASH).toMatch(/data-testid=\{`sort-\$\{field\}`\}/)
  })
  it('caps at 20 rows when no search is active', () => {
    expect(DASH).toMatch(/visibleSignups\.slice\(0,\s*20\)/)
  })
})
