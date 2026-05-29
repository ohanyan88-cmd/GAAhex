import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { DataTableRow } from '../DataTableRow'
import { DataTableCell } from '../DataTableCell'
import { StatusPill } from '../StatusPill'
import { withTheme } from './_decorator'

type Density = 'sm' | 'md'

function Table({ children }: { children: React.ReactNode }) {
  return (
    <table style={{ width: 520, borderCollapse: 'collapse', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--gx-radius-lg)' }}>
      <tbody>{children}</tbody>
    </table>
  )
}

function ExampleCells() {
  return (
    <>
      <DataTableCell variant="id">ACC-10293</DataTableCell>
      <DataTableCell>Acme Telecom</DataTableCell>
      <DataTableCell variant="numeric">$4,299.00</DataTableCell>
      <DataTableCell align="right"><StatusPill variant="active" size="sm" /></DataTableCell>
    </>
  )
}

const meta: Meta<typeof DataTableRow> = {
  title: 'Primitives/DataTableRow',
  component: DataTableRow,
  decorators: [withTheme],
  argTypes: {
    density: { control: 'inline-radio', options: ['sm', 'md'] },
    children: { table: { disable: true } },
  },
}
export default meta

type Story = StoryObj<typeof DataTableRow>

export const Default: Story = {
  render: (args) => (
    <Table>
      <DataTableRow {...args}>
        <ExampleCells />
      </DataTableRow>
    </Table>
  ),
}

export const Selected: Story = {
  render: () => {
    const [selected, setSelected] = useState(true)
    return (
      <Table>
        <DataTableRow selected={selected} onSelectToggle={() => setSelected((v) => !v)}>
          <ExampleCells />
        </DataTableRow>
      </Table>
    )
  },
}

export const Density: Story = {
  render: () => {
    const rows: Density[] = ['sm', 'sm', 'md', 'md']
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-8)' }}>
        {(['sm', 'md'] as Density[]).map((d) => (
          <div key={d}>
            <div style={{ marginBottom: 'var(--gx-space-3)', color: 'var(--text-3)', fontSize: 'var(--gx-text-10)', fontFamily: 'var(--font-mono)' }}>density={d}</div>
            <Table>
              {rows.map((_, i) => (
                <DataTableRow key={i} density={d}>
                  <ExampleCells />
                </DataTableRow>
              ))}
            </Table>
          </div>
        ))}
      </div>
    )
  },
}
