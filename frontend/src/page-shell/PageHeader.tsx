// PageHeader — Zone A.
//
// EN: Icon · Title · Description · Status chip · Tabs · Search.
//     Actions (primary + secondary) moved to gx-CommandBar (Zone C).
// HY: Icon · Title · Description · Status chip · Tabs · Search:
//     Actions-ы (primary + secondary) teɡhafoxvec gx-CommandBar-i (Zone C):
import { type ReactNode } from 'react'
import { Input } from '../primitives'
import type { StatusSummary } from './types'

interface PageHeaderProps {
  breadcrumb?: string[]
  icon?: ReactNode
  title: string
  subtitle?: string
  description?: ReactNode
  statusSummary?: string | StatusSummary
  pageTabs?: ReactNode
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
  // breadcrumb + subtitle intentionally NOT rendered anymore (removed app-wide, Gev 2026-06-08).
  // Props stay on the interface so callers don't break; PageHeader just doesn't paint them.
  icon,
  title,
  description,
  statusSummary,
  pageTabs,
  search,
}: PageHeaderProps) {
  return (
    <header className="ps-header">
      <div
        className={['ps-header-row', pageTabs ? 'ps-header-row--tabbed' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <div className="ps-header-main">
          {icon && (
            <span className="ps-header-icon" aria-hidden>
              {icon}
            </span>
          )}
          <div className="ps-header-titles">
            <h1 className="ps-header-title">{title}</h1>
            {description && <div className="ps-header-desc">{description}</div>}
            {statusSummary && (
              <div className="ps-header-status">
                <StatusChip summary={statusSummary} />
              </div>
            )}
          </div>
        </div>
        {pageTabs && <div className="ps-header-tabs">{pageTabs}</div>}
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
      </div>
    </header>
  )
}
