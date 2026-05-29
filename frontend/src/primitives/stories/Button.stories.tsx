import type { Meta, StoryObj } from '@storybook/react'
import { Plus, ArrowRight } from 'lucide-react'
import { Button } from '../Button'
import { withTheme } from './_decorator'

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  decorators: [withTheme],
  args: {
    children: 'Button',
  },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger', 'link'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    leftIcon: { table: { disable: true } },
    rightIcon: { table: { disable: true } },
  },
}
export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: { variant: 'primary', children: 'Primary' },
}

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Secondary' },
}

export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Ghost' },
}

export const Danger: Story = {
  args: { variant: 'danger', children: 'Delete' },
}

export const Link: Story = {
  args: { variant: 'link', children: 'Learn more' },
}

export const WithIcon: Story = {
  args: { variant: 'primary', leftIcon: Plus, children: 'Add account' },
  render: (args) => (
    <div style={{ display: 'flex', gap: 'var(--gx-space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
      <Button {...args} />
      <Button variant="secondary" rightIcon={ArrowRight}>Continue</Button>
    </div>
  ),
}

export const Loading: Story = {
  args: { variant: 'primary', loading: true, children: 'Saving…' },
}

export const Disabled: Story = {
  args: { variant: 'primary', disabled: true, children: 'Disabled' },
}

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--gx-space-4)', alignItems: 'center' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}
