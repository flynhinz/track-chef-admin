export default function BuildsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Builds</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 32 }}>CI test runs and deployment artifacts</p>
      <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 48, textAlign: 'center' as const }}>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Coming soon</div>
        <div style={{ fontSize: 12, color: '#555' }}>EPIC-95 — CI pipeline test reports and build artifacts will surface here.</div>
      </div>
    </div>
  )
}
