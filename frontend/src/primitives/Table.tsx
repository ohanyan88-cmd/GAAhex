import type { ReactNode } from 'react'
import { SkeletonRows, EmptyState, ErrorBanner } from '../components/States'
import { humanRef, looksLikeRawId } from '../lib/humanize'

// Table — the canonical data table (standard §4/§5: the element for "same attributes
// across many rows"). Carries the cross-cutting guards:
//   §5  it IS the table element — callers pick it only for tabular data, not as a default.
//   §6  human references only — a cell that would render a raw UUID is swapped to humanRef().
//   §7  row-click opens an in-place modal — the Table never navigates; it calls onRowClick
//       and the caller renders a gx-Modal. Rows are keyboard-operable (Enter / Space).
//   all states — loading / error / empty resolve to the canonical state primitives.
// Longest-wins sizing is handled by consistent cell padding + shared pill/chip width tokens.

export interface Column<T> {
  key: string
  header: ReactNode
  /** Cell renderer. If omitted, the raw `row[key]` is shown (and UUID-guarded per §6). */
  render?: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string
}

export type TableStatus = 'ok' | 'loading' | 'error' | 'empty'

export interface TableProps<T> {
  columns: Column<T>[]
  rows: T[]
  /** Explicit state. Omit to auto-derive: empty when `rows` is empty, else ok. */
  status?: TableStatus
  rowKey: (row: T) => string
  /** §7 — opens an in-place modal in the caller; the Table never navigates. */
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyMessage?: string
  errorMessage?: string
  onRetry?: () => void
  skeletonRows?: number
  caption?: string
}

export function Table<T>({
  columns,
  rows,
  status,
  rowKey,
  onRowClick,
  emptyTitle = 'Nothing here yet',
  emptyMessage = 'Items will appear here once they exist.',
  errorMessage,
  onRetry,
  skeletonRows = 6,
  caption,
}: TableProps<T>) {
  const resolved: TableStatus = status ?? (rows.length === 0 ? 'empty' : 'ok')

  if (resolved === 'loading') return <SkeletonRows rows={skeletonRows} />
  if (resolved === 'error') {
    return <ErrorBanner message={errorMessage ?? 'Something went wrong loading this.'} onRetry={onRetry} />
  }
  if (resolved === 'empty') return <EmptyState title={emptyTitle} message={emptyMessage} />

  return (
    <table className="gx-table">
      {caption && <caption className="gx-table-cap">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className="gx-th" data-align={c.align ?? 'left'} style={c.width ? { width: c.width } : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const clickable = !!onRowClick
          return (
            <tr
              key={rowKey(row)}
              className={clickable ? 'gx-tr gx-tr-click' : 'gx-tr'}
              tabIndex={clickable ? 0 : undefined}
              role={clickable ? 'button' : undefined}
              onClick={clickable ? () => onRowClick!(row) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRowClick!(row)
                      }
                    }
                  : undefined
              }
            >
              {columns.map((c) => {
                const content = c.render ? c.render(row) : (row as Record<string, unknown>)[c.key]
                // §6 guard — a raw UUID must never reach the UI; fall back to a human ref.
                const safe = looksLikeRawId(content) ? humanRef(row as Record<string, unknown>) : (content as ReactNode)
                return (
                  <td key={c.key} className="gx-td" data-align={c.align ?? 'left'}>
                    {safe}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
