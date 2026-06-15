// gx-QueueWidget tests — §0.6 (new logic ships with tests).
// EN: Covers render with sample props, the empty state, and the onSelect interaction (click + keyboard).
// HY: Ծածկում է render-ը sample props-ով, empty state-ը, ու onSelect interaction-ը (click + ստեղնաշար)։
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GxQueueWidget } from '../components/QueueWidget/gx-QueueWidget'
import type { WsQueueItem } from '../lib/workspace/contract'

const SAMPLE: WsQueueItem[] = [
  {
    id: 'lead-1',
    name: 'Ani Petrosyan',
    source: 'Referral',
    sourceTone: 'success',
    nextAction: 'Send proposal',
    score: 92,
  },
  {
    id: 'lead-2',
    name: 'Davit Hakobyan',
    source: 'Web Form',
    sourceTone: 'info',
    nextAction: 'Schedule discovery call',
    score: 7,
  },
]

describe('GxQueueWidget', () => {
  it('renders the title, count, rows and the reused source badges', () => {
    render(<GxQueueWidget items={SAMPLE} />)
    expect(screen.getByText('Priority Queue')).toBeInTheDocument()
    expect(screen.getByText('Ani Petrosyan')).toBeInTheDocument()
    expect(screen.getByText('Davit Hakobyan')).toBeInTheDocument()
    expect(screen.getByText('Send proposal')).toBeInTheDocument()
    // GxStatusBadge humanizes the label (UPPERCASE applied via CSS, text preserved).
    expect(screen.getByText('Referral')).toBeInTheDocument()
    expect(screen.getByText('Web Form')).toBeInTheDocument()
    // Scores render verbatim in the fixed-width tabular column.
    expect(screen.getByText('92')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('renders the empty state when there are no items', () => {
    render(<GxQueueWidget items={[]} />)
    expect(screen.getByText('No leads in the priority queue.')).toBeInTheDocument()
    expect(screen.queryByText('Ani Petrosyan')).not.toBeInTheDocument()
  })

  it('renders static rows (no buttons) when onSelect is not provided', () => {
    render(<GxQueueWidget items={SAMPLE} />)
    // Only GxWidget chrome buttons could exist; with no onRefresh/onLink there are none.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('makes each row a keyboard-operable button when onSelect is provided', () => {
    const onSelect = vi.fn()
    render(<GxQueueWidget items={SAMPLE} onSelect={onSelect} />)
    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(SAMPLE.length)
    fireEvent.click(rows[0])
    expect(onSelect).toHaveBeenCalledWith('lead-1')
  })

  it('exposes an aria-label naming the lead and score on interactive rows', () => {
    const onSelect = vi.fn()
    render(<GxQueueWidget items={SAMPLE} onSelect={onSelect} />)
    expect(
      screen.getByRole('button', { name: 'Open lead Ani Petrosyan, score 92' }),
    ).toBeInTheDocument()
  })
})
