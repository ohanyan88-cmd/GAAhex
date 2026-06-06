// PageHeader — Zone A.
//
// Breadcrumb · Icon · Title · Subtitle · optional Status summary chip.
// Always rendered by PageShell (every page has a header). The shape of this
// component matches the master spec: same spacing, same typography across
// every page in the product.
import type { ReactNode } from 'react'
import type { StatusSummary } from './types'

interface PageHeaderProps {
  breadcrumb?: string[]
  icon?: ReactNode
  title: string
  subtitle?: string
  statusSummary?: string | StatusSummary
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
}: PageHeaderProps) {
  return (
    <header className="ps-header">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="ps-breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((crumb, i) => (
            <span key={`${crumb}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)' }}>
              <span>{crumb}</span>
              {i < breadcrumb.length - 1 && (
                <span className="ps-breadcrumb-sep" aria-hidden>/</span>
              )}
            </span>
          ))}
        </nav>
      )}
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
    </header>
  )
}
