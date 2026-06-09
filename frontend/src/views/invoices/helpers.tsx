// Rendering helpers for InvoicesView.

import type { ReactNode } from 'react'
import type { Invoice } from '../../lib/billing'
import { money } from '../../lib/money'
import { fmtDate } from '../../lib/time'
import { humanizeStatus } from '../../lib/humanize'
import { colTdClass, colTdStyle } from './types'

// Status → pill style. Uses kit primitives (gx-token-backed) only.
export function statusPill(status: string | null | undefined): ReactNode {
  const s = (status ?? '').toUpperCase()
  const cls = s === 'PAID' ? 'pill pill-success'
    : s === 'OVERDUE' ? 'pill pill-danger'
    : s === 'VOID' ? 'pill pill-neutral'
    : s === 'ISSUED' ? 'pill pill-info'
    : 'pill pill-neutral'
  return status
    ? <span className={cls}><span className="pill-dot" />{humanizeStatus(status)}</span>
    : <span>—</span>
}

// renderCell for configurable columns.
export function renderInvoiceCell(colKey: string, inv: Invoice, cust: (inv: Invoice) => string): ReactNode {
  switch (colKey) {
    case 'number': return inv.number ?? inv.id.slice(0, 8)
    case 'customer': return cust(inv)
    case 'issued': return fmtDate(inv.issued_at ?? inv.created_at)
    case 'due': return fmtDate(inv.due_at)
    case 'status': return statusPill(inv.status)
    case 'amount': return money(inv.total)
    default: return '—'
  }
}

export { colTdClass, colTdStyle }
