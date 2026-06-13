// T-P2-3 — <LoadShell> primitive.
//
// Tabbed registry views (NetworkInventoryView, HelpdeskView, parts of
// WorkItemsView, etc.) all gate their body on the same 5-state union:
//   loading | denied | unavailable | error | empty | ok
// and re-render the same Skeleton / PermissionDenied / EmptyState / ErrorBanner
// for each non-ok state. NetworkInventoryView had a local LoadShell that handled
// the wiring; this lifts it to a primitive so other views can adopt it without
// re-duplicating the 14-line state ladder.
//
// State union mirrors `LoadState<T>` from NetworkInventoryView:
//
//   type LoadState<T> =
//     | { state: 'loading' }
//     | { state: 'ok'; items: T[] }
//     | { state: 'empty' }
//     | { state: 'denied' }
//     | { state: 'unavailable' }
//     | { state: 'error'; message: string }
//
// Render contract: children is a function `(items: T[]) => ReactNode` invoked
// only for the 'ok' branch. Other branches render the corresponding state
// component with the supplied labels.
import type { ReactNode } from 'react'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import { SearchIcon, PackageIcon } from '../components/icons'

export type LoadState<T> =
  | { state: 'loading' }
  | { state: 'ok'; items: T[] }
  | { state: 'empty' }
  | { state: 'denied' }
  | { state: 'unavailable' }
  | { state: 'error'; message: string }

export type LoadShellProps<T> = {
  state: LoadState<T>
  emptyTitle: string
  emptyMessage: string
  onRetry: () => void
  children: (items: T[]) => ReactNode
  /** Override the empty-state icon (default: search glyph). */
  emptyIcon?: ReactNode
  /** Override the unavailable-state title (default: "Not yet available"). */
  unavailableTitle?: string
  /** Override the unavailable-state message. */
  unavailableMessage?: string
  /** Override the unavailable-state icon. */
  unavailableIcon?: ReactNode
  /** Override the denied-state message. */
  deniedMessage?: string
  /** Override skeleton row count (default 5). */
  skeletonRows?: number
}

export function LoadShell<T>({
  state,
  emptyTitle,
  emptyMessage,
  onRetry,
  children,
  emptyIcon,
  unavailableTitle = 'Not yet available',
  unavailableMessage = 'This view will populate once the backing service is enabled.',
  unavailableIcon,
  deniedMessage,
  skeletonRows = 5,
}: LoadShellProps<T>) {
  if (state.state === 'loading') return <SkeletonRows rows={skeletonRows} />
  if (state.state === 'denied') return <PermissionDenied message={deniedMessage} />
  if (state.state === 'unavailable') {
    return (
      <EmptyState
        icon={unavailableIcon ?? <PackageIcon size={36} />}
        title={unavailableTitle}
        message={unavailableMessage}
      />
    )
  }
  if (state.state === 'error') return <ErrorBanner message={state.message} onRetry={onRetry} />
  if (state.state === 'empty') {
    return <EmptyState icon={emptyIcon ?? <SearchIcon size={36} />} title={emptyTitle} message={emptyMessage} />
  }
  return <>{children(state.items)}</>
}

export default LoadShell
