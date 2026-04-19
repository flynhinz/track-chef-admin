// [BUG-293] Series admin — scaffolded nav entry, coming-soon placeholder.
// Future state: view/edit series + coordinators from here.

import ComingSoon from '../components/ComingSoon'

export default function SeriesPage() {
  return (
    <ComingSoon
      title='Series'
      description='View and edit series, coordinators, points systems and round calendars from here.'
      nextUp={[
        'List every series across tenants with owner coordinator',
        'Edit series metadata (name, season, class list, points system)',
        'Promote a driver/coordinator to series_coordinator',
      ]}
      testId='series-coming-soon'
    />
  )
}
