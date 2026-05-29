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
  const style: React.CSSProperties = {
    textAlign: variant === 'numeric' ? 'right' : align,
    fontSize: (variant === 'id' || variant === 'mono' || variant === 'numeric') ? 'var(--gx-text-10)' : 'var(--gx-text-11)',
    fontFamily: (variant === 'id' || variant === 'mono' || variant === 'numeric') ? 'var(--font-mono, ui-monospace)' : 'inherit',
    color: (variant === 'id' || variant === 'mono' || variant === 'muted') ? 'var(--text-2)' : 'var(--text)',
    width: width,
    maxWidth: width,
    overflow: width ? 'hidden' : undefined,
    textOverflow: width ? 'ellipsis' : undefined,
    whiteSpace: width ? 'nowrap' : undefined,
  }
  return <td style={style}>{children}</td>
}
