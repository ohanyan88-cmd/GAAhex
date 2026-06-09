// L-14 — unit tests for LoginView component render & interaction
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginView from '../views/LoginView'

// Mock api.login so no real network calls are made
vi.mock('../lib/api', () => ({
  api: {
    login: vi.fn(),
  },
  getToken: vi.fn(() => null),
  clearToken: vi.fn(),
  setCsrfToken: vi.fn(),
  setToken: vi.fn(),
}))

import { api } from '../lib/api'
const mockLogin = api.login as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// Helper: LoginView renders inputs with no ARIA label (span, not label element).
// Use container.querySelector for reliable selection.
function getEmailInput(container: HTMLElement) {
  return container.querySelector('input[type="email"]') as HTMLInputElement
}
function getPasswordInput(container: HTMLElement) {
  return container.querySelector('input[type="password"]') as HTMLInputElement
}

describe('LoginView', () => {
  function mount(onLogin = vi.fn()) {
    return render(<LoginView onLogin={onLogin} />)
  }

  it('renders the GAAhex logo text', () => {
    mount()
    expect(screen.getByText('GAAhex')).toBeInTheDocument()
  })

  it('renders email and password inputs', () => {
    const { container } = mount()
    expect(getEmailInput(container)).toBeInTheDocument()
    expect(getPasswordInput(container)).toBeInTheDocument()
  })

  it('renders the submit button', () => {
    mount()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('does not show an error banner initially', () => {
    mount()
    expect(screen.queryByText(/login failed/i)).not.toBeInTheDocument()
  })

  it('calls api.login with email and password on submit', async () => {
    mockLogin.mockResolvedValueOnce({ access_token: '', csrf_token: null, customer: {} })
    const onLogin = vi.fn()
    const { container } = mount(onLogin)

    await userEvent.type(getEmailInput(container), 'user@test.com')
    await userEvent.type(getPasswordInput(container), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('user@test.com', 'secret'))
  })

  it('calls onLogin callback after successful login', async () => {
    mockLogin.mockResolvedValueOnce({ access_token: 'tok', csrf_token: null, customer: {} })
    const onLogin = vi.fn()
    const { container } = mount(onLogin)

    await userEvent.type(getEmailInput(container), 'user@test.com')
    await userEvent.type(getPasswordInput(container), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce())
  })

  it('shows an error message when api.login rejects', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'))
    const { container } = mount()

    await userEvent.type(getEmailInput(container), 'bad@test.com')
    await userEvent.type(getPasswordInput(container), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument())
  })

  it('disables the submit button while loading', async () => {
    // Never resolves during this test — keeps the button in loading state
    mockLogin.mockImplementation(() => new Promise(() => {}))
    const { container } = mount()

    await userEvent.type(getEmailInput(container), 'user@test.com')
    await userEvent.type(getPasswordInput(container), 'secret')
    await userEvent.click(screen.getByRole('button'))

    // After click the button should be disabled (loading state)
    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled())
  })
})
