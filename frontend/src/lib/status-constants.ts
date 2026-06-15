// Status constants — Standard 14 single source of truth for all domain status enums.
// Types for existing API domains live in their helper modules (billing.ts, workitems.ts,
// paymentgw.ts). This file adds: (a) missing domain types, (b) semantic grouping arrays
// for `includes()` filter checks, (c) full value sets for filter tabs/pickers,
// (d) the canonical PillVariant type and getStatusTone() mapping (L-16).
//
// Re-export existing types so callers only need one import:
export type { WorkItemStatus } from './workitems'
export type { InvoiceStatus, SubscriptionStatus } from './billing'
export type { PaymentOrderStatus } from './paymentgw'

// ── Canonical StatusPill variant type (L-16) ──────────────────────────────────
// EN: Single definition — import from here instead of re-declaring in each view.
//     Matches GxStatusBadgeVariant (gx-StatusBadge.tsx) exactly.
//     Legacy aliases (active/degraded/critical) kept for backward compat.
// HY: Miakayn skazbnabanutʿyun — import el aysteghi amеn view-um verahastatman:
//     Hamapatasuм é GxStatusBadgeVariant-in: Legacy aliases-ery patmut'yan hamar:
export type PillVariant =
  // Semantic core (preferred for new callsites)
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  // Legacy aliases (backward-compat)
  | 'active'
  | 'degraded'
  | 'critical'
  // ISP / network provisioning states
  | 'online'
  | 'provisioned'
  | 'maintenance'

/**
 * getStatusTone — canonical status→PillVariant mapper (L-16).
 *
 * Covers all platform status enums (Standard 14) via a single normalised switch.
 * Optional `entityType` resolves same-named values that differ across domains
 * (e.g. "ACTIVE" is always 'active', but "PENDING" is 'info' for subscriptions
 * and 'degraded' for tickets — pass entityType to disambiguate when needed).
 *
 * Callers that do their own label formatting can ignore the return value's label
 * field and only use the variant.
 */
export function getStatusTone(status: string | null | undefined, entityType?: string): PillVariant {
  const v = (status ?? '').toUpperCase()

  // Universal positives
  if (
    v === 'ACTIVE' ||
    v === 'PAID' ||
    v === 'DONE' ||
    v === 'CLOSED' ||
    v === 'RESOLVED' ||
    v === 'ENABLED' ||
    v === 'SENT' ||
    v === 'AVAILABLE'
  ) {
    return 'active'
  }

  // Universal criticals
  if (
    v === 'FAILED' ||
    v === 'BLOCKED' ||
    v === 'EXPIRED' ||
    v === 'TERMINATED' ||
    v === 'EXHAUSTED' ||
    v === 'BREACHED'
  ) {
    return 'critical'
  }

  // Universal degraded (at-risk / warning states)
  if (v === 'SUSPENDED' || v === 'PAST_DUE' || v === 'OVERDUE') {
    return 'degraded'
  }

  // Universal neutral (terminal non-error states)
  if (
    v === 'CANCELLED' ||
    v === 'CANCELED' ||
    v === 'VOID' ||
    v === 'DRAFT' ||
    v === 'RETIRED' ||
    v === 'DISABLED' ||
    v === 'REMOVED' ||
    v === 'ARCHIVED' ||
    v === 'INACTIVE'
  ) {
    return 'neutral'
  }

  // Context-dependent: PENDING
  if (v === 'PENDING') {
    // Tickets/work: pending = degraded (waiting on action)
    if (entityType === 'ticket' || entityType === 'helpdesk') return 'degraded'
    // Everything else: pending = info (in-queue, not urgent)
    return 'info'
  }

  // Context-dependent: IN_PROGRESS
  if (v === 'IN_PROGRESS') {
    return entityType === 'workitem' || entityType === 'task' ? 'degraded' : 'active'
  }

  // Context-dependent: RESERVED
  if (v === 'RESERVED') return 'info'

  // Universal info fallback (open, trialing, queued, etc.)
  if (v === 'OPEN' || v === 'TRIALING' || v === 'QUEUED' || v === 'TODO') {
    return 'info'
  }

  // Unknown — fall through to info (non-alarming default)
  return 'info'
}

// ── Domain types (not yet in a helper module) ─────────────────────────────────

/** Helpdesk/support ticket status. */
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED'

/** Task lifecycle status (Standard 14 TaskStatus). */
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'WAITING' | 'COMPLETED' | 'CANCELLED'

/** Network service / CPE provisioning status. */
export type ServiceStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED'

/** Sales / provisioning order status. */
export type OrderStatus = 'DRAFT' | 'PENDING' | 'COMPLETED' | 'CANCELLED'

/** Approval request status. */
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

// ── WorkItem semantic groupings ───────────────────────────────────────────────

/** WorkItem statuses representing active / incomplete work (not yet done). */
export const WORKITEM_OPEN = ['TODO', 'IN_PROGRESS', 'BLOCKED'] as const

/** WorkItem statuses representing terminal / finished work. */
export const WORKITEM_CLOSED = ['DONE', 'CANCELLED'] as const

/** All WorkItem statuses — used for filter tab sets. */
export const WORKITEM_ALL = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'] as const

// ── Helpdesk / Ticket semantic groupings ─────────────────────────────────────

/** Ticket statuses where the issue is resolved or no longer active. */
export const TICKET_CLOSED = ['RESOLVED', 'CLOSED', 'CANCELLED'] as const

/** Ticket statuses where the issue still requires action. */
export const TICKET_OPEN = ['OPEN', 'IN_PROGRESS'] as const

/** All ticket statuses — used for filter tab sets. */
export const TICKET_ALL = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED'] as const

// ── Invoice semantic groupings ────────────────────────────────────────────────

/** Invoice statuses that are outstanding / require payment action. */
export const INVOICE_OUTSTANDING = ['ISSUED', 'OVERDUE'] as const

/** Invoice statuses that are settled / terminal. */
export const INVOICE_CLOSED = ['PAID', 'VOID'] as const

/** All invoice statuses — used for filter tab sets. */
export const INVOICE_ALL = ['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID'] as const

// ── Subscription semantic groupings ──────────────────────────────────────────

/** Subscription statuses where the service is not actively running. */
export const SUBSCRIPTION_INACTIVE = ['SUSPENDED', 'CANCELLED'] as const

/** All subscription statuses. */
export const SUBSCRIPTION_ALL = ['ACTIVE', 'SUSPENDED', 'CANCELLED'] as const

// ── Service (network/provisioning) groupings ──────────────────────────────────

/** All service provisioning statuses — used for filter tab sets. */
export const SERVICE_ALL = ['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED'] as const

// ── Order semantic groupings ──────────────────────────────────────────────────

/** Order statuses that are still in-flight (not yet completed or cancelled). */
export const ORDER_OPEN = ['DRAFT', 'PENDING'] as const

/** All order statuses — used for filter tab sets. */
export const ORDER_ALL = ['DRAFT', 'PENDING', 'COMPLETED', 'CANCELLED'] as const
