// [BUG-293] Platform Announcements — scaffolded nav entry, coming-soon placeholder.
// Future state: push a banner to all users (optionally scoped to persona or tenant).

import ComingSoon from '../components/ComingSoon'

export default function AnnouncementsPage() {
  return (
    <ComingSoon
      title='Announcements'
      description='Push platform-wide banner messages to every Track-Chef user. Schedule, target by persona or tenant, and retire after a window.'
      nextUp={[
        'Write a short-lived banner + dismissible flag',
        'Target by persona (e.g. only series_coordinators) or tenant',
        'Schedule start + auto-expire time',
      ]}
      testId='announcements-coming-soon'
    />
  )
}
