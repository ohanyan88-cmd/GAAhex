// gx-AlertList tests — §0.6 (new logic ships with tests).
// EN: Covers render with sample alerts, severity dot colours + critical pulse,
//     empty state (GxWidget), and the keyboard/click interaction when onSelect.
// HY: Ծածկում է render-ը sample alert-երով, severity կետի գույները + critical pulse,
//     դատարկ state (GxWidget), և keyboard/click interaction-ը երբ onSelect կա:
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GxAlertList } from '../components/AlertList/gx-AlertList'
import type { WsAlert } from '../lib/workspace/contract'

const SAMPLE: WsAlert[] = [
  {
    id: 'a1',
    severity: 'danger',
    text: 'Payment gateway timing out',
    at: '2026-06-15T11:30:00Z',
    critical: true,
  },
  {
    id: 'a2',
    severity: 'warning',
    text: 'SLA at risk on ticket #4821',
    at: '2026-06-15T10:00:00Z',
  },
  {
    id: 'a3',
    severity: 'info',
    text: 'Nightly billing cycle completed',
    at: '2026-06-13T00:00:00Z',
  },
]

describe('GxAlertList', () => {
  it('renders the widget title and a row per alert', () => {
    render(<GxAlertList alerts={SAMPLE} />)
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByText('Payment gateway timing out')).toBeInTheDocument()
    expect(screen.getByText('SLA at risk on ticket #4821')).toBeInTheDocument()
    expect(screen.getByText('Nightly billing cycle completed')).toBeInTheDocument()
  })

  it('shows the alert count in the widget header', () => {
    render(<GxAlertList alerts={SAMPLE} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('applies the semantic colour var to each severity dot', () => {
    const { container } = render(<GxAlertList alerts={SAMPLE} />)
    const dots = container.querySelectorAll('.gx-alert-dot')
    expect(dots).toHaveLength(3)
    expect(dots[0]).toHaveStyle({ '--gx-alert-dot-color': 'var(--gx-danger)' })
    expect(dots[1]).toHaveStyle({ '--gx-alert-dot-color': 'var(--gx-warning)' })
    expect(dots[2]).toHaveStyle({ '--gx-alert-dot-color': 'var(--gx-info)' })
  })

  it('adds .gx-pulse only to the critical alert dot (and never redefines it)', () => {
    const { container } = render(<GxAlertList alerts={SAMPLE} />)
    const pulsing = container.querySelectorAll('.gx-alert-dot.gx-pulse')
    expect(pulsing).toHaveLength(1)
  })

  it('renders the GxWidget empty state when there are no alerts', () => {
    render(<GxAlertList alerts={[]} />)
    expect(screen.getByText('No alerts right now.')).toBeInTheDocument()
  })

  it('renders static rows (no buttons) when onSelect is not provided', () => {
    render(<GxAlertList alerts={SAMPLE} />)
    expect(screen.queryByRole('button', { name: /Payment gateway/i })).not.toBeInTheDocument()
  })

  it('renders keyboard-operable buttons and fires onSelect with the alert id', async () => {
    const onSelect = vi.fn()
    render(<GxAlertList alerts={SAMPLE} onSelect={onSelect} />)
    const btn = screen.getByRole('button', { name: /Payment gateway timing out/i })
    await userEvent.click(btn)
    expect(onSelect).toHaveBeenCalledWith('a1')
  })

  it('activates a row via the keyboard (Enter) when interactive', async () => {
    const onSelect = vi.fn()
    render(<GxAlertList alerts={SAMPLE} onSelect={onSelect} />)
    const btn = screen.getByRole('button', { name: /SLA at risk/i })
    btn.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('a2')
  })
})
