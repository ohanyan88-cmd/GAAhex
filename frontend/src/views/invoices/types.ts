// Pure types, constants, and helpers for InvoicesView and its sub-components.
import type { CSSProperties } from 'react'

export type Outstanding = {
  id: string
  total: string
  paid: string
  credited: string
  outstanding: string
  computed_at?: string | null
}

export type Allocation = {
  id: string
  payment_id: string
  invoice_id?: string
  amount: string
  applied_at: string | null
  applied_by: string | null
}

export type InvoiceTabKey =
  | 'overview' | 'timeline' | 'tasks' | 'comments' | 'attachments'
  | 'approvals' | 'related' | 'communications' | 'audit'

export const INVOICE_TAB_ORDER: InvoiceTabKey[] = [
  'overview', 'timeline', 'tasks', 'comments', 'attachments',
  'approvals', 'related', 'communications', 'audit',
]

export function invoiceTabLabel(k: InvoiceTabKey): string {
  switch (k) {
    case 'overview':       return 'Overview'
    case 'timeline':       return 'Timeline'
    case 'tasks':          return 'Tasks'
    case 'comments':       return 'Comments'
    case 'attachments':    return 'Attachments'
    case 'approvals':      return 'Approvals'
    case 'related':        return 'Related'
    case 'communications': return 'Communications'
    case 'audit':          return 'Audit'
  }
}

// Columns that get special class treatment in their <th>/<td>
export const COL_CLASS: Record<string, string> = { amount: 'num' }

// Columns that get special inline styling on their <td>
export function colTdStyle(colKey: string): CSSProperties | undefined {
  if (colKey === 'number') return { color: 'var(--gx-gold)', fontWeight: 'var(--gx-weight-semibold)' }
  return undefined
}

// Columns that get extra className on their <td>
export function colTdClass(colKey: string): string {
  if (colKey === 'number' || colKey === 'issued' || colKey === 'due') return 'mono'
  if (colKey === 'amount') return 'num'
  return ''
}

// A.3 endpoints return Decimal STRINGS in major units (e.g. "100.50"). Existing money() expects
// integer luma (minor). Convert at the boundary so we keep one display formatter.
export function decStrToLuma(s: string | null | undefined): number {
  if (s === null || s === undefined) return 0
  const n = parseFloat(s)
  return isNaN(n) ? 0 : Math.round(n * 100)
}
