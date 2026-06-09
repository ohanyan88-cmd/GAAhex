import type { Subscription, Invoice } from '../../lib/billing'

// ─── Core domain types ────────────────────────────────────────────────────────

export type Profile = { id: string; status?: string | null; name?: string; title?: string; [k: string]: any }
export type Service = { id: string; name?: string; type?: string; status?: string | null; activated_at?: string | null }
export type Summary = {
  currency?: string
  total_billed?: number
  total_paid?: number
  outstanding?: number
  overdue_count?: number
  subscription_count?: number
  invoice_count?: number
}
export type C360 = {
  profile: Profile
  subscriptions: Subscription[]
  invoices: Invoice[]
  summary: Summary
  related: Record<string, number>
  services?: Service[]
}

// Phase A.2 — per-account balance + consolidated subtree contracts. The backend serializes Decimal
// columns as STRINGS in MAJOR units (e.g. "1234.56") to preserve precision; we keep them as strings
// in state and format on render.
export type Account = {
  id: string
  type?: string | null
  currency?: string | null
  billing_cycle?: string | null
  status?: string | null
  holder_party_name?: string | null
  parent_account_id?: string | null
  [k: string]: any
}
export type BalanceSnapshot = {
  current_balance: string
  credit_limit: string
  available_credit: string
  balance_updated_at: string | null
}
export type ConsolidatedBalance = {
  root_account_id: string
  root_balance: string
  consolidated_balance: string
  consolidated_credit_limit: string
  subtree_size: number
}

// Customer 360 inline tabs.
// File 10 (Object Detail Standard) mandates a canonical 9-tab set on every detail page
// BEFORE any object-specific tabs. The canonical nine come first, then the five
// CustomerView-specific related-record tabs round out the list.
// Tabs are lazy-loaded on first activation and cached.
export type CanonicalTabKey =
  | 'overview' | 'timeline' | 'tasks' | 'comments' | 'attachments'
  | 'approvals' | 'related' | 'communications' | 'audit'
export type CustomTabKey = 'accounts' | 'contacts' | 'sites' | 'contracts' | 'slas'
export type TabKey = CanonicalTabKey | CustomTabKey

export const CANONICAL_TAB_ORDER: CanonicalTabKey[] = [
  'overview', 'timeline', 'tasks', 'comments', 'attachments',
  'approvals', 'related', 'communications', 'audit',
]
export const CUSTOM_TAB_ORDER: CustomTabKey[] = ['accounts', 'contacts', 'sites', 'contracts', 'slas']
export const TAB_ORDER: TabKey[] = [...CANONICAL_TAB_ORDER, ...CUSTOM_TAB_ORDER]
// Canonical tabs self-fetch from their own components — the parent doesn't pre-load
// their data, so we only register the custom-tab keys in the legacy loader.
export const CUSTOM_TAB_SET = new Set<TabKey>(CUSTOM_TAB_ORDER)

// Contact / Site / Contract are entity records: backend response is a plain list of
// { id, status, owner_node_id, data: {...} } where ref-fields land in `data`.
export type EntityRow = { id: string; status?: string | null; owner_node_id?: string | null; data?: Record<string, any>; [k: string]: any }

// Helpdesk ticket shape we render in the SLAs tab (subset of helpdesk.ts `Ticket`).
export type SlaRow = { id: string; subject?: string; status?: string | null; priority?: string | null; customer_id?: string | null; sla_due_at?: string | null; sla_breached?: boolean | null; created_at?: string | null }

export type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

// Re-export billing types used by callers of this module.
export type { Subscription, Invoice }
