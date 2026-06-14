import type { ReactNode } from 'react'
import { WarningIcon, LockIcon, SearchIcon, InboxIcon, SpinnerIcon } from './icons'
import { Button } from '../primitives'  // T-P3-7 — canonical button primitive
import { EmptyState as PageShellEmptyState } from '../page-shell/EmptyState'  // T-P2-6
import { t } from '../lib/i18n'

// Reusable feedback / state screens (Tier 6). Themed, SVG icons, dual-theme.

export function LoadingState({ message }: { message?: string } = {}) {
  // Routed through the canonical .ps-empty surface (the legacy `.state` CSS was never defined).
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
      <PageShellEmptyState icon={<SpinnerIcon size={36} />} title={message ?? t('common.loading', 'Loading…')} />
    </div>
  )
}

// Skeleton shimmer — for list-level loading. Renders N placeholder rows that
// animate a muted shimmer until real data arrives. Fully disabled under
// prefers-reduced-motion (the animation collapses to near-0 via the global rule
// in styles.css). Prefer this over LoadingState on second-tier loads (inside a
// view that already has a heading) so the page layout is stable.
export function SkeletonRows({ rows = 5, label }: { rows?: number; label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? t('common.loading', 'Loading…')}
      aria-busy="true"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ marginBottom: 'var(--gx-space-4)' }}>
          <div className="skel skel-row" />
          {i % 2 === 0 && <div className="skel skel-row" style={{ marginTop: 'var(--gx-space-2)' }} />}
        </div>
      ))}
    </div>
  )
}

// T-P2-6 — `EmptyState` now delegates to the canonical `page-shell/EmptyState`.
// The legacy `.state` CSS class wasn't even defined (silent-styling bug), so
// this delegation fixes 50+ legacy view empty states by giving them the
// page-shell's `.ps-empty` styling. The fallback InboxIcon stays here for
// callers that don't supply an icon (matches the prior behavior).
export function EmptyState({ icon, title, message, action }: {
  icon?: ReactNode
  title: string
  message?: string
  action?: ReactNode
}) {
  return (
    <PageShellEmptyState
      icon={icon ?? <InboxIcon size={40} />}
      title={title}
      message={message}
      action={action}
    />
  )
}

export function PermissionDenied({ message, what, onBack }: { message?: string; what?: string; onBack?: () => void }) {
  return (
    <EmptyState
      icon={<LockIcon size={40} />}
      title={t('noaccess.title', "You don't have access to this")}
      message={
        message ??
        (what
          ? t('noaccess.msgSpecific', `You don't have permission to view ${what}.`).replace('{what}', what)
          : t('noaccess.msg', "You don't have permission to view this resource. Contact your administrator if you need access."))
      }
      action={onBack ? <Button variant="primary" size="md" onClick={onBack}>{t('noaccess.back', 'Back to dashboard')}</Button> : undefined}
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
      {onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  )
}
