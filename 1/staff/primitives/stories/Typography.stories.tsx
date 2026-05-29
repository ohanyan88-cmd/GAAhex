import type { Meta, StoryObj } from '@storybook/react'
import { withTheme } from './_decorator'

// Real --gx-text-* size tokens from src/color-tokens.css.
const sizes: { token: string; px: number }[] = [
  { token: '--gx-text-9', px: 9 },
  { token: '--gx-text-10', px: 10 },
  { token: '--gx-text-11', px: 11 },
  { token: '--gx-text-12', px: 12 },
  { token: '--gx-text-13', px: 13 },
  { token: '--gx-text-14', px: 14 },
  { token: '--gx-text-16', px: 16 },
  { token: '--gx-text-18', px: 18 },
  { token: '--gx-text-22', px: 22 },
  { token: '--gx-text-28', px: 28 },
]

function TypeScale() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-8)' }}>
      {sizes.map(({ token, px }) => (
        <div key={token} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--gx-space-8)' }}>
          <code style={{ width: 130, flexShrink: 0, fontSize: 'var(--gx-text-10)', fontFamily: 'var(--font-mono)', color: 'var(--gx-text-3)' }}>
            {token} · {px}px
          </code>
          <span style={{ fontSize: `var(${token})`, color: 'var(--gx-text-1)', lineHeight: 'var(--gx-leading-tight)' }}>
            The five boxing wizards jump quickly
          </span>
        </div>
      ))}
    </div>
  )
}

const meta: Meta<typeof TypeScale> = {
  title: 'Tokens/Typography',
  component: TypeScale,
  decorators: [withTheme],
}
export default meta

type Story = StoryObj<typeof TypeScale>

export const Sizes: Story = {}
