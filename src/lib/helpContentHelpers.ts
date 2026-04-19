// [BUG-293] Pure helpers for the admin Content tab. Split from ContentPage
// so vitest can pin filter + dirty-check behaviour without dragging a DOM.

import type { HelpArticle } from './adminApi'

// 13 personas live in persona_content today (see DB). Hard-coded rather
// than derived from the data so the filter list stays stable even when a
// persona has zero articles in the current language.
export const KNOWN_PERSONAS: ReadonlyArray<string> = [
  'billing_admin',
  'car_owner',
  'comms_results',
  'driver',
  'event_organiser',
  'mechanic',
  'photographer',
  'race_engineer',
  'series_coordinator',
  'team_manager',
  'technical_officer',
  'weekend_coordinator',
  'workshop_manager',
]

// Spec language options. The DB currently holds `en` only; the rest are
// forward-looking so the dropdown doesn't churn when translations ship.
export const KNOWN_LANGUAGES: ReadonlyArray<string> = ['en', 'de', 'fr', 'es', 'it', 'pt']

export interface ContentFilters {
  persona: string | null   // null = all personas
  language: string | null  // null = all languages
  search: string           // case-insensitive substring against title + slug
}

export function filterArticles(
  articles: ReadonlyArray<HelpArticle>,
  filters: ContentFilters,
): HelpArticle[] {
  const q = (filters.search ?? '').trim().toLowerCase()
  return articles.filter((a) => {
    if (filters.persona && a.persona_id !== filters.persona) return false
    if (filters.language && a.language_code !== filters.language) return false
    if (q) {
      const hay =
        `${(a.title ?? '').toLowerCase()}|${(a.slug ?? '').toLowerCase()}|${(a.persona_id ?? '').toLowerCase()}|${(a.content_type ?? '').toLowerCase()}`
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** First `max` characters of the body with markdown stripped + whitespace collapsed. */
export function bodyPreview(body: string | null | undefined, max = 120): string {
  if (!body) return ''
  const stripped = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!stripped) return ''
  if (stripped.length <= max) return stripped
  return `${stripped.slice(0, max - 1).trimEnd()}…`
}

/** True when the draft diverges from the source article. */
export function isDirty(
  article: Pick<HelpArticle, 'title' | 'body'> | null,
  draft: { title: string; body: string } | null,
): boolean {
  if (!article || !draft) return false
  return article.title !== draft.title || article.body !== draft.body
}
