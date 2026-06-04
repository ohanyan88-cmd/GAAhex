import React from 'react'

// DataTableCell — kit-flavored <td> with variant tinting + sticky widths.
// Used by HelpdeskView's configurable column renderer; other tables can
// adopt incrementally.
//
// TL-1 — DataTableRow was deleted 2026-06-04 (zero production callers).
// DataTableCell stayed because HelpdeskView uses it. If a future feature
// needs the row-with-checkbox primitive, rebuild from current table
// patterns (see RowActionsMenu for the canonical row-actions component).
interface DataTableCellProps {
  variant?: 'default' | 'mono' | 'id' | 'num' | 'muted'
  align?: 'left' | 'right' | 'center'
  width?: string
  children: React.ReactNode
}

export function DataTableCell({ variant = 'default', align = 'left', width, children }: DataTableCellProps) {
  const classes = ['dtc']
  if (variant === 'mono') classes.push('mono')
  if (variant === 'id') classes.push('mono', 'dtc-id')
  if (variant === 'num') classes.push('num')
  if (variant === 'muted') classes.push('hint')
  if (align === 'right') classes.push('dtc-right')
  if (align === 'center') classes.push('dtc-center')
  return (
    <td className={classes.join(' ')} style={width ? { width, minWidth: width } : undefined}>
      {children}
    </td>
  )
}
