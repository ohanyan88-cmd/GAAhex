// Status constants — Standard 14 single source of truth for all domain status enums.
// Types for existing API domains live in their helper modules (billing.ts, workitems.ts,
// paymentgw.ts). This file adds: (a) missing domain types, (b) semantic grouping arrays
// for `includes()` filter checks, (c) full value sets for filter tabs/pickers.
//
// Re-export existing types so callers only need one import:
export type { WorkItemStatus } from './workitems'
export type { InvoiceStatus, SubscriptionStatus } from './billing'
export type { PaymentOrderStatus } from './paymentgw'

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
