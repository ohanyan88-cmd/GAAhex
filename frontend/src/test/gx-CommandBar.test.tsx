// gx-CommandBar tests — §0.6 (new logic ships with tests).
// EN: Covers null guard, standard mode (views + primary + secondary), bulk mode, Rules-of-Hooks.
// HY: Ծаkum é null guard, standard mode (views + primary + secondary), bulk mode:
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GxCommandBar } from '../components/CommandBar/gx-CommandBar'

describe('GxCommandBar', () => {
  it('renders nothing when no props provided', () => {
    const { container } = render(<GxCommandBar />)
    expect(container.firstChild).toBeNull()
  })

  it('renders primary action button in standard mode', () => {
    const onClick = vi.fn()
    render(<GxCommandBar primary={{ label: 'New Lead', onClick }} />)
    expect(screen.getByRole('button', { name: 'New Lead' })).toBeInTheDocument()
  })

  it('calls primary onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<GxCommandBar primary={{ label: 'Create', onClick }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders secondary action buttons', () => {
    render(
      <GxCommandBar
        secondary={[
          { label: 'Export', onClick: vi.fn() },
          { label: 'Import', onClick: vi.fn() },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
  })

  it('renders view chips from ViewSwitcher', () => {
    render(
      <GxCommandBar views={{ current: 'table', options: ['table', 'board'], onChange: vi.fn() }} />,
    )
    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Board' })).toBeInTheDocument()
  })

  it('shows bulk mode (selection count + Clear) when selectionCount > 0', () => {
    const onClear = vi.fn()
    render(
      <GxCommandBar
        selectionCount={3}
        onClearSelection={onClear}
        bulkActions={[{ label: 'Delete', onClick: vi.fn() }]}
      />,
    )
    // selection label uses t() — falls back to English in test env
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('does not show bulk mode when selectionCount is 0 (default)', () => {
    render(<GxCommandBar primary={{ label: 'New', onClick: vi.fn() }} />)
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument()
  })

  it('calls onClearSelection when Clear is clicked', async () => {
    const onClear = vi.fn()
    render(<GxCommandBar selectionCount={2} onClearSelection={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })
})
