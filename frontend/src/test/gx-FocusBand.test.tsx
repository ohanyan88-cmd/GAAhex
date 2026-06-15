// gx-FocusBand tests — §0.6 (new logic ships with tests).
// EN: Covers render with a real summary, the empty/whitespace fallback, the Ask pill gating
//     (renders only when onAsk is supplied), and the click interaction. Asserts on English
//     fallback text (t() returns the inline English default when the dict is empty, as in tests).
// HY: Ծածկում է render-ը իրական ամփոփով, empty/whitespace fallback-ը, Ask pill-ի gating-ը
//     (render-վում է միայն երբ onAsk-ը կա), ու click-ը: Ստուգում է անգլերեն fallback տեքստի վրա:
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GxFocusBand } from '../components/FocusBand/gx-FocusBand'

describe('GxFocusBand', () => {
  const SAMPLE = '3 leads need a follow-up today and 2 invoices went overdue.'

  it('renders the summary text', () => {
    render(<GxFocusBand summary={SAMPLE} />)
    expect(screen.getByText(SAMPLE)).toBeInTheDocument()
  })

  it('renders inside the existing .gx-ws-focus chrome', () => {
    const { container } = render(<GxFocusBand summary={SAMPLE} />)
    expect(container.querySelector('.gx-ws-focus')).toBeInTheDocument()
    expect(container.querySelector('.gx-focus-icon')).toBeInTheDocument()
    expect(container.querySelector('.gx-focus-text')).toBeInTheDocument()
  })

  it('falls back to the empty line for a blank/whitespace summary', () => {
    render(<GxFocusBand summary="   " />)
    expect(screen.getByText('No summary yet — your day is clear.')).toBeInTheDocument()
  })

  it('does not render the Ask pill when onAsk is omitted (no dead button)', () => {
    const { container } = render(<GxFocusBand summary={SAMPLE} />)
    expect(container.querySelector('.gx-focus-ask')).not.toBeInTheDocument()
  })

  it('renders the Ask pill and calls onAsk when clicked', async () => {
    const user = userEvent.setup()
    const onAsk = vi.fn()
    render(<GxFocusBand summary={SAMPLE} onAsk={onAsk} />)
    const ask = screen.getByRole('button', { name: 'Ask' })
    expect(ask).toBeInTheDocument()
    await user.click(ask)
    expect(onAsk).toHaveBeenCalledTimes(1)
  })
})
