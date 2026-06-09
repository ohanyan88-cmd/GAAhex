import { StatusPill } from '../../primitives'
import type { WorkItemStatus } from '../../lib/workitems'
import type { PillVariant } from './types'
import { getStatusTone } from '../../lib/status-constants'

// WorkItem status → StatusPill variant — delegated to canonical mapper (L-16).
export function mapWorkItemStatus(s: string | null | undefined): PillVariant {
  return getStatusTone(s, 'workitem')
}

export function statusLabelFull(s: string | null | undefined): string {
  const v = (s ?? '').toUpperCase()
  if (v === 'TODO') return 'To Do'
  if (v === 'IN_PROGRESS') return 'In Progress'
  if (v === 'BLOCKED') return 'Blocked'
  if (v === 'DONE') return 'Done'
  if (v === 'CANCELLED') return 'Cancelled'
  return s ?? '—'
}

export function statusLabel(s: WorkItemStatus): string {
  if (s === 'TODO') return 'To Do'
  if (s === 'IN_PROGRESS') return 'In Progress'
  if (s === 'BLOCKED') return 'Blocked'
  if (s === 'DONE') return 'Done'
  return 'Cancelled'
}

export function priorityPill(priority: string | null | undefined) {
  const p = (priority ?? '').toUpperCase()
  if (!priority) return <span className="muted">—</span>
  const variant: PillVariant = p === 'URGENT' ? 'critical'
    : p === 'HIGH' ? 'degraded'
    : p === 'LOW' ? 'neutral'
    : 'info'
  const label = p === 'URGENT' ? 'Urgent' : p === 'HIGH' ? 'High' : p === 'LOW' ? 'Low' : 'Normal'
  return <StatusPill variant={variant} label={label} size="sm" />
}
