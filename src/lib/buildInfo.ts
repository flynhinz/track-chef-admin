export const APP_VERSION = __APP_VERSION__
export const COMMIT_HASH = __COMMIT_HASH__
export const BUILD_DATE = __BUILD_DATE__

export function formatBuildDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}
