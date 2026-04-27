// [EPIC-211] Shared inline-style tokens for the Series Seeder pages.
// Mirrors the admin-portal palette: red accent (#DC2626), dark
// surfaces, no Tailwind.

import type { CSSProperties } from 'react'

export const tokens = {
  bg: '#0D0D0D',
  card: '#141414',
  border: '#2A2A2A',
  text: '#F5F5F5',
  muted: '#888',
  accent: '#DC2626',
  warn: '#F59E0B',
  ok: '#10B981',
} as const

export const badge = (variant: 'ok' | 'warn' | 'accent' | 'muted' = 'accent'): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
  background:
    variant === 'ok'   ? 'rgba(16,185,129,0.15)' :
    variant === 'warn' ? 'rgba(245,158,11,0.15)' :
    variant === 'muted'? 'rgba(136,136,136,0.15)' :
                          'rgba(220,38,38,0.15)',
  color:
    variant === 'ok'   ? tokens.ok :
    variant === 'warn' ? tokens.warn :
    variant === 'muted'? tokens.muted :
                          tokens.accent,
})

export const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900, margin: '0 auto' } as CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, color: tokens.text, margin: 0 } as CSSProperties,
  sub: { fontSize: 13, color: tokens.muted, margin: '4px 0 0' } as CSSProperties,
  card: { background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 8, padding: 16 } as CSSProperties,
  section: { display: 'flex', flexDirection: 'column', gap: 12 } as CSSProperties,
  label: { fontSize: 11, color: tokens.muted, textTransform: 'uppercase', letterSpacing: 0.5 } as CSSProperties,
  input: {
    width: '100%', boxSizing: 'border-box', padding: '8px 10px',
    background: tokens.bg, border: `1px solid ${tokens.border}`,
    borderRadius: 6, color: tokens.text, fontSize: 13, outline: 'none',
  } as CSSProperties,
  select: {
    width: '100%', boxSizing: 'border-box', padding: '8px 10px',
    background: tokens.bg, border: `1px solid ${tokens.border}`,
    borderRadius: 6, color: tokens.text, fontSize: 13, outline: 'none',
    appearance: 'none', cursor: 'pointer',
  } as CSSProperties,
  btn: {
    background: tokens.accent, color: '#fff', border: 'none', borderRadius: 6,
    padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  } as CSSProperties,
  btnGhost: {
    background: 'transparent', color: tokens.text, border: `1px solid ${tokens.border}`,
    borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
  } as CSSProperties,
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' } as CSSProperties,
  errorBanner: {
    background: 'rgba(220,38,38,0.10)', border: '1px solid rgba(220,38,38,0.30)',
    color: tokens.accent, padding: '8px 12px', borderRadius: 6, fontSize: 12,
  } as CSSProperties,
  okBanner: {
    background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.30)',
    color: tokens.ok, padding: '8px 12px', borderRadius: 6, fontSize: 12,
  } as CSSProperties,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as CSSProperties,
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as CSSProperties,
}
