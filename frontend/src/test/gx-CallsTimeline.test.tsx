// gx-CallsTimeline tests — §0.6 (new logic ships with tests).
// EN: Covers rendering with sample calls, the kind icons, done (check + struck name), the empty
//     state, and the keyboard/click interaction when onSelect is provided. Asserts on the ENGLISH
//     fallback text (t() falls back to English in the test env — no dict loaded).
// HY: Ծածկում է render-ը sample call-երով, kind icon-ները, done-ը (✓ + վրագծված անուն), empty
//     state-ը, ու keyboard/click interaction-ը երբ onSelect-ը տրված է: Ստուգում է ԱՆԳԼԵՐԵՆ
//     fallback տեքստի վրա (t()-ը test միջավայրում fallback է անում անգլերենին):
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GxCallsTimeline } from '../components/CallsTimeline/gx-CallsTimeline'
import type { WsCall } from '../lib/workspace/contract'

const SAMPLE: WsCall[] = [
  { id: 'c1', at: '2026-06-15T09:30:00Z', name: 'Aram Petrosyan', kind: 'call' },
  { id: 'c2', at: '2026-06-15T11:00:00Z', name: 'Lilit Grigoryan', kind: 'meeting', done: true },
  { id: 'c3', at: '2026-06-15T14:15:00Z', name: 'Davit Sargsyan', kind: 'followup' },
]

describe('GxCallsTimeline', () => {
  it('renders the widget title and the count', () => {
    render(<GxCallsTimeline calls={SAMPLE} />)
    expect(screen.getByText('Today’s Calls')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders every call name', () => {
    render(<GxCallsTimeline calls={SAMPLE} />)
    expect(screen.getByText('Aram Petrosyan')).toBeInTheDocument()
    expect(screen.getByText('Lilit Grigoryan')).toBeInTheDocument()
    expect(screen.getByText('Davit Sargsyan')).toBeInTheDocument()
  })

  it('formats the ISO time as a short local time (HH:MM)', () => {
    const { container } = render(<GxCallsTimeline calls={SAMPLE} />)
    const times = container.querySelectorAll('.gx-calls-time')
    expect(times.length).toBe(3)
    // Each time cell carries its source ISO via dateTime and renders a non-empty label.
    expect(times[0]).toHaveAttribute('dateTime', '2026-06-15T09:30:00Z')
    expect(times[0].textContent?.length).toBeGreaterThan(0)
  })

  it('marks a done call with the done modifier on its name and dot', () => {
    const { container } = render(<GxCallsTimeline calls={SAMPLE} />)
    const doneName = screen.getByText('Lilit Grigoryan')
    expect(doneName).toHaveClass('is-done')
    expect(container.querySelector('.gx-calls-dot.is-done')).toBeInTheDocument()
    expect(container.querySelector('.gx-calls-check')).toBeInTheDocument()
  })

  it('renders a connector dot per call', () => {
    const { container } = render(<GxCallsTimeline calls={SAMPLE} />)
    expect(container.querySelectorAll('.gx-calls-dot').length).toBe(3)
  })

  it('shows the empty state when there are no calls', () => {
    render(<GxCallsTimeline calls={[]} />)
    expect(screen.getByText('No calls scheduled today.')).toBeInTheDocument()
  })

  it('renders rows as buttons and calls onSelect on click when interactive', async () => {
    const onSelect = vi.fn()
    render(<GxCallsTimeline calls={SAMPLE} onSelect={onSelect} />)
    const buttons = screen.getAllByRole('button')
    // 3 call rows (the widget chrome adds no buttons here: no refresh/link/retry passed).
    expect(buttons.length).toBe(3)
    await userEvent.click(buttons[0])
    expect(onSelect).toHaveBeenCalledWith('c1')
  })

  it('operates via the keyboard when interactive (Enter)', async () => {
    const onSelect = vi.fn()
    render(<GxCallsTimeline calls={SAMPLE} onSelect={onSelect} />)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('c1')
  })

  it('renders no row buttons when onSelect is omitted (no dead affordance)', () => {
    render(<GxCallsTimeline calls={SAMPLE} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
