// gx-GoalRing tests — §0.6 (new logic ships with tests).
// EN: Covers render with sample props, the gold-peak flip at 100%+, the empty/unconfigured state,
//     the accessible role+label, and the refresh interaction (rendered only when a handler is given).
// HY: Ծածկում է render-ը sample props-ով, gold-peak փոխանջատումը 100%+-ի դեպքում, դատարկ state-ը,
//     հասանելի role+label-ը և refresh interaction-ը (render-վում է միայն երբ handler կա)։
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GxGoalRing } from '../components/GoalRing/gx-GoalRing'
import type { WsGoal } from '../lib/workspace/contract'

const goal: WsGoal = {
  label: 'New customers',
  i18nKey: 'ws.goal.newCustomers',
  current: 7,
  target: 10,
  pct: 70,
}

describe('GxGoalRing', () => {
  it('renders the widget title and the goal label', () => {
    render(<GxGoalRing goal={goal} />)
    expect(screen.getByText('Weekly Goal')).toBeInTheDocument()
    expect(screen.getByText('New customers')).toBeInTheDocument()
  })

  it('renders the rounded pct and the current / target sub-line', () => {
    render(<GxGoalRing goal={goal} />)
    expect(screen.getByText('70%')).toBeInTheDocument()
    expect(screen.getByText('7 / 10')).toBeInTheDocument()
  })

  it('exposes an accessible progress label via role=img', () => {
    render(<GxGoalRing goal={goal} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('aria-label')
    expect(img.getAttribute('aria-label')).toContain('70')
    expect(img.getAttribute('aria-label')).toContain('New customers')
  })

  it('flips to the gold peak (gx-ring-met) when pct >= 100', () => {
    const met: WsGoal = { ...goal, current: 11, target: 10, pct: 110 }
    const { container } = render(<GxGoalRing goal={met} />)
    expect(container.querySelector('.gx-ring-met')).toBeInTheDocument()
    expect(screen.getByText('110%')).toBeInTheDocument()
  })

  it('does not flip to gold below 100%', () => {
    const { container } = render(<GxGoalRing goal={goal} />)
    expect(container.querySelector('.gx-ring-met')).not.toBeInTheDocument()
  })

  it('renders the empty state when target is not positive', () => {
    const empty: WsGoal = {
      label: 'New customers',
      i18nKey: 'ws.goal.x',
      current: 0,
      target: 0,
      pct: 0,
    }
    render(<GxGoalRing goal={empty} />)
    expect(screen.getByText('No goal set for this week yet.')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('renders a refresh button only when onRefresh is provided and fires it', () => {
    const onRefresh = vi.fn()
    const { rerender } = render(<GxGoalRing goal={goal} />)
    expect(screen.queryByLabelText('Refresh')).not.toBeInTheDocument()

    rerender(<GxGoalRing goal={goal} onRefresh={onRefresh} />)
    const btn = screen.getByLabelText('Refresh')
    fireEvent.click(btn)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders a scalable SVG with a viewBox (no fixed pixel size)', () => {
    const { container } = render(<GxGoalRing goal={goal} />)
    const svg = container.querySelector('.gx-ring-svg')
    expect(svg).toHaveAttribute('viewBox', '0 0 100 100')
    expect(svg).not.toHaveAttribute('width')
  })
})
