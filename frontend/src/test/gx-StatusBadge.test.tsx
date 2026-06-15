// gx-StatusBadge tests — §0.6 (new logic ships with tests).
// EN: Covers all 11 variants, default labels, custom labels (humanized), size classes, minWidth.
// HY: Ծаkum é 11 variant, default labels, custom labels (humanized), size classes, minWidth:
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GxStatusBadge } from '../components/StatusBadge/gx-StatusBadge'

describe('GxStatusBadge', () => {
  it('renders default label for success variant', () => {
    render(<GxStatusBadge variant="success" />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders custom label (humanized)', () => {
    render(<GxStatusBadge variant="info" label="in_progress" />)
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })

  it('applies pill-upper class for UPPERCASE per §2', () => {
    const { container } = render(<GxStatusBadge variant="success" />)
    expect(container.querySelector('.pill-upper')).toBeInTheDocument()
  })

  it('applies pill-sm class when size="sm"', () => {
    const { container } = render(<GxStatusBadge variant="warning" size="sm" />)
    expect(container.querySelector('.pill-sm')).toBeInTheDocument()
  })

  it('does not apply pill-sm when size="md" (default)', () => {
    const { container } = render(<GxStatusBadge variant="danger" />)
    expect(container.querySelector('.pill-sm')).not.toBeInTheDocument()
  })

  it('applies inline --gx-pill-min style when minWidth is set', () => {
    const { container } = render(<GxStatusBadge variant="info" minWidth={80} />)
    const span = container.querySelector('.pill')
    expect(span).toHaveStyle({ '--gx-pill-min': '80px' })
  })

  it.each([
    'success',
    'warning',
    'danger',
    'info',
    'neutral',
    'active',
    'degraded',
    'critical',
    'online',
    'provisioned',
    'maintenance',
  ] as const)('renders without error for variant=%s', (variant) => {
    const { container } = render(<GxStatusBadge variant={variant} />)
    expect(container.querySelector('.pill')).toBeInTheDocument()
  })

  it('renders pill-dot span inside the pill', () => {
    const { container } = render(<GxStatusBadge variant="success" />)
    expect(container.querySelector('.pill-dot')).toBeInTheDocument()
  })
})
