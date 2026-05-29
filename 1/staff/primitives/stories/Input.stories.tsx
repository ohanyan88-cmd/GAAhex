import type { Meta, StoryObj } from '@storybook/react'
import { Mail } from 'lucide-react'
import { Input } from '../Input'
import { withTheme } from './_decorator'

const meta: Meta<typeof Input> = {
  title: 'Primitives/Input',
  component: Input,
  decorators: [withTheme],
  args: { placeholder: 'Type here…' },
  argTypes: {
    type: { control: 'select', options: ['text', 'password', 'number', 'email', 'search'] },
    variant: { control: 'inline-radio', options: ['default', 'search', 'numeric'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    leftIcon: { table: { disable: true } },
    rightIcon: { table: { disable: true } },
  },
  render: (args) => (
    <div style={{ width: 280 }}>
      <Input {...args} />
    </div>
  ),
}
export default meta

type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: { type: 'text', placeholder: 'Account name' },
}

export const Search: Story = {
  args: { variant: 'search', type: 'search', placeholder: 'Search accounts…' },
}

export const Password: Story = {
  args: { type: 'password', placeholder: 'Password', value: 'hunter2' },
}

export const Numeric: Story = {
  args: { variant: 'numeric', type: 'number', value: 4299, placeholder: '0' },
}

export const WithError: Story = {
  args: { type: 'email', value: 'not-an-email', error: 'Enter a valid email address' },
}

export const WithLeftIcon: Story = {
  args: { type: 'email', placeholder: 'you@example.com', leftIcon: <Mail size={12} /> },
}

export const Disabled: Story = {
  args: { type: 'text', value: 'Read only value', disabled: true },
}

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)', width: 280 }}>
      <Input size="sm" placeholder="Small" />
      <Input size="md" placeholder="Medium" />
      <Input size="lg" placeholder="Large" />
    </div>
  ),
}
