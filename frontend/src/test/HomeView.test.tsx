/**
 * HomeView tab-switching tests.
 * Mocks: useAuth (no real token), fetch (no network), embedded sub-views.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomeView from '../views/HomeView'

// ── Mock dependencies ──────────────────────────────────────────────────────

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Test User', email: 'test@example.com', avatar_url: null }, token: 'tok', setUser: vi.fn() }),
}))

vi.mock('../lib/config', () => ({ BASE: 'http://localhost' }))

// Mock all embedded sub-views so tab clicks resolve instantly without fetching.
vi.mock('../views/AskGaaexView', () => ({ default: () => <div data-testid="ask-view" /> }))
vi.mock('../views/MessagesView', () => ({ default: () => <div data-testid="messages-view" /> }))
vi.mock('../views/CalendarView', () => ({ default: () => <div data-testid="calendar-view" /> }))
vi.mock('../views/ProfileView', () => ({ default: ({ initialSection }: { initialSection: string }) => <div data-testid={`profile-${initialSection}`} /> }))

// Silence fetch so workspace data calls don't leak into test output.
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => [] })
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('HomeView tab switching', () => {
  function mount() {
    return render(
      <HomeView
        token="tok"
        capabilities={{}}
      />
    )
  }

  it('renders Workspace tab by default', () => {
    mount()
    expect(screen.getByRole('tab', { name: /workspace/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches to Ask Me tab on click', async () => {
    mount()
    await userEvent.click(screen.getByRole('tab', { name: /ask me/i }))
    expect(screen.getByTestId('ask-view')).toBeInTheDocument()
  })

  it('switches to Messages tab on click', async () => {
    mount()
    await userEvent.click(screen.getByRole('tab', { name: /messages/i }))
    expect(screen.getByTestId('messages-view')).toBeInTheDocument()
  })

  it('switches to Calendar tab on click', async () => {
    mount()
    await userEvent.click(screen.getByRole('tab', { name: /calendar/i }))
    expect(screen.getByTestId('calendar-view')).toBeInTheDocument()
  })

  it('switches to My Requests tab on click', async () => {
    mount()
    await userEvent.click(screen.getByRole('tab', { name: /my requests/i }))
    expect(screen.getByTestId('profile-requests')).toBeInTheDocument()
  })

  it('shows workspace content when switching back to Workspace tab', async () => {
    mount()
    await userEvent.click(screen.getByRole('tab', { name: /ask me/i }))
    await userEvent.click(screen.getByRole('tab', { name: /workspace/i }))
    // Workspace layout zone should be visible
    expect(screen.getByText(/ME/)).toBeInTheDocument()
  })
})
