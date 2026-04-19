// [BUG-293] Shared coming-soon placeholder for Series + Announcements nav entries.

interface Props {
  title: string
  description: string
  nextUp: string[]
  testId: string
}

export default function ComingSoon({ title, description, nextUp, testId }: Props) {
  return (
    <div data-testid={testId}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{title}</h1>
      <div
        style={{
          background: '#141414',
          border: '1px dashed #2A2A2A',
          borderRadius: 8,
          padding: 32,
          maxWidth: 640,
        }}
      >
        <div style={{ display: 'inline-block', padding: '4px 10px', background: '#FBBF2410', border: '1px solid #FBBF2430', borderRadius: 999, fontSize: 11, color: '#FBBF24', marginBottom: 12 }}>
          Coming soon
        </div>
        <p style={{ fontSize: 14, color: '#F5F5F5', lineHeight: 1.5, marginBottom: 16 }}>{description}</p>
        <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888', marginBottom: 8 }}>On the roadmap</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#AAA', lineHeight: 1.6 }}>
          {nextUp.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
