import type { Meta, StoryObj } from '@storybook/react'
import { StatusPill } from '../StatusPill'
import { withTheme } from './_decorator'

// EN: Full variant set matching GxStatusBadge (gx-StatusBadge.tsx).
// HY: Lиov variant set, hamapatasuм é GxStatusBadge-in:
const variants = [
  // Semantic core (preferred for new callsites)
  'success',
  'warning',
  'danger',
  'info',
  'neutral',
  // Legacy aliases
  'active',
  'degraded',
  'critical',
  // ISP / network states
  'online',
  'provisioned',
  'maintenance',
] as const
const sizes = ['sm', 'md'] as const

const meta: Meta<typeof StatusPill> = {
  title: 'Primitives/StatusPill',
  component: StatusPill,
  decorators: [withTheme],
  args: { variant: 'success' },
  argTypes: {
    variant: { control: 'select', options: variants },
    size: { control: 'inline-radio', options: sizes },
  },
}
export default meta

type Story = StoryObj<typeof StatusPill>

export const Default: Story = {
  args: { variant: 'success' },
}

export const CustomLabel: Story = {
  args: { variant: 'info', label: 'Provisioning' },
}

export const AllVariants: Story = {
  render: () => (
    <table style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th
            style={{
              textAlign: 'left',
              padding: 'var(--gx-space-3)',
              color: 'var(--gx-text-3)',
              fontSize: 'var(--gx-text-10)',
            }}
          >
            variant
          </th>
          {sizes.map((s) => (
            <th
              key={s}
              style={{
                textAlign: 'left',
                padding: 'var(--gx-space-3)',
                color: 'var(--gx-text-3)',
                fontSize: 'var(--gx-text-10)',
              }}
            >
              {s}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => (
          <tr key={v}>
            <td
              style={{
                padding: 'var(--gx-space-3)',
                color: 'var(--gx-text-2)',
                fontSize: 'var(--gx-text-11)',
                fontFamily: 'var(--gx-font-mono)',
              }}
            >
              {v}
            </td>
            {sizes.map((s) => (
              <td key={s} style={{ padding: 'var(--gx-space-3)' }}>
                <StatusPill variant={v} size={s} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}
