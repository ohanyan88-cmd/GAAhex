// PageHeader — Zone A.
//
// Breadcrumb · Icon · Title · Subtitle · optional Status summary chip.
// Always rendered by PageShell (every page has a header). The shape of this
// component matches the master spec: same spacing, same typography across
// every page in the product.
import type { ReactNode } from 'react'
import { Button, Input } from '../primitives'
import type { StatusSummary, PrimaryAction, SecondaryAction } from './types'

interface PageHeaderProps {
  breadcrumb?: string[]
  icon?: ReactNode
  title: string
  subtitle?: string
  statusSummary?: string | StatusSummary
  pageTabs?: ReactNode
  primaryAction?: PrimaryAction
  secondaryActions?: SecondaryAction[]
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
}

function StatusChip({ summary }: { summary: string | StatusSummary }) {
  const norm: StatusSummary =
    typeof summary === 'string' ? { label: summary, variant: 'neutral' } : summary
  const variant = norm.variant ?? 'neutral'
  return (
    <span className="ps-status-chip" data-variant={variant}>
      <span className="ps-status-chip-dot" aria-hidden />
      {norm.label}
    </span>
  )
}

export function PageHeader({
  breadcrumb,
  icon,
  title,
  subtitle,
  statusSummary,
  pageTabs,
  primaryAction,
  secondaryActions,
  search,
}: PageHeaderProps) {
  const hasActions = !!primaryAction || (secondaryActions && secondaryActions.length > 0)
  return (
    <header className="ps-header">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="ps-breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((crumb, i) => (
            <span key={`${crumb}-${i}`} className="ps-breadcrumb-crumb">
              <span>{crumb}</span>
              {i < breadcrumb.length - 1 && (
                <span className="ps-breadcrumb-sep" aria-hidden>/</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="ps-header-row">
        <div className="ps-header-main">
          {icon && (
            <span className="ps-header-icon" aria-hidden>
              {icon}
            </span>
          )}
          <div className="ps-header-titles">
            <h1 className="ps-header-title">{title}</h1>
            {subtitle && <p className="ps-header-subtitle">{subtitle}</p>}
            {statusSummary && (
              <div className="ps-header-status">
                <StatusChip summary={statusSummary} />
              </div>
            )}
          </div>
        </div>
        {search && (
          <div className="ps-header-search">
            <Input
              variant="search"
              size="md"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? 'Search…'}
            />
          </div>
        )}
        {hasActions && (
          <div className="ps-header-actions">
            {secondaryActions?.map((a, i) => (
              <Button variant="secondary" size="md" type="button"
                key={`${a.label}-${i}`} onClick={a.onClick} disabled={a.disabled}>
                {a.icon}{a.label}
              </Button>
            ))}
            {primaryAction && (
              <Button variant="primary" size="md" type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled || primaryAction.loading}>
                {primaryAction.icon}{primaryAction.label}
              </Button>
            )}
          </div>
        )}
      </div>
      {pageTabs && (
        <div className="ps-header-tabs">{pageTabs}</div>
      )}
    </header>
  )
}
