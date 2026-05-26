import type { ReactNode } from 'react'
import { WarningIcon, LockIcon, SearchIcon, InboxIcon } from './icons'

// Reusable feedback / state screens (Tier 6). Themed, SVG icons, dual-theme.

export function EmptyState({ icon, title, message, action }: {
  icon?: ReactNode
  title: string
  message?: string
  action?: ReactNode
}) {
  return (
    <div className="state">
      <div className="state-icon">{icon ?? <InboxIcon size={40} />}</div>
      <div className="state-title">{title}</div>
      {message && <p className="state-msg">{message}</p>}
      {action && <div className="state-action">{action}</div>}
    </div>
  )
}

export function PermissionDenied({ message }: { message?: string }) {
  return (
    <EmptyState
      icon={<LockIcon size={40} />}
      title="Access denied"
      message={message ?? "You don't have permission to view this."}
    />
  )
}

export function NotFound({ what = 'item', message }: { what?: string; message?: string }) {
  return (
    <EmptyState
      icon={<SearchIcon size={40} />}
      title={`No ${what} found`}
      message={message ?? 'It may have been moved, renamed, or deleted.'}
    />
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <WarningIcon size={16} />
      <span className="error-banner-msg">{message}</span>
      {onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  )
}
