import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UsersPage from './UsersPage'

vi.mock('../lib/adminApi', () => ({
  adminApi: {
    getAllUsers: vi.fn(),
    getAllTenants: vi.fn(),
    createUser: vi.fn(async () => ({ success: true, user_id: 'new-id' })),
    resetPassword: vi.fn(async () => ({ success: true })),
    deleteProfile: vi.fn(async () => ({ success: true })),
    // [BUG-454] New SELECT helper used to enrich the user table with
    // active_persona / car_question_answered / race_results.
    selectRows: vi.fn(async () => []),
  },
}))

import { adminApi } from '../lib/adminApi'

const baseUser = { id: 'p1', email: 'alice@example.com', display_name: 'Alice', personas: ['driver'], created_at: '2026-04-10T00:00:00Z', tenant_id: 't1', is_super_admin: false, must_reset_password: false, tenants: { name: 'Alpha Racing' } }

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(adminApi.getAllTenants as any).mockResolvedValue([{ id: 't1', name: 'Alpha Racing' }])
  })

  it('renders users with email, name, tenant, and MUST RESET badge when flagged', async () => {
    ;(adminApi.getAllUsers as any).mockResolvedValue([
      baseUser,
      { ...baseUser, id: 'p2', email: 'bob@example.com', display_name: 'Bob', must_reset_password: true },
    ])
    render(<MemoryRouter><UsersPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('alice@example.com')).toBeInTheDocument())
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('MUST RESET')).toBeInTheDocument()
  })

  it('create-user form prefills default password EG123456 and must_reset checked', async () => {
    ;(adminApi.getAllUsers as any).mockResolvedValue([])
    render(<MemoryRouter><UsersPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/0 users/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText('+ New User'))
    const passwordInput = screen.getByDisplayValue('EG123456') as HTMLInputElement
    expect(passwordInput).toBeInTheDocument()
    const mustReset = screen.getByLabelText(/User must reset password on next login/i) as HTMLInputElement
    expect(mustReset.checked).toBe(true)
  })

  it('createUser call includes must_reset flag from the checkbox', async () => {
    ;(adminApi.getAllUsers as any).mockResolvedValue([])
    render(<MemoryRouter><UsersPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/0 users/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText('+ New User'))

    const emailInput = screen.getByText('Email').nextElementSibling as HTMLInputElement
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } })
    const nameInput = screen.getByText('Display Name').nextElementSibling as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'New User' } })

    // Uncheck must_reset
    const mustReset = screen.getByLabelText(/User must reset password on next login/i) as HTMLInputElement
    fireEvent.click(mustReset)
    expect(mustReset.checked).toBe(false)

    fireEvent.click(screen.getByText('Create User'))
    await waitFor(() => expect(adminApi.createUser).toHaveBeenCalled())
    const call = (adminApi.createUser as any).mock.calls[0][0]
    expect(call.email).toBe('new@example.com')
    expect(call.display_name).toBe('New User')
    expect(call.password).toBe('EG123456')
    expect(call.must_reset).toBe(false)
  })
})
