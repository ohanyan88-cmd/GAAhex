/**
 * HomeView (Phase 2) — renders the role-driven gx-WorkspaceGrid from the single
 * GET /api/workspace payload. useFetch is mocked to return a fixed WorkspaceData so the
 * grid + the real leaf widgets render without network. Also asserts the legacy tab chrome
 * (removed Phase 2 — comms live in the header) is gone.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import HomeView from '../views/HomeView'
import { FULL_ACCESS } from '../lib/capabilities'
import type { WorkspaceData } from '../lib/workspace/contract'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Test User', email: 'test@example.com', avatar_url: null },
    token: 'tok',
    setUser: vi.fn(),
  }),
}))

const MOCK_WS: WorkspaceData = {
  role: 'b2b_am',
  label: 'B2B Account Manager',
  source: 'override',
  generatedAt: '2026-06-15T09:00:00Z',
  focus: { summary: 'Three hot deals waiting and six calls before lunch.' },
  kpis: [
    {
      key: 'revenue',
      label: 'Revenue (MTD)',
      i18nKey: 'kpi.revenue',
      value: 48250,
      unit: 'USD',
      trend: { dir: 'up', pct: 12.4 },
      spark: [3, 4, 5, 6],
      tone: 'gold',
    },
    {
      key: 'conversion',
      label: 'Conversion',
      i18nKey: 'kpi.conversion',
      value: 34.2,
      unit: '%',
      trend: { dir: 'up', pct: 3.1 },
      spark: [2, 3, 3, 4],
      tone: 'default',
    },
  ],
  pipeline: {
    stages: [
      { key: 'lead', label: 'Lead', i18nKey: 'pipeline.stage.lead', count: 42, tone: 'default' },
      { key: 'deal', label: 'Deal', i18nKey: 'pipeline.stage.deal', count: 17, tone: 'active' },
      {
        key: 'activation',
        label: 'Activation',
        i18nKey: 'pipeline.stage.activation',
        count: 11,
        tone: 'peak',
      },
    ],
  },
  queue: [
    {
      id: 'l1',
      name: 'GlobalTel',
      source: 'Referral',
      sourceTone: 'success',
      nextAction: 'Send contract',
      score: 92,
    },
  ],
  calls: [{ id: 'c1', at: '2026-06-15T09:30:00Z', name: 'GlobalTel', kind: 'call', done: true }],
  goal: {
    label: 'Weekly Revenue Goal',
    i18nKey: 'goal.weekly_revenue',
    current: 48250,
    target: 60000,
    pct: 80,
  },
  deals: [
    {
      id: 'd1',
      name: 'GlobalTel',
      value: 18500,
      stage: 'Deal',
      waitingFor: 'Signature',
      age: '2d',
    },
  ],
  alerts: [
    {
      id: 'a1',
      severity: 'danger',
      text: 'GlobalTel contract expires end of week.',
      at: '2026-06-15T09:00:00Z',
      critical: true,
    },
  ],
  team: [{ rank: 1, name: 'Anahit G.', conversion: 41, revenue: 72100, barPct: 100 }],
  sample: ['kpis', 'queue'],
}

vi.mock('../hooks/useFetch', () => ({
  useFetch: (path: string | null) => {
    if (path === '/auth/me') {
      return {
        data: { id: 'u1', name: 'Test User', email: 'test@example.com' },
        loading: false,
        ok: true,
        status: 200,
        error: null,
        refetch: vi.fn(),
      }
    }
    if (typeof path === 'string' && path.startsWith('/api/workspace')) {
      return { data: MOCK_WS, loading: false, ok: true, status: 200, error: null, refetch: vi.fn() }
    }
    return { data: null, loading: false, ok: true, status: 200, error: null, refetch: vi.fn() }
  },
}))

describe('HomeView (Phase 2 workspace)', () => {
  function mount() {
    return render(<HomeView capabilities={FULL_ACCESS} />)
  }

  it('renders the AI focus summary', () => {
    mount()
    expect(screen.getByText(/three hot deals waiting/i)).toBeInTheDocument()
  })

  it('renders the KPI tiles (Revenue + Conversion)', () => {
    mount()
    expect(screen.getByText('Revenue (MTD)')).toBeInTheDocument()
    expect(screen.getByText('Conversion')).toBeInTheDocument()
  })

  it('renders the role-driven grid and NO legacy tab chrome', () => {
    mount()
    expect(document.querySelector('.gx-ws')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('renders the role switcher with the resolved role selected', () => {
    mount()
    const select = screen.getByLabelText(/workspace layout/i) as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('b2b_am')
  })

  it('renders priority-queue and team-standings content', () => {
    mount()
    expect(screen.getByText('Send contract')).toBeInTheDocument() // queue next-action
    expect(screen.getByText('Anahit G.')).toBeInTheDocument() // standings rank 1
  })
})
