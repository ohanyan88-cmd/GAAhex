// gx-Standings tests — §0.6 (new logic ships with tests).
// EN: Covers render with sample props (rank order + gold #1), empty state, and the select interaction.
// HY: Ծածկում է render-ը sample props-ով (rank-ի կարգ + ոսկե #1), empty state, և select-ի interaction-ը։
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GxStandings } from '../components/Standings/gx-Standings'
import type { WsStanding } from '../lib/workspace/contract'

const SAMPLE: WsStanding[] = [
  { rank: 2, name: 'Anush Petrosyan', conversion: 41, revenue: 820000, barPct: 78 },
  { rank: 1, name: 'Gevorg Sargsyan', conversion: 53, revenue: 1240000, barPct: 100 },
  { rank: 3, name: 'Tigran', conversion: 29, revenue: 510000, barPct: 44 },
]

describe('GxStandings', () => {
  it('renders the widget title and every team member', () => {
    render(<GxStandings team={SAMPLE} />)
    expect(screen.getByText('Team Standings')).toBeInTheDocument()
    expect(screen.getByText('Gevorg Sargsyan')).toBeInTheDocument()
    expect(screen.getByText('Anush Petrosyan')).toBeInTheDocument()
    expect(screen.getByText('Tigran')).toBeInTheDocument()
  })

  it('sorts rows by rank ascending regardless of input order', () => {
    const { container } = render(<GxStandings team={SAMPLE} />)
    const names = Array.from(container.querySelectorAll('.gx-stand-name')).map((n) => n.textContent)
    expect(names).toEqual(['Gevorg Sargsyan', 'Anush Petrosyan', 'Tigran'])
  })

  it('marks only rank #1 with the gold peak class', () => {
    const { container } = render(<GxStandings team={SAMPLE} />)
    expect(container.querySelectorAll('.gx-stand-rank-peak')).toHaveLength(1)
    expect(container.querySelectorAll('.gx-stand-bar-fill-peak')).toHaveLength(1)
  })

  it('renders the empty state when team is empty', () => {
    render(<GxStandings team={[]} />)
    expect(screen.getByText('No standings to show yet.')).toBeInTheDocument()
    expect(screen.queryByText('Gevorg Sargsyan')).not.toBeInTheDocument()
  })

  it('renders static rows (no buttons) when onSelect is not provided', () => {
    render(<GxStandings team={SAMPLE} />)
    expect(screen.queryByRole('button', { name: /Gevorg Sargsyan/i })).not.toBeInTheDocument()
  })

  it('calls onSelect with the team member name on click', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<GxStandings team={SAMPLE} onSelect={onSelect} />)
    const row = screen.getByRole('button', { name: /Gevorg Sargsyan/i })
    await user.click(row)
    expect(onSelect).toHaveBeenCalledWith('Gevorg Sargsyan')
  })

  it('is keyboard-operable when interactive (Enter activates the row)', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<GxStandings team={SAMPLE} onSelect={onSelect} />)
    const row = screen.getByRole('button', { name: /Tigran/i })
    row.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('Tigran')
  })

  it('formats conversion with a percent sign in a tabular cell', () => {
    const { container } = render(<GxStandings team={SAMPLE} />)
    const top = container.querySelector('.gx-stand-row') as HTMLElement
    expect(within(top).getByText('53%')).toBeInTheDocument()
  })
})
