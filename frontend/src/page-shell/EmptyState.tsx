// EmptyState — the page-shell empty/coming-soon/error state primitive.
//
// Used in two places:
//  - Standalone, from any page that needs to render an empty state.
//  - Implicitly, by PageShell when `type='PLACEHOLDER'` and no children are
//    passed (the shell renders a default "Coming soon" EmptyState).
//
// This is a NEW primitive — it does NOT replace the existing
// `components/States.tsx` EmptyState. That one is used by every legacy view
// and stays untouched until pages migrate to PageShell.
import { Inbox } from 'lucide-react'
import type { EmptyStateProps } from './types'

export function EmptyState({
  icon,
  title,
  message,
  action,
  variant = 'default',
}: EmptyStateProps) {
  return (
    <div className="ps-empty" data-variant={variant}>
      <div className="ps-empty-icon">{icon ?? <Inbox size={28} />}</div>
      <div className="ps-empty-title">{title}</div>
      {message && <p className="ps-empty-msg">{message}</p>}
      {action && <div className="ps-empty-action">{action}</div>}
    </div>
  )
}
