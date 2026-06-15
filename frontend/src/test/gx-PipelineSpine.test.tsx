// gx-PipelineSpine tests — §0.6 (new logic ships with tests).
// EN: Covers render with sample stages, empty state, tone classes, longest-wins fill %,
//     and the keyboard-operable button interaction when onStageClick is provided.
// HY: Ծածկում է render-ը sample stage-երով, empty state, tone class-երը, longest-wins fill %-ը,
//     ու ստեղնաշարով button-ի interaction-ը՝ երբ onStageClick է փոխանցված:
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GxPipelineSpine } from '../components/PipelineSpine/gx-PipelineSpine'
import type { WsPipelineStage } from '../lib/workspace/contract'

const SAMPLE: WsPipelineStage[] = [
  { key: 'lead', label: 'Lead', i18nKey: 'ws.pipeline.stage.lead', count: 120, tone: 'default' },
  { key: 'deal', label: 'Deal', i18nKey: 'ws.pipeline.stage.deal', count: 60, tone: 'active' },
  {
    key: 'activation',
    label: 'Activation',
    i18nKey: 'ws.pipeline.stage.activation',
    count: 30,
    tone: 'peak',
  },
]

describe('GxPipelineSpine', () => {
  it('renders the widget title and every stage label + count', () => {
    render(<GxPipelineSpine stages={SAMPLE} />)
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText('Lead')).toBeInTheDocument()
    expect(screen.getByText('Deal')).toBeInTheDocument()
    expect(screen.getByText('Activation')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('60')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
  })

  it('renders the empty state when stages is empty (no bars)', () => {
    const { container } = render(<GxPipelineSpine stages={[]} />)
    expect(screen.getByText('No pipeline stages to show yet.')).toBeInTheDocument()
    expect(container.querySelector('.gx-pipe-bar')).not.toBeInTheDocument()
  })

  it('applies tone classes: default / active (azure) / peak (gold)', () => {
    const { container } = render(<GxPipelineSpine stages={SAMPLE} />)
    expect(container.querySelector('.gx-pipe-bar-default')).toBeInTheDocument()
    expect(container.querySelector('.gx-pipe-bar-active')).toBeInTheDocument()
    expect(container.querySelector('.gx-pipe-bar-peak')).toBeInTheDocument()
  })

  it('sets longest-wins fill: the tallest stage is 100%', () => {
    const { container } = render(<GxPipelineSpine stages={SAMPLE} />)
    const bars = container.querySelectorAll<HTMLElement>('.gx-pipe-bar')
    // Lead is the max (120) → 100%; Deal (60) → 50%; Activation (30) → 25%.
    expect(bars[0].style.getPropertyValue('--gx-pipe-fill')).toBe('100%')
    expect(bars[1].style.getPropertyValue('--gx-pipe-fill')).toBe('50%')
    expect(bars[2].style.getPropertyValue('--gx-pipe-fill')).toBe('25%')
  })

  it('renders static (non-button) stages when no onStageClick', () => {
    render(<GxPipelineSpine stages={SAMPLE} />)
    expect(screen.queryByRole('button', { name: /Lead/ })).not.toBeInTheDocument()
  })

  it('renders each stage as a button and fires onStageClick with the stage key', async () => {
    const onStageClick = vi.fn()
    render(<GxPipelineSpine stages={SAMPLE} onStageClick={onStageClick} />)
    const dealBtn = screen.getByRole('button', { name: /Deal/ })
    await userEvent.click(dealBtn)
    expect(onStageClick).toHaveBeenCalledWith('deal')
  })

  it('button stages are keyboard-operable (Enter activates)', async () => {
    const onStageClick = vi.fn()
    render(<GxPipelineSpine stages={SAMPLE} onStageClick={onStageClick} />)
    const leadBtn = screen.getByRole('button', { name: /Lead/ })
    leadBtn.focus()
    await userEvent.keyboard('{Enter}')
    expect(onStageClick).toHaveBeenCalledWith('lead')
  })
})
