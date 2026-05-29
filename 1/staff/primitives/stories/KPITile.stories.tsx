import type { Meta, StoryObj } from '@storybook/react'
import { Users } from 'lucide-react'
import { KPITile } from '../KPITile'
import { withTheme } from './_decorator'

const meta: Meta<typeof KPITile> = {
  title: 'Primitives/KPITile',
  component: KPITile,
  decorators: [withTheme],
  args: {
    label: 'Active subscribers',
    value: 14287,
    delta: '+2.4%',
    deltaPositive: true,
    icon: Users,
  },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    icon: { table: { disable: true } },
    accessory: { table: { disable: true } },
  },
  render: (args) => (
    <div style={{ width: 260 }}>
      <KPITile {...args} />
    </div>
  ),
}
export default meta

type Story = StoryObj<typeof KPITile>

export const Default: Story = {
  args: { label: 'Active subscribers', value: 14287, delta: '+2.4%', deltaPositive: true, icon: Users },
}

export const Loading: Story = {
  args: { loading: true },
}

export const WithError: Story = {
  args: { value: '—', error: 'Feed unavailable', icon: Users },
}

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 'var(--gx-space-6)', flexWrap: 'wrap' }}>
      <div style={{ width: 220 }}><KPITile {...args} size="sm" /></div>
      <div style={{ width: 220 }}><KPITile {...args} size="md" /></div>
      <div style={{ width: 220 }}><KPITile {...args} size="lg" /></div>
    </div>
  ),
}
