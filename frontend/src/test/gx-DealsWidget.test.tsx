// gx-DealsWidget tests — §0.6 (new logic ships with tests).
// EN: Covers render with sample props, the empty state, the read-only (no onOpen) case, and the
//     onOpen interaction (click + aria-label naming the deal).
// HY: Ծածկում է render-ը sample props-ով, empty state-ը, read-only (առանց onOpen) դեպքը, ու
//     onOpen interaction-ը (click + aria-label, որ անվանում է deal-ը)։
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GxDealsWidget } from '../components/DealsWidget/gx-DealsWidget'
import type { WsDeal } from '../lib/workspace/contract'

const SAMPLE: WsDeal[] = [
  {
    id: 'deal-1',
    name: 'Acme Industrial',
    value: 2450000,
    stage: 'Negotiation',
    waitingFor: 'Signed contract',
    age: '3d',
  },
  {
    id: 'deal-2',
    name: 'Yerevan Fiber Co',
    value: 780000,
    stage: 'Proposal',
    waitingFor: 'Budget approval',
    age: '11h',
  },
]

describe('GxDealsWidget', () => {
  it('renders the title, count, deal cards and the reused stage chips', () => {
    render(<GxDealsWidget deals={SAMPLE} />)
    expect(screen.getByText('Deals Waiting')).toBeInTheDocument()
    expect(screen.getByText('Acme Industrial')).toBeInTheDocument()
    expect(screen.getByText('Yerevan Fiber Co')).toBeInTheDocument()
    // GxStatusBadge renders the stage label verbatim (UPPERCASE applied via CSS).
    expect(screen.getByText('Negotiation')).toBeInTheDocument()
    expect(screen.getByText('Proposal')).toBeInTheDocument()
    // "waiting for:" line carries the waitingFor value.
    expect(screen.getByText('Signed contract')).toBeInTheDocument()
    expect(screen.getByText('Budget approval')).toBeInTheDocument()
    // Age renders verbatim.
    expect(screen.getByText('3d')).toBeInTheDocument()
    expect(screen.getByText('11h')).toBeInTheDocument()
  })

  it('renders the empty state when there are no deals', () => {
    render(<GxDealsWidget deals={[]} />)
    expect(screen.getByText('No deals waiting.')).toBeInTheDocument()
    expect(screen.queryByText('Acme Industrial')).not.toBeInTheDocument()
  })

  it('renders read-only cards (no buttons) when onOpen is not provided', () => {
    render(<GxDealsWidget deals={SAMPLE} />)
    // No onOpen, and no GxWidget chrome buttons (no onRefresh/onLink) → zero buttons.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders one primary Open button per deal when onOpen is provided and calls it with the id', () => {
    const onOpen = vi.fn()
    render(<GxDealsWidget deals={SAMPLE} onOpen={onOpen} />)
    const buttons = screen.getAllByRole('button', { name: /^Open deal / })
    expect(buttons).toHaveLength(SAMPLE.length)
    fireEvent.click(buttons[0])
    expect(onOpen).toHaveBeenCalledWith('deal-1')
  })

  it('exposes an aria-label naming the deal on each Open button', () => {
    const onOpen = vi.fn()
    render(<GxDealsWidget deals={SAMPLE} onOpen={onOpen} />)
    expect(screen.getByRole('button', { name: 'Open deal Acme Industrial' })).toBeInTheDocument()
  })
})
