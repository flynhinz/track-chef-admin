import { APP_VERSION, COMMIT_HASH, BUILD_DATE, formatBuildDate } from '../lib/buildInfo'

export default function BuildInfo({ prefix, muted = true }: { prefix?: string; muted?: boolean }) {
  const color = muted ? '#666' : '#888'
  return (
    <span style={{ fontSize: 11, color, fontFamily: 'monospace' }}>
      {prefix ? `${prefix} · ` : ''}v{APP_VERSION} · {COMMIT_HASH} · {formatBuildDate(BUILD_DATE)}
    </span>
  )
}
