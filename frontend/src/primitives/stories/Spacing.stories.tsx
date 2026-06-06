import type { Meta, StoryObj } from '@storybook/react'
import { withTheme } from './_decorator'

// Real --gx-space-* tokens from src/styles/gaahex-tokens.css, with their px values.
const spaces: { token: string; px: number }[] = [
  { token: '--gx-space-1', px: 2 },
  { token: '--gx-space-2', px: 4 },
  { token: '--gx-space-3', px: 6 },
  { token: '--gx-space-4', px: 8 },
  { token: '--gx-space-5', px: 10 },
  { token: '--gx-space-6', px: 12 },
  { token: '--gx-space-7', px: 14 },
  { token: '--gx-space-8', px: 16 },
  { token: '--gx-space-10', px: 20 },
  { token: '--gx-space-12', px: 24 },
  { token: '--gx-space-16', px: 32 },
  { token: '--gx-space-20', px: 40 },
]

function SpacingScale() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
      {spaces.map(({ token, px }) => (
        <div key={token} style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-6)' }}>
          <code style={{ width: 130, fontSize: 'var(--gx-text-10)', fontFamily: 'var(--gx-font-mono)', color: 'var(--gx-text-2)' }}>{token}</code>
          <div
            style={{
              width: `var(${token})`,
              height: 16,
              background: 'var(--gx-primary)',
              borderRadius: 'var(--gx-radius-sm)',
            }}
          />
          <span style={{ fontSize: 'var(--gx-text-10)', fontFamily: 'var(--gx-font-mono)', color: 'var(--gx-text-3)' }}>{px}px</span>
        </div>
      ))}
    </div>
  )
}

const meta: Meta<typeof SpacingScale> = {
  title: 'Tokens/Spacing',
  component: SpacingScale,
  decorators: [withTheme],
}
export default meta

type Story = StoryObj<typeof SpacingScale>

export const Scale: Story = {}
