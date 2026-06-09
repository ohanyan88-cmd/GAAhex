import type { PillVariant, TabKey } from './types'

// Relative-time formatter for balance_updated_at; mirrors HomeView's relTime() so the
// snapshot card reads consistently with the rest of the app.
export function relTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (isNaN(ts)) return ''
  const d = Math.max(0, Date.now() - ts) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

// DF-6 — NEGATIVE = customer owes us (red), POSITIVE = credit on account (green), zero = default.
export function balanceTone(s: string | null | undefined): string {
  if (s === null || s === undefined || s === '') return 'var(--gx-text-1)'
  const n = Number(s)
  if (!isFinite(n) || n === 0) return 'var(--gx-text-1)'
  return n < 0 ? 'var(--gx-danger)' : 'var(--gx-success)'
}

// Numeric value of a Decimal-string for math (e.g. % of limit). Treat missing as 0.
export function decimalNum(s: string | null | undefined): number {
  if (s === null || s === undefined || s === '') return 0
  const n = Number(s)
  return isFinite(n) ? n : 0
}

// Generic CRM/billing status → StatusPill variant. Statuses are configurable so this
// only tints the well-known verbs and falls back to `info` for everything else.
export function mapCustomerStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (['ACTIVE', 'PAID', 'RESOLVED', 'WON'].includes(v)) return 'active'
  if (['OVERDUE', 'CANCELLED', 'VOID', 'CHURNED', 'LOST'].includes(v)) return 'critical'
  if (['SUSPENDED'].includes(v)) return 'degraded'
  if (['DRAFT', 'NEW', 'PROSPECT'].includes(v)) return 'neutral'
  return 'info'
}

export function tabLabel(k: TabKey, t: (key: string, fallback?: string) => string): string {
  switch (k) {
    // Canonical Object Detail tabs (file 10) — labels match the standard exactly.
    case 'overview':       return t('cust.tab.overview', 'Overview')
    case 'timeline':       return t('cust.tab.timeline', 'Timeline')
    case 'tasks':          return t('cust.tab.tasks', 'Tasks')
    case 'comments':       return t('cust.tab.comments', 'Comments')
    case 'attachments':    return t('cust.tab.attachments', 'Attachments')
    case 'approvals':      return t('cust.tab.approvals', 'Approvals')
    case 'related':        return t('cust.tab.related', 'Related')
    case 'communications': return t('cust.tab.communications', 'Communications')
    case 'audit':          return t('cust.tab.audit', 'Audit')
    // Customer-specific tabs (preserved, render after the canonical nine).
    case 'accounts':  return t('cust.tab.accounts', 'Accounts')
    case 'contacts':  return t('cust.tab.contacts', 'Contacts')
    case 'sites':     return t('cust.tab.sites', 'Sites')
    case 'contracts': return t('cust.tab.contracts', 'Contracts')
    case 'slas':      return t('cust.tab.slas', 'SLAs')
  }
}
