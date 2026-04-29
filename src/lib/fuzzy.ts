// [BUG-515] Fuzzy match helpers for the seeder. Pure functions with no
// external deps. Used to suggest target series (new-job form) and to
// auto-link incoming Speedhive drivers to existing series_entries
// (review page) when transponder / race-number matching falls through.
//
// Scores are 0-100. Conventions:
//   ≥ 90 → almost certainly the same thing
//   75-89 → confident enough to auto-pick (we still surface it)
//   60-74 → suggest, do not auto-pick
//   < 60  → ignore

export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Levenshtein distance — capped to short strings so we don't allocate
// huge matrices for long inputs.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 32) return Math.max(m, n)
  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    [prev, curr] = [curr, prev]
  }
  return prev[n]
}

// 0-100 string similarity from edit distance — works well for short
// strings (driver names, series titles).
export function stringScore(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 100
  const longest = Math.max(na.length, nb.length)
  const dist = levenshtein(na, nb)
  return Math.round(((longest - dist) / longest) * 100)
}

// Token-set score — order-independent overlap of word tokens. Beats
// pure edit distance for "Daniel Angus" vs "Angus, Daniel" or "D Angus".
export function tokenScore(a: string, b: string): number {
  const ta = new Set(normalize(a).split(' ').filter(Boolean))
  const tb = new Set(normalize(b).split(' ').filter(Boolean))
  if (ta.size === 0 || tb.size === 0) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap += 1
  // Jaccard-style: overlap / union, scaled.
  const union = ta.size + tb.size - overlap
  return Math.round((overlap / union) * 100)
}

// Combined name score — token overlap is the primary signal, edit
// distance fills in for typos / single-word names. Whichever is higher
// wins, so "Stephanie Chambers" matches "Steph Chambers" (token=50,
// string=80 → 80) and "Smith" still matches "Smyth" (string=80).
export function nameScore(a: string, b: string): number {
  return Math.max(tokenScore(a, b), stringScore(a, b))
}

// Season normaliser — "2024/25", "2024-25", "2024/2025", "24/25" all
// equivalent. Returns the canonical "YYYY/YY" form, or "" if no year
// pair extractable.
export function canonSeason(s: string | null | undefined): string {
  const m = (s ?? '').match(/(\d{2,4})\s*[/\-]\s*(\d{2,4})/)
  if (!m) {
    const single = (s ?? '').match(/\b(20\d{2})\b/)
    return single ? `${single[1]}` : ''
  }
  const a = m[1].length === 2 ? `20${m[1]}` : m[1]
  const b = m[2].length === 2 ? m[2] : m[2].slice(-2)
  return `${a}/${b}`
}

// Derive a likely season string from a date window (e.g. 2024-10-01 →
// 2025-04-30 ≈ "2024/25"). Used to compare against series.season when
// the user hasn't typed it.
export function seasonFromDates(from: string, to: string): string {
  const yf = (from ?? '').slice(0, 4)
  const yt = (to ?? '').slice(0, 4)
  if (!yf) return ''
  if (!yt || yt === yf) return yf
  return `${yf}/${yt.slice(-2)}`
}

export interface ScoredMatch<T> { item: T; score: number }

// Score every candidate against `needle` using the provided scoring fn,
// return them sorted desc. Top of the list is the suggestion.
export function rankMatches<T>(
  needle: string,
  candidates: T[],
  toString: (c: T) => string,
  score: (a: string, b: string) => number = nameScore,
): ScoredMatch<T>[] {
  return candidates
    .map((item) => ({ item, score: score(needle, toString(item)) }))
    .sort((a, b) => b.score - a.score)
}
