import type { Meta, StoryObj } from '@storybook/react'
import { withTheme } from './_decorator'

// Real --gx-* color tokens from src/styles/gaahex-tokens.css, grouped by category.
const groups: { title: string; tokens: string[] }[] = [
  {
    title: 'Surfaces',
    tokens: ['--gx-bg', '--gx-surface', '--gx-raised', '--gx-border', '--gx-border-strong'],
  },
  {
    title: 'Text',
    tokens: ['--gx-text-1', '--gx-text-2', '--gx-text-3'],
  },
  {
    title: 'Primary (cobalt + gold)',
    tokens: ['--gx-primary', '--gx-primary-hover', '--gx-primary-active', '--gx-on-primary', '--gx-ring'],
  },
  {
    title: 'Interaction',
    tokens: ['--gx-hover', '--gx-active'],
  },
  {
    title: 'Signals',
    tokens: [
      '--gx-success', '--gx-success-soft',
      '--gx-warning', '--gx-warning-soft',
      '--gx-danger', '--gx-danger-soft',
      '--gx-info', '--gx-info-soft',
    ],
  },
]

function Swatch({ token }: { token: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)', width: 132 }}>
      <div
        style={{
          height: 56,
          borderRadius: 'var(--gx-radius-lg)',
          border: '1px solid var(--gx-border)',
          background: `var(${token})`,
        }}
      />
      <code style={{ fontSize: 'var(--gx-text-10)', fontFamily: 'var(--gx-font-mono)', color: 'var(--gx-text-2)' }}>
        {token}
      </code>
    </div>
  )
}

function ColorPalette() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-12)' }}>
      {groups.map((g) => (
        <section key={g.title}>
          <h3 style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-1)', marginBottom: 'var(--gx-space-6)' }}>{g.title}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-8)' }}>
            {g.tokens.map((t) => <Swatch key={t} token={t} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

const meta: Meta<typeof ColorPalette> = {
  title: 'Tokens/Colors',
  component: ColorPalette,
  decorators: [withTheme],
}
export default meta

type Story = StoryObj<typeof ColorPalette>

export const AllColors: Story = {}
