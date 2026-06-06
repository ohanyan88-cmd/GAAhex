// WorkItemsBoard — shared presentational Kanban board for WorkItems lists.
// Read-only grouping by status (no drag-drop). Cards click → onRowClick.
//
// Status columns are fixed: TODO, IN_PROGRESS, BLOCKED, DONE, CANCELLED. Each
// card mirrors the kit's `.board-card` shape: id, priority pill, title, then a
// scheduled/due hint footer. No invented fields.

import { useState } from 'react'
import { type WorkItem, type WorkItemStatus } from '../lib/workitems'
import type { User } from '../lib/users'
import { resolveUserDisplay } from './UserPicker'
import { StatusPill, Button } from '../primitives'  // T-P3-7
import { PlayIcon, CheckIcon, PauseIcon } from './icons'
import { toast } from './Toast'
import type { WorkItemAction } from './WorkItemsTable'

// ── Helpers (mirrors WorkItemsTable so cards/rows stay visually consistent) ──

function fmtDateShort(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toLocaleDateString()
}

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

function priorityPill(priority: string | null | undefined) {
  const p = (priority ?? '').toUpperCase()
  if (!priority) return null
  const variant: PillVariant = p === 'URGENT' ? 'critical'
    : p === 'HIGH' ? 'degraded'
    : p === 'LOW' ? 'neutral'
    : 'info'
  const label = p === 'URGENT' ? 'Urgent' : p === 'HIGH' ? 'High' : p === 'LOW' ? 'Low' : 'Normal'
  return <StatusPill variant={variant} label={label} size="sm" />
}

// Column descriptor: status enum value, display label, dot tone, items.
const COLUMNS: { status: WorkItemStatus; label: string; tone: string }[] = [
  { status: 'TODO',        label: 'To Do',       tone: 'var(--gx-neutral, var(--gx-text-3))' },
  { status: 'IN_PROGRESS', label: 'In Progress', tone: 'var(--gx-warning, var(--gx-warning-fg))' },
  { status: 'BLOCKED',     label: 'Blocked',     tone: 'var(--gx-danger, var(--gx-danger-fg))' },
  { status: 'DONE',        label: 'Done',        tone: 'var(--gx-success, var(--gx-success-fg))' },
  { status: 'CANCELLED',   label: 'Cancelled',   tone: 'var(--gx-text-3)' },
]

export type WorkItemsBoardProps = {
  items: WorkItem[]
  users: User[]
  onRowClick: (item: WorkItem) => void
  onStatusChange: (item: WorkItem, action: WorkItemAction) => Promise<void>
}

export default function WorkItemsBoard({ items, users, onRowClick, onStatusChange }: WorkItemsBoardProps) {
  const grouped = new Map<WorkItemStatus, WorkItem[]>()
  for (const col of COLUMNS) grouped.set(col.status, [])
  for (const it of items) {
    const s = (it.status ?? 'TODO') as WorkItemStatus
    if (grouped.has(s)) grouped.get(s)!.push(it)
    else grouped.set('TODO', [...(grouped.get('TODO') ?? []), it])
  }

  // Hide CANCELLED column entirely when empty (it's noise for most users).
  const visibleCols = COLUMNS.filter((c) => c.status !== 'CANCELLED' || (grouped.get(c.status)?.length ?? 0) > 0)

  return (
    <div
      className="board-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${visibleCols.length}, minmax(220px, 1fr))`,
        gap: 14,
      }}
    >
      {visibleCols.map((col) => {
        const colItems = grouped.get(col.status) ?? []
        return (
          <div
            key={col.status}
            style={{
              background: 'var(--gx-bg-subtle)',
              border: '1px solid var(--gx-border-subtle, var(--gx-border))',
              borderRadius: 'var(--gx-radius-lg, 12px)',
              padding: 'var(--gx-space-5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', padding: '4px 6px 12px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.tone }} />
              <span style={{ fontSize: 'var(--gx-text-sm)', fontWeight: 600, color: 'var(--gx-text-1)' }}>{col.label}</span>
              <span
                className="badge"
                style={{
                  background: 'var(--gx-surface-2, var(--gx-surface))',
                  color: 'var(--gx-text-3)',
                  marginLeft: 'auto',
                }}
              >
                {colItems.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {colItems.map((it) => (
                <BoardCard
                  key={it.id}
                  item={it}
                  users={users}
                  onRowClick={onRowClick}
                  onStatusChange={onStatusChange}
                />
              ))}
              {colItems.length === 0 && (
                <div className="hint" style={{ fontSize: 'var(--gx-text-11)', padding: 'var(--gx-space-6) var(--gx-space-3)', color: 'var(--gx-text-3)' }}>
                  No items.
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BoardCard({
  item, users, onRowClick, onStatusChange,
}: {
  item: WorkItem
  users: User[]
  onRowClick: (item: WorkItem) => void
  onStatusChange: (item: WorkItem, action: WorkItemAction) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const s = (item.status ?? 'TODO') as WorkItemStatus
  const dueShort = fmtDateShort(item.due_at)
  const assignee = resolveUserDisplay(item.assigned_user_id, users)

  async function act(action: WorkItemAction, e: React.MouseEvent) {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try { await onStatusChange(item, action) }
    catch (err) { toast.error((err as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div
      className="board-card card"
      style={{
        padding: 'var(--gx-space-4)',
        cursor: 'pointer',
        boxShadow: 'var(--gx-shadow-xs, none)',
      }}
      onClick={() => onRowClick(item)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-link, var(--gx-primary))' }}>
          {item.id.slice(0, 8)}
        </span>
        <span style={{ marginLeft: 'auto' }}>{priorityPill(item.priority)}</span>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.45, marginBottom: 'var(--gx-space-5)', color: 'var(--gx-text-1)' }}>
        {item.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
        {item.assigned_user_id && <span title={assignee}>{assignee}</span>}
        {dueShort && <span style={{ marginLeft: 'auto' }} className="mono">{dueShort}</span>}
      </div>
      {/* Inline status actions — same set as the table row */}
      <div className="row-actions" style={{ marginTop: 'var(--gx-space-5)', justifyContent: 'flex-end', display: 'flex', gap: 4 }}>
        {s === 'TODO' && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={(e) => act('start', e)} title="Start">
            <PlayIcon size={12} /> Start
          </Button>
        )}
        {s === 'IN_PROGRESS' && (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={(e) => act('complete', e)} title="Complete">
              <CheckIcon size={12} /> Done
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={(e) => act('block', e)} title="Block">
              <PauseIcon size={12} />
            </Button>
          </>
        )}
        {s === 'BLOCKED' && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={(e) => act('start', e)} title="Resume">
            <PlayIcon size={12} /> Resume
          </Button>
        )}
        {(s === 'DONE' || s === 'CANCELLED') && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={(e) => act('reopen', e)} title="Reopen">
            Reopen
          </Button>
        )}
      </div>
    </div>
  )
}

// Re-export the default status-change handler factory from the table module so
// MyTasksView/WorkItemsView can import a single source.
export { makeStatusChangeHandler } from './WorkItemsTable'
