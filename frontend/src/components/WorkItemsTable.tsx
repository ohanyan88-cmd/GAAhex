// WorkItemsTable — shared presentational table for WorkItems lists (used by both
// WorkItemsView and MyTasksView). Pure props in / events out — no fetch, no
// modal state, no toast. Status pill colors map from the enum verbatim.
//
// Columns are passed in so each consumer can choose its own column set; sorting,
// selection, and pagination are owned by the parent.

import type { ReactNode } from 'react'
import { useState } from 'react'
import {
  type WorkItem, type WorkItemStatus,
  startWorkItem, completeWorkItem, blockWorkItem, reopenWorkItem,
} from '../lib/workitems'
import type { User } from '../lib/users'
import { resolveUserDisplay } from './UserPicker'
import { StatusPill, Button } from '../primitives'  // T-P3-7
import { PlayIcon, CheckIcon, PauseIcon } from './icons'
import { ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { toast } from './Toast'

// ── Helpers (kept in-module so both consumers see identical rendering) ────────

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapWorkItemStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'DONE' || v === 'CLOSED') return 'active'
  if (v === 'IN_PROGRESS') return 'degraded'
  if (v === 'BLOCKED') return 'critical'
  if (v === 'CANCELLED') return 'neutral'
  return 'info'
}
function statusLabel(s: string | null | undefined): string {
  const v = (s ?? '').toUpperCase()
  if (v === 'TODO') return 'To Do'
  if (v === 'IN_PROGRESS') return 'In Progress'
  if (v === 'BLOCKED') return 'Blocked'
  if (v === 'DONE') return 'Done'
  if (v === 'CANCELLED') return 'Cancelled'
  return s ?? '—'
}

function priorityPill(priority: string | null | undefined) {
  const p = (priority ?? '').toUpperCase()
  if (!priority) return <span className="muted">—</span>
  const variant: PillVariant = p === 'URGENT' ? 'critical'
    : p === 'HIGH' ? 'degraded'
    : p === 'LOW' ? 'neutral'
    : 'info'
  const label = p === 'URGENT' ? 'Urgent' : p === 'HIGH' ? 'High' : p === 'LOW' ? 'Low' : 'Normal'
  return <StatusPill variant={variant} label={label} size="sm" />
}

// ── Public column descriptor (matches pageConfig.columns shape) ──────────────

export type WorkItemColumn = { key: string; label: string; visible: boolean }

export type WorkItemAction = 'start' | 'complete' | 'block' | 'reopen'

export type WorkItemsTableProps = {
  items: WorkItem[]
  columns: WorkItemColumn[]
  users: User[]
  customerNames: Record<string, string>
  // sort
  sortKey: string | null
  sortDir: 1 | -1
  onSortChange: (key: string) => void
  // row interaction
  onRowClick: (item: WorkItem) => void
  onStatusChange: (item: WorkItem, action: WorkItemAction) => Promise<void>
  // optional select column
  selectable?: boolean
  selected?: Set<string>
  onToggleSelect?: (id: string) => void
  onTogglePageAll?: () => void
  allOnPageSelected?: boolean
  // optional custom-field cells (per row)
  cfHeaders?: ReactNode
  cfCellsFor?: (id: string) => ReactNode
  customFieldCount?: number
}

// ── Component ────────────────────────────────────────────────────────────────

export default function WorkItemsTable({
  items, columns, users, customerNames,
  sortKey, sortDir, onSortChange,
  onRowClick, onStatusChange,
  selectable = false, selected, onToggleSelect, onTogglePageAll, allOnPageSelected = false,
  cfHeaders, cfCellsFor, customFieldCount = 0,
}: WorkItemsTableProps) {
  const totalCols = (selectable ? 1 : 0) + columns.length + customFieldCount + 1

  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="sel-col">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={onTogglePageAll}
                  aria-label="Select all rows on this page"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                onClick={() => onSortChange(col.key)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {col.label}
                  {sortKey === col.key
                    ? (sortDir === 1
                      ? <ArrowUp size={12} style={{ color: 'var(--gx-primary)' }} />
                      : <ArrowDown size={12} style={{ color: 'var(--gx-primary)' }} />)
                    : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                </span>
              </th>
            ))}
            {cfHeaders}
            <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <WorkItemRow
              key={item.id}
              item={item}
              users={users}
              customerNames={customerNames}
              columns={columns}
              cfCells={cfCellsFor ? cfCellsFor(item.id) : null}
              onRowClick={onRowClick}
              onStatusChange={onStatusChange}
              selectable={selectable}
              selected={selected?.has(item.id) ?? false}
              onToggleSelect={onToggleSelect}
            />
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={totalCols} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                No matching work items.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function WorkItemRow({
  item, users, customerNames, columns, cfCells,
  onRowClick, onStatusChange,
  selectable, selected, onToggleSelect,
}: {
  item: WorkItem
  users: User[]
  customerNames: Record<string, string>
  columns: WorkItemColumn[]
  cfCells: ReactNode
  onRowClick: (item: WorkItem) => void
  onStatusChange: (item: WorkItem, action: WorkItemAction) => Promise<void>
  selectable: boolean
  selected: boolean
  onToggleSelect?: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const s = (item.status ?? 'TODO') as WorkItemStatus

  async function act(action: WorkItemAction) {
    if (busy) return
    setBusy(true)
    try { await onStatusChange(item, action) }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  const cust = item.customer_id
    ? (customerNames[item.customer_id] ?? item.customer_id.slice(0, 8))
    : '—'

  return (
    <tr className={selected ? 'sel' : ''} onClick={() => onRowClick(item)} style={{ cursor: 'pointer' }}>
      {selectable && (
        <td className="sel-col" onClick={(e) => { e.stopPropagation(); onToggleSelect?.(item.id) }} style={{ cursor: 'default' }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(item.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select work item ${item.title}`}
          />
        </td>
      )}
      {columns.map((col) => {
        if (col.key === 'title') return (
          <td key={col.key} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </td>
        )
        if (col.key === 'kind') return (
          <td key={col.key} className="muted">
            {item.kind ? item.kind.charAt(0).toUpperCase() + item.kind.slice(1) : '—'}
          </td>
        )
        if (col.key === 'customer') return <td key={col.key}>{cust}</td>
        if (col.key === 'status') return (
          <td key={col.key}>
            {item.status
              ? <StatusPill variant={mapWorkItemStatus(item.status)} label={statusLabel(item.status)} size="sm" />
              : <span className="muted">—</span>}
          </td>
        )
        if (col.key === 'priority') return <td key={col.key}>{priorityPill(item.priority)}</td>
        if (col.key === 'assignee') return (
          <td key={col.key} className="muted">{resolveUserDisplay(item.assigned_user_id, users)}</td>
        )
        if (col.key === 'due') return (
          <td key={col.key} className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDateShort(item.due_at)}</td>
        )
        if (col.key === 'scheduled') return (
          <td key={col.key} className="mono" style={{ whiteSpace: 'nowrap' }}>
            {item.scheduled_at ? fmtDateShort(item.scheduled_at) : '—'}
            {item.location
              ? <span title={item.location}> {item.location.length > 16 ? item.location.slice(0, 14) + '…' : item.location}</span>
              : null}
          </td>
        )
        return null
      })}
      {cfCells}
      <td className="actions-col" onClick={(e) => e.stopPropagation()}>
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          {s === 'TODO' && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('start')} title="Start">
              <PlayIcon size={12} /> Start
            </Button>
          )}
          {s === 'IN_PROGRESS' && (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('complete')} title="Complete">
                <CheckIcon size={12} /> Done
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('block')} title="Block">
                <PauseIcon size={12} />
              </Button>
            </>
          )}
          {s === 'BLOCKED' && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('start')} title="Resume">
              <PlayIcon size={12} /> Resume
            </Button>
          )}
          {(s === 'DONE' || s === 'CANCELLED') && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('reopen')} title="Reopen">
              Reopen
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Default status-change handler ─────────────────────────────────────────────
// Convenience factory: parents can pass this directly to onStatusChange if they
// just want the standard "call the matching mutator + refresh" behavior.

export function makeStatusChangeHandler(token: string, refresh: () => void) {
  return async (item: WorkItem, action: WorkItemAction) => {
    if (action === 'start') await startWorkItem(token, item.id)
    else if (action === 'complete') await completeWorkItem(token, item.id)
    else if (action === 'block') await blockWorkItem(token, item.id)
    else await reopenWorkItem(token, item.id)
    refresh()
  }
}
