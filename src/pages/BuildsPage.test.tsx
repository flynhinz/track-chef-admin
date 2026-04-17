import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BuildsPage from './BuildsPage'

vi.mock('../lib/adminApi', () => ({
  adminApi: {
    listBuilds: vi.fn(),
    upsertBuild: vi.fn(async () => ({ id: 'b1' })),
    deleteBuild: vi.fn(async () => ({ success: true })),
    addBuildBug: vi.fn(async () => ({ id: 'bug1' })),
    toggleBuildBug: vi.fn(async () => ({ success: true })),
    deleteBuildBug: vi.fn(async () => ({ success: true })),
  },
}))

import { adminApi } from '../lib/adminApi'

const fakeBuild = {
  id: 'b1',
  build_ref: 'BUILD-99',
  title: 'Release candidate',
  notes: null,
  status: 'testing' as const,
  created_at: '2026-04-15T10:00:00Z',
  admin_build_bugs: [
    { id: 'bug1', bug_ref: 'BUG-1', description: 'first', fixed_confirmed: true, confirmed_at: '2026-04-15T11:00:00Z' },
    { id: 'bug2', bug_ref: 'BUG-2', description: 'second', fixed_confirmed: false, confirmed_at: null },
  ],
}

const renderPage = () => render(<MemoryRouter><BuildsPage /></MemoryRouter>)

describe('BuildsPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders builds with title, ref, and bug progress', async () => {
    ;(adminApi.listBuilds as any).mockResolvedValue([fakeBuild])
    renderPage()
    await waitFor(() => expect(screen.getByText('BUILD-99')).toBeInTheDocument())
    expect(screen.getByText('Release candidate')).toBeInTheDocument()
    // 1 of 2 confirmed = 50%
    expect(screen.getByText(/1\/2 bugs confirmed fixed \(50%\)/)).toBeInTheDocument()
  })

  it('shows 100% when all bugs confirmed', async () => {
    ;(adminApi.listBuilds as any).mockResolvedValue([{ ...fakeBuild, admin_build_bugs: [{ ...fakeBuild.admin_build_bugs[0] }] }])
    renderPage()
    await waitFor(() => expect(screen.getByText(/1\/1 bugs confirmed fixed \(100%\)/)).toBeInTheDocument())
  })

  it('toggles a bug when the checkbox is clicked', async () => {
    ;(adminApi.listBuilds as any).mockResolvedValue([fakeBuild])
    renderPage()
    await waitFor(() => expect(screen.getByText('BUILD-99')).toBeInTheDocument())
    const checkboxes = screen.getAllByRole('checkbox')
    // Second bug (BUG-2) is the unconfirmed one
    fireEvent.click(checkboxes[1])
    expect(adminApi.toggleBuildBug).toHaveBeenCalledWith('bug2', true)
  })

  it('shows empty state when no builds exist', async () => {
    ;(adminApi.listBuilds as any).mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByText(/No builds yet/i)).toBeInTheDocument())
  })

  it('renders unit + regression + e2e test-run badges when present', async () => {
    const buildWithRuns = {
      ...fakeBuild,
      latest_test_runs: {
        unit: { id: 'u1', kind: 'unit' as const, total: 26, passed: 26, failed: 0, skipped: 0, commit_hash: 'abc1234def', details_url: null, created_at: '2026-04-15T12:00:00Z' },
        regression: { id: 'r1', kind: 'regression' as const, total: 45, passed: 43, failed: 2, skipped: 0, commit_hash: 'abc1234def', details_url: null, created_at: '2026-04-15T12:00:00Z' },
      },
    }
    ;(adminApi.listBuilds as any).mockResolvedValue([buildWithRuns])
    renderPage()
    await waitFor(() => expect(screen.getByText('BUILD-99')).toBeInTheDocument())
    // Unit: 26 pass / 26 total
    expect(screen.getByText('26✓')).toBeInTheDocument()
    expect(screen.getByText(/\/ 26/)).toBeInTheDocument()
    // Regression: 43 pass, 2 fail
    expect(screen.getByText('43✓')).toBeInTheDocument()
    expect(screen.getByText('2✗')).toBeInTheDocument()
    // E2E has no run → shows placeholder
    expect(screen.getByText(/— no runs —/)).toBeInTheDocument()
  })
})
