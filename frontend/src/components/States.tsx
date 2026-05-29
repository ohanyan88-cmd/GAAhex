import type { ReactNode } from 'react'
import { WarningIcon, LockIcon, SearchIcon, InboxIcon, SpinnerIcon } from './icons'
import { t } from '../lib/i18n'

// Reusable feedback / state screens (Tier 6). Themed, SVG icons, dual-theme.

export function LoadingState({ message }: { message?: string } = {}) {
  return (
    <div className="state" role="status" aria-live="polite" aria-label={t('common.loading', 'Loading…')}>
      <div className="state-icon">
        <SpinnerIcon size={36} />
      </div>
      <div className="state-title">{message ?? t('common.loading', 'Loading…')}</div>
    </div>
  )
}

// Skeleton shimmer — for list-level loading. Renders N placeholder rows that
// animate a muted shimmer until real data arrives. Fully disabled under
// prefers-reduced-motion (the animation collapses to near-0 via the global rule
// in styles.css). Prefer this over LoadingState on second-tier loads (inside a
// view that already has a heading) so the page layout is stable.
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('common.loading', 'Loading…')}
      aria-busy="true"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div className="skeleton skeleton-row" />
          {i % 2 === 0 && <div className="skeleton skeleton-row-sm" style={{ marginTop: 4 }} />}
        </div>
      ))}
    </div>
  )
}

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
