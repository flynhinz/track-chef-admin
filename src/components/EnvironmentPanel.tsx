import BuildInfo from './BuildInfo'

const EXPECTED_PROJECT_REF = 'ktteslxmcbphxsmxanlz'
const EXPECTED_KEY_SUFFIX = 'cW60'

function truncate(v: string | undefined): string {
  if (!v) return ''
  if (v.length <= 20) return v
  return `${v.slice(0, 12)}...${v.slice(-6)}`
}

function Row({ label, value, warn }: { label: string; value: string | undefined; warn?: { color: string; message: string } }) {
  const missing = !value
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, padding: '8px 0', borderBottom: '1px solid #1A1A1A', alignItems: 'baseline' }}>
      <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {missing ? (
        <div style={{ fontSize: 12, color: '#DC2626', fontFamily: 'monospace' }}>⚠️ NOT SET</div>
      ) : (
        <div style={{ fontSize: 12, color: '#F5F5F5', fontFamily: 'monospace', wordBreak: 'break-all' }}>
          <div>{value}</div>
          {warn && <div style={{ color: warn.color, marginTop: 4 }}>⚠️ {warn.message}</div>}
        </div>
      )}
    </div>
  )
}

export default function EnvironmentPanel() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  const adminFnUrl = import.meta.env.VITE_SUPABASE_ADMIN_FUNCTION_URL as string | undefined

  const urlWarn = supabaseUrl && !supabaseUrl.includes(EXPECTED_PROJECT_REF)
    ? { color: '#D97706', message: `Wrong project — expected ${EXPECTED_PROJECT_REF}` }
    : undefined
  const anonWarn = anonKey && !anonKey.endsWith(EXPECTED_KEY_SUFFIX)
    ? { color: '#D97706', message: 'Key mismatch — check Cloudflare env vars' }
    : undefined
  const pubWarn = publishableKey && !publishableKey.endsWith(EXPECTED_KEY_SUFFIX)
    ? { color: '#D97706', message: 'Key mismatch — check Cloudflare env vars' }
    : undefined

  return (
    <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 20 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 12, color: '#F5F5F5' }}>Environment</h2>
      <Row label='SUPABASE_URL' value={supabaseUrl} warn={urlWarn} />
      <Row label='ANON_KEY' value={truncate(anonKey)} warn={anonWarn} />
      <Row label='PUBLISHABLE_KEY' value={truncate(publishableKey)} warn={pubWarn} />
      <Row label='ADMIN_FUNCTION_URL' value={adminFnUrl} />
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, padding: '8px 0', alignItems: 'baseline' }}>
        <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Build</div>
        <BuildInfo muted={false} />
      </div>
    </div>
  )
}
