// Pure types, constants, and helpers for RevenueAssuranceView and its sub-panels.

export type Overview = {
  mrr?: number
  active_subscriptions?: number
  ar_outstanding?: number
  overdue_total?: number
  overdue_count?: number
  collected_this_month?: number
  collected_prev_month?: number
  [k: string]: any
}

export type TrendPoint = { month: string; collected: number; invoiced: number }
export type AgingBuckets = { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number }

// Per-widget fetch state machine. 'hide' is silent — the widget is omitted, not greyed out.
export type Fetched<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'hide' }

export type FindingType = 'unbilled_service' | 'uninvoiced_subscription' | 'orphan_invoice'
export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical'
export type FindingStatus = 'open' | 'investigating' | 'resolved' | 'false_positive'

export interface RaFinding {
  id: string
  tenant_id: string
  finding_type: FindingType
  severity: FindingSeverity
  entity_type: 'service' | 'subscription' | 'invoice'
  entity_id: string
  summary: string
  detail_json: Record<string, any>
  detected_at: string
  status: FindingStatus
  ack_at: string | null
  ack_by: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution: string | null
  scan_run_id: string | null
}

export interface RaScanRun {
  id: string
  tenant_id: string
  started_at: string
  completed_at: string | null
  status: 'running' | 'success' | 'failed'
  findings_count: number
  error_message: string | null
  triggered_by: string | null
}

export type TabKey = 'overview' | 'findings'

export type FindingsState =
  | { state: 'loading' }
  | { state: 'ok'; items: RaFinding[] }
  | { state: 'empty' }
  | { state: 'denied' }
  | { state: 'unavailable' }
  | { state: 'error'; message: string }

export type DetailState =
  | { state: 'loading' }
  | { state: 'ok'; value: RaFinding }
  | { state: 'error'; message: string }

export type ActionModalState = {
  kind: 'resolve' | 'false_positive'
  finding: RaFinding
  resolution: string
  submitting: boolean
} | null

export type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

export const FINDING_TYPE_LABEL: Record<FindingType, string> = {
  unbilled_service: 'Unbilled Service',
  uninvoiced_subscription: 'Uninvoiced Sub',
  orphan_invoice: 'Orphan Invoice',
}

export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  false_positive: 'False positive',
}

export function statusToPill(s: FindingStatus): PillVariant {
  switch (s) {
    case 'open':           return 'critical'
    case 'investigating':  return 'degraded'
    case 'resolved':       return 'active'
    case 'false_positive': return 'neutral'
  }
}

export function severityToPill(sev: FindingSeverity): PillVariant {
  switch (sev) {
    case 'critical': return 'critical'
    case 'high':     return 'degraded'
    case 'medium':   return 'info'
    case 'low':      return 'neutral'
  }
}
