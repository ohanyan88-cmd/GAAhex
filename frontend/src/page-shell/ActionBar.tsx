// ActionBar — Zone C.
//
// Layout (left → right):
//   [view switcher chips]  ──── (secondary actions) ──── [primary action]
//
// Rendered only when at least one of `views`, `primaryAction`, or
// `secondaryActions` is present. Hidden by PageShell when type === 'PLACEHOLDER'.
import type { PrimaryAction, SecondaryAction, ViewSwitcher, ViewKind } from './types'

interface ActionBarProps {
  views?: ViewSwitcher
  primaryAction?: PrimaryAction
  secondaryActions?: SecondaryAction[]
}

const VIEW_LABEL: Record<ViewKind, string> = {
  table: 'Table',
  board: 'Board',
  calendar: 'Calendar',
  map: 'Map',
  timeline: 'Timeline',
  gallery: 'Gallery',
}

export function ActionBar({ views, primaryAction, secondaryActions }: ActionBarProps) {
  const hasContent =
    !!views || !!primaryAction || (secondaryActions && secondaryActions.length > 0)
  if (!hasContent) return null

  return (
    <div className="ps-actions">
      {views && views.options.length > 0 && (
        <div className="ps-views" role="tablist" aria-label="View">
          {views.options.map((v) => (
            <button
              key={v}
              type="button"
              className="ps-view-chip"
              aria-pressed={views.current === v}
              onClick={() => views.onChange?.(v)}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      )}
      <div className="ps-actions-spacer" />
      {secondaryActions && secondaryActions.length > 0 && (
        <div className="ps-actions-secondaries">
          {secondaryActions.map((a, i) => (
            <button
              key={`${a.label}-${i}`}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={a.onClick}
              disabled={a.disabled}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
      {primaryAction && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled || primaryAction.loading}
        >
          {primaryAction.icon}
          {primaryAction.label}
        </button>
      )}
    </div>
  )
}
