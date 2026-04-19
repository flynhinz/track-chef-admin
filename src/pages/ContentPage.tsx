// [BUG-293] Content tab — Rowena's Help-Centre editor.
//
// Left sidebar: persona + language filters + text search.
// Main panel:   list of articles (title, persona / content_type / slug,
//               body preview) OR an editor when a row is selected.
// Editor:       inline title + body textarea, unsaved-changes indicator,
//               Save / Cancel buttons calling update_help_article.
//
// Schema reminder — the DB uses persona_content_translations
// (id, content_id, language_code, title, body) joined to persona_content
// (persona_id, content_type, slug). Spec referenced content_key / language
// which don't exist; this component uses the real columns.

import { useEffect, useMemo, useState } from 'react'
import { adminApi, type HelpArticle } from '../lib/adminApi'
import {
  KNOWN_LANGUAGES,
  KNOWN_PERSONAS,
  bodyPreview,
  filterArticles,
  isDirty,
  type ContentFilters,
} from '../lib/helpContentHelpers'

const input = {
  background: '#141414',
  border: '1px solid #2A2A2A',
  borderRadius: 4,
  padding: '6px 10px',
  color: '#F5F5F5',
  fontSize: 13,
  outline: 'none',
  width: '100%',
} as const

const buttonBase = {
  border: '1px solid #2A2A2A',
  borderRadius: 4,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
  color: '#F5F5F5',
  background: 'none',
} as const

export default function ContentPage() {
  const [articles, setArticles] = useState<HelpArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ContentFilters>({ persona: null, language: null, search: '' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    setError(null)
    adminApi
      .listHelpArticles()
      .then((rows) => setArticles(rows ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => filterArticles(articles, filters), [articles, filters])
  const selected = useMemo(
    () => (selectedId ? articles.find((a) => a.id === selectedId) ?? null : null),
    [articles, selectedId],
  )
  const dirty = isDirty(selected, draft)

  const selectArticle = (a: HelpArticle) => {
    setSelectedId(a.id)
    setDraft({ title: a.title, body: a.body })
  }

  const closeEditor = () => {
    setSelectedId(null)
    setDraft(null)
  }

  const save = async () => {
    if (!selected || !draft) return
    setSaving(true)
    try {
      const updated = await adminApi.updateHelpArticle({
        id: selected.id,
        title: draft.title,
        body: draft.body,
      })
      setArticles((cur) => cur.map((a) => (a.id === selected.id ? { ...a, ...updated } : a)))
      setDraft({ title: updated.title, body: updated.body })
    } catch (e) {
      const err = e as Error
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid='content-page'>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Content</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Manage Help Centre articles used throughout Track-Chef. Edits write to{' '}
        <code style={{ color: '#F5F5F5' }}>persona_content_translations</code> via the admin-query edge function.
      </p>

      {error && (
        <div style={{ padding: '8px 12px', background: '#DC262610', border: '1px solid #DC262630', borderRadius: 4, color: '#DC2626', fontSize: 13, marginBottom: 12 }} data-testid='content-error'>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24 }}>
        {/* Sidebar filters */}
        <aside data-testid='content-filters'>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#888', marginBottom: 4, letterSpacing: '0.05em' }}>Persona</label>
            <select
              value={filters.persona ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, persona: e.target.value || null }))}
              style={input}
              data-testid='content-filter-persona'
            >
              <option value=''>All personas</option>
              {KNOWN_PERSONAS.map((p) => (
                <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#888', marginBottom: 4, letterSpacing: '0.05em' }}>Language</label>
            <select
              value={filters.language ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, language: e.target.value || null }))}
              style={input}
              data-testid='content-filter-language'
            >
              <option value=''>All languages</option>
              {KNOWN_LANGUAGES.map((l) => (
                <option key={l} value={l}>{l.toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#888', marginBottom: 4, letterSpacing: '0.05em' }}>Search</label>
            <input
              type='text'
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder='title or slug'
              style={input}
              data-testid='content-filter-search'
            />
          </div>

          <p style={{ fontSize: 11, color: '#666' }}>
            {loading ? 'Loading…' : `${filtered.length} of ${articles.length}`}
          </p>
        </aside>

        {/* Main panel */}
        <section>
          {selected && draft ? (
            <div data-testid='content-editor'>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>
                    {selected.persona_id ?? '—'} · {selected.content_type ?? '—'} · {selected.slug ?? '—'} · {selected.language_code.toUpperCase()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {dirty && <span style={{ fontSize: 11, color: '#FBBF24' }} data-testid='content-dirty-indicator'>Unsaved changes</span>}
                  <button onClick={closeEditor} style={buttonBase} data-testid='content-cancel'>Cancel</button>
                  <button
                    onClick={save}
                    disabled={!dirty || saving}
                    style={{ ...buttonBase, background: dirty && !saving ? '#DC2626' : '#333', borderColor: 'transparent', color: '#fff', opacity: dirty && !saving ? 1 : 0.6 }}
                    data-testid='content-save'
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
              <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#888', marginBottom: 4, letterSpacing: '0.05em' }}>Title</label>
              <input
                type='text'
                value={draft.title}
                onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                style={{ ...input, marginBottom: 16 }}
                data-testid='content-editor-title'
              />
              <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#888', marginBottom: 4, letterSpacing: '0.05em' }}>Body (markdown)</label>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft((d) => (d ? { ...d, body: e.target.value } : d))}
                rows={20}
                style={{ ...input, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, resize: 'vertical' }}
                data-testid='content-editor-body'
              />
            </div>
          ) : (
            <div>
              {loading ? (
                <p style={{ color: '#888', fontSize: 13 }}>Loading articles…</p>
              ) : filtered.length === 0 ? (
                <p style={{ color: '#888', fontSize: 13 }} data-testid='content-empty'>No articles match the current filters.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid='content-list'>
                  {filtered.map((a) => (
                    <li
                      key={a.id}
                      onClick={() => selectArticle(a)}
                      style={{
                        padding: '10px 12px',
                        border: '1px solid #2A2A2A',
                        borderRadius: 4,
                        marginBottom: 8,
                        cursor: 'pointer',
                        background: '#141414',
                      }}
                      data-testid={`content-row-${a.id}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F5F5' }}>{a.title}</div>
                        <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
                          {a.persona_id ?? '—'} · {a.language_code.toUpperCase()}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                        {a.content_type ?? '—'} · {a.slug ?? '—'}
                      </div>
                      <div style={{ fontSize: 12, color: '#AAA', marginTop: 6, lineHeight: 1.4 }}>
                        {bodyPreview(a.body, 160) || '(no body)'}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
