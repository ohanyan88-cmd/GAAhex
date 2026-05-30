import React from 'react'

type CellVariant = 'default' | 'mono' | 'muted' | 'numeric' | 'id'
type Align = 'left' | 'right' | 'center'

interface DataTableCellProps {
  variant?: CellVariant
  align?: Align
  width?: string | number
  children: React.ReactNode
}

export function DataTableCell({ variant = 'default', align = 'left', width, children }: DataTableCellProps) {
  const cls = [
    'dtc',
    variant === 'mono' ? 'dtc-mono' : '',
    variant === 'muted' ? 'dtc-muted' : '',
    variant === 'numeric' ? 'dtc-numeric' : '',
    variant === 'id' ? 'dtc-id' : '',
  ].filter(Boolean).join(' ')
  // Inline style is reserved for caller-driven alignment and width truncation,
  // which can't be expressed as a finite class set.
  const style: React.CSSProperties = {
    ...(align !== 'left' && variant !== 'numeric' ? { textAlign: align } : null),
    ...(width != null ? { width, maxWidth: width, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : null),
  }
  return <td className={cls} style={style}>{children}</td>
}
