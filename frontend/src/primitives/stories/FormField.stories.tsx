import type { Meta, StoryObj } from '@storybook/react'
import { FormField } from '../FormField'
import { Input } from '../Input'
import { withTheme } from './_decorator'

const meta: Meta<typeof FormField> = {
  title: 'Primitives/FormField',
  component: FormField,
  decorators: [withTheme],
  args: { label: 'Account name' },
  render: (args) => (
    <div style={{ width: 320 }}>
      <FormField {...args}>
        <Input id={args.htmlFor} placeholder="Acme Telecom" />
      </FormField>
    </div>
  ),
}
export default meta

type Story = StoryObj<typeof FormField>

export const Default: Story = {
  args: { label: 'Account name', htmlFor: 'ff-default' },
}

export const WithHint: Story = {
  args: { label: 'Account name', hint: 'visible to billing', htmlFor: 'ff-hint' },
}

export const WithError: Story = {
  args: { label: 'Account name', error: 'This account already exists', htmlFor: 'ff-error' },
  render: (args) => (
    <div style={{ width: 320 }}>
      <FormField {...args}>
        <Input id={args.htmlFor} value="Acme Telecom" error={args.error} />
      </FormField>
    </div>
  ),
}

export const Required: Story = {
  args: { label: 'Account name', required: true, htmlFor: 'ff-required' },
}
