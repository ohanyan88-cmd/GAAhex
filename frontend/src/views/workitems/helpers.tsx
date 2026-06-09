import { StatusPill } from '../../primitives'
import type { PillVariant } from './types'

export function mapWorkItemStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'DONE' || v === 'CLOSED') return 'active'
  if (v === 'IN_PROGRESS') return 'degraded'
  if (v === 'BLOCKED') return 'critical'
  if (v === 'CANCELLED') return 'neutral'
  return 'info'
}

export function statusLabel(s: string | null | undefined): string {
  const v = (s ?? '').toUpperCase()
  if (v === 'TODO') return 'To Do'
  if (v === 'IN_PROGRESS') return 'In Progress'
  if (v === 'BLOCKED') return 'Blocked'
  if (v === 'DONE') return 'Done'
  if (v === 'CANCELLED') return 'Cancelled'
  return s ?? '—'
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
