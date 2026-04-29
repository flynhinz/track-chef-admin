// [BUG-293] Content tab — Help Centre article editor.
// Covers the pure helpers (filter + preview + dirty) and static
// structure guards on ContentPage, App routing, TopNav, and the
// coming-soon pages for Series + Announcements.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  KNOWN_LANGUAGES,
  KNOWN_PERSONAS,
  bodyPreview,
  filterArticles,
  isDirty,
} from '../lib/helpContentHelpers'
import type { HelpArticle } from '../lib/adminApi'

const read = (rel: string) =>
  readFileSync(resolve(__dirname, '..', '..', rel), 'utf8')

const PAGE = read('src/pages/ContentPage.tsx')
const APP = read('src/App.tsx')
const NAV = read('src/components/TopNav.tsx')
const API = read('src/lib/adminApi.ts')
const SERIES = read('src/pages/SeriesPage.tsx')
const ANN = read('src/pages/AnnouncementsPage.tsx')
const COMING = read('src/components/ComingSoon.tsx')

const mk = (over: Partial<HelpArticle>): HelpArticle => ({
  id: over.id ?? '00000000-0000-0000-0000-000000000001',
  content_id: over.content_id ?? '00000000-0000-0000-0000-00000000aaaa',
  persona_id: over.persona_id ?? 'driver',
  content_type: over.content_type ?? 'academy_intro',
  slug: over.slug ?? 'sample-slug',
  language_code: over.language_code ?? 'en',
  title: over.title ?? 'Sample Title',
  body: over.body ?? 'Sample body',
  status: over.status ?? 'published',
  updated_at: over.updated_at ?? null,
})

// ── pure helpers ────────────────────────────────────────────────────────────

describe('[BUG-293] filterArticles', () => {
  const articles: HelpArticle[] = [
    mk({ id: '1', persona_id: 'driver', language_code: 'en', title: 'Getting Started', slug: 'driver-start' }),
    mk({ id: '2', persona_id: 'series_coordinator', language_code: 'en', title: 'Running a Series', slug: 'sc-running' }),
    mk({ id: '3', persona_id: 'driver', language_code: 'de', title: 'Erste Schritte', slug: 'driver-start' }),
    mk({ id: '4', persona_id: 'car_owner', language_code: 'en', title: 'Car Management', slug: 'co-cars' }),
  ]

  it('returns everything when no filters are set', () => {
    const out = filterArticles(articles, { persona: null, language: null, search: '' })
    expect(out.map((a) => a.id)).toEqual(['1', '2', '3', '4'])
  })

  it('filters by persona', () => {
    const out = filterArticles(articles, { persona: 'driver', language: null, search: '' })
    expect(out.map((a) => a.id).sort()).toEqual(['1', '3'])
  })

  it('filters by language', () => {
    const out = filterArticles(articles, { persona: null, language: 'en', search: '' })
    expect(out.map((a) => a.id).sort()).toEqual(['1', '2', '4'])
  })

  it('combines persona + language filters (intersection)', () => {
    const out = filterArticles(articles, { persona: 'driver', language: 'de', search: '' })
    expect(out.map((a) => a.id)).toEqual(['3'])
  })

  it('search matches title / slug / persona / content_type case-insensitively', () => {
    expect(filterArticles(articles, { persona: null, language: null, search: 'GETTING' })
      .map((a) => a.id)).toEqual(['1'])
    expect(filterArticles(articles, { persona: null, language: null, search: 'sc-running' })
      .map((a) => a.id)).toEqual(['2'])
  })
})

describe('[BUG-293] bodyPreview', () => {
  it('returns empty string for null / blank', () => {
    expect(bodyPreview(null)).toBe('')
    expect(bodyPreview(undefined)).toBe('')
    expect(bodyPreview('   ')).toBe('')
  })

  it('strips common markdown and collapses whitespace', () => {
    const out = bodyPreview('## Heading\n**Bold** *em* [link](x)\n- item', 200)
    expect(out).not.toMatch(/##|\*\*|\[|\]|\(|\)/)
    expect(out).toContain('Heading')
    expect(out).toContain('Bold')
  })

  it('truncates with ellipsis when longer than max', () => {
    const out = bodyPreview('a'.repeat(300), 120)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(120)
  })
})

describe('[BUG-293] isDirty', () => {
  const a = mk({ title: 'Title', body: 'Body' })

  it('false when article or draft is null', () => {
    expect(isDirty(null, { title: 't', body: 'b' })).toBe(false)
    expect(isDirty(a, null)).toBe(false)
  })

  it('false when draft matches article', () => {
    expect(isDirty(a, { title: 'Title', body: 'Body' })).toBe(false)
  })

  it('true when title or body diverges', () => {
    expect(isDirty(a, { title: 'Title changed', body: 'Body' })).toBe(true)
    expect(isDirty(a, { title: 'Title', body: 'Body changed' })).toBe(true)
  })
})

describe('[BUG-293] known personas + languages', () => {
  it('exposes the 13 personas the DB has content for', () => {
    expect(KNOWN_PERSONAS.length).toBe(13)
    for (const p of ['driver', 'series_coordinator', 'car_owner', 'race_engineer', 'mechanic']) {
      expect(KNOWN_PERSONAS).toContain(p)
    }
  })
  it('exposes the six spec language codes', () => {
    expect([...KNOWN_LANGUAGES].sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt'])
  })
})

// ── adminApi wiring ─────────────────────────────────────────────────────────

describe('[BUG-293] adminApi exposes listHelpArticles + updateHelpArticle', () => {
  it('listHelpArticles calls the EF with action=list_help_articles', () => {
    expect(API).toMatch(/listHelpArticles.*callAdmin\('list_help_articles'\)/)
  })
  it('updateHelpArticle forwards id/title/body', () => {
    expect(API).toMatch(/updateHelpArticle[\s\S]{0,200}callAdmin\('update_help_article',\s*p\)/)
    expect(API).toMatch(/export interface HelpArticle/)
    expect(API).toMatch(/language_code:\s*string/)
  })
})

// ── ContentPage structure ───────────────────────────────────────────────────

describe('[BUG-293] ContentPage renders filters + list + editor', () => {
  it('exposes sidebar filter testids for persona + language + search', () => {
    expect(PAGE).toMatch(/data-testid=['"]content-filter-persona['"]/)
    expect(PAGE).toMatch(/data-testid=['"]content-filter-language['"]/)
    expect(PAGE).toMatch(/data-testid=['"]content-filter-search['"]/)
  })

  it('renders a list row per filtered article with stable testid', () => {
    expect(PAGE).toMatch(/data-testid=\{`content-row-\$\{a\.id\}`\}/)
    expect(PAGE).toMatch(/filterArticles\(articles, filters\)/)
  })

  it('opens the editor when a row is clicked', () => {
    expect(PAGE).toMatch(/data-testid=['"]content-editor['"]/)
    expect(PAGE).toMatch(/data-testid=['"]content-editor-title['"]/)
    expect(PAGE).toMatch(/data-testid=['"]content-editor-body['"]/)
  })

  it('surfaces an "Unsaved changes" indicator while dirty', () => {
    expect(PAGE).toMatch(/data-testid=['"]content-dirty-indicator['"]/)
    expect(PAGE).toMatch(/const dirty = isDirty\(selected, draft\)/)
  })

  it('Save button invokes updateHelpArticle with id/title/body', () => {
    expect(PAGE).toMatch(/adminApi\.updateHelpArticle\(\{[\s\S]{0,120}id:\s*selected\.id/)
    expect(PAGE).toMatch(/title:\s*draft\.title/)
    expect(PAGE).toMatch(/body:\s*draft\.body/)
  })

  it('uses the actual DB columns (language_code, persona_id from joined persona_content)', () => {
    // Guardrail: the spec referenced content_key / language which do not
    // exist. The real DB columns are language_code + (via join) persona_id.
    // Strip single-line + block comments so explanatory text mentioning
    // the missing column names doesn't trigger a false positive.
    const code = PAGE.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/\bcontent_key\b/)
    expect(code).toMatch(/language_code/)
    expect(code).toMatch(/persona_id/)
  })
})

// ── Routing + nav ───────────────────────────────────────────────────────────

describe('[BUG-293] App registers Content / Series / Announcements behind ProtectedRoute', () => {
  it('all three routes are present + gated', () => {
    for (const path of ['/content', '/series', '/announcements']) {
      const re = new RegExp(`<Route path='${path}' element=\\{<ProtectedRoute>`)
      expect(APP).toMatch(re)
    }
  })
})

describe('[BUG-293] TopNav shows Content between Users and Builds', () => {
  it('renders nav items for Content / Series / Announcements', () => {
    expect(NAV).toMatch(/navItem\('\/content',\s*'Content'\)/)
    expect(NAV).toMatch(/navItem\('\/series',\s*'Series'\)/)
    expect(NAV).toMatch(/navItem\('\/announcements',\s*'Announcements'\)/)
  })

  it('Content sits between Tenants and Builds in the nav order', () => {
    // [BUG-317 #4] Tenants & Users subsumed the standalone Users nav
    // entry. Content now sits between Tenants & Users and Builds.
    const tenantsIdx = NAV.indexOf("navItem('/tenants'")
    const contentIdx = NAV.indexOf("navItem('/content'")
    const buildsIdx = NAV.indexOf("navItem('/builds'")
    expect(tenantsIdx).toBeGreaterThan(-1)
    expect(contentIdx).toBeGreaterThan(tenantsIdx)
    expect(buildsIdx).toBeGreaterThan(contentIdx)
  })
})

// ── Coming-soon placeholders ────────────────────────────────────────────────

// [BUG-454] Series moved from coming-soon to a wired SQL-driven table
// (linked / unlinked driver counts, status badges, ⚠️ on artefacts).
describe('[BUG-454] Series renders a wired SQL table', () => {
  it('Series page reads from selectRows and renders the new columns', () => {
    expect(SERIES).toMatch(/selectRows/)
    expect(SERIES).toMatch(/data-testid=['"]series-table['"]/)
    expect(SERIES).toMatch(/unlinked_entries/)
  })
  // [BUG-317 #7] Announcements moved from coming-soon to a wired
  // round_communications table — see bug317AdminPortal.test.ts.
  it('shared ComingSoon surfaces a test-id + "Coming soon" label', () => {
    expect(COMING).toMatch(/data-testid=\{testId\}/)
    expect(COMING).toMatch(/Coming soon/)
  })
})
