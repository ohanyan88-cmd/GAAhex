import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KPITile } from '../primitives/KPITile'

describe('KPITile', () => {
  it('renders label and value', () => {
    render(<KPITile label="Open Tickets" value={42} />)
    expect(screen.getByText('Open Tickets')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders unit alongside value', () => {
    render(<KPITile label="Revenue" value={1250} unit="AMD" />)
    expect(screen.getByText('AMD')).toBeInTheDocument()
  })

  it('renders subtitle', () => {
    render(<KPITile label="Tasks" value={5} subtitle="3 overdue" />)
    expect(screen.getByText('3 overdue')).toBeInTheDocument()
  })

  it('shows skeleton when loading', () => {
    const { container } = render(<KPITile label="Tasks" value={5} loading />)
    expect(container.querySelector('.kpi-tile-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('5')).not.toBeInTheDocument()
  })

  it('renders as <button> when onClick is provided', () => {
    const onClick = vi.fn()
    render(<KPITile label="Tasks" value={5} onClick={onClick} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders as <div> when no onClick/href', () => {
    const { container } = render(<KPITile label="Tasks" value={5} />)
    expect(container.querySelector('button')).not.toBeInTheDocument()
    expect(container.querySelector('a')).not.toBeInTheDocument()
    expect(container.querySelector('div.kpi-tile')).toBeInTheDocument()
  })

  it('renders as <a> when href is provided', () => {
    render(<KPITile label="Tasks" value={5} href="/workitems" />)
    expect(screen.getByRole('link')).toBeInTheDocument()
  })

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<KPITile label="Tasks" value={5} onClick={onClick} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('applies danger class to value when danger=true', () => {
    const { container } = render(<KPITile label="SLA" value={12} danger />)
    expect(container.querySelector('.kpi-tile-value.danger')).toBeInTheDocument()
  })

  it('applies warning class to value when warning=true', () => {
    const { container } = render(<KPITile label="SLA" value={12} warning />)
    expect(container.querySelector('.kpi-tile-value.warning')).toBeInTheDocument()
  })

  it('renders cornerNote', () => {
    render(<KPITile label="Tasks" value={5} cornerNote={<span>YOU</span>} />)
    expect(screen.getByText('YOU')).toBeInTheDocument()
  })

  it('renders delta trend with ArrowUpRight when deltaPositive', () => {
    const { container } = render(<KPITile label="Revenue" value={100} delta="+5%" deltaPositive />)
    expect(screen.getByText('+5%')).toBeInTheDocument()
    expect(container.querySelector('.kpi-tile-delta.up')).toBeInTheDocument()
  })

  it('button is not rendered when loading — tile is non-interactive', () => {
    const onClick = vi.fn()
    render(<KPITile label="Tasks" value={5} onClick={onClick} loading />)
    // loading disables interactivity: clickable=false → renders as div
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
