// PageHeader — Zone A.
//
// Breadcrumb · Icon · Title · Subtitle · optional Status summary chip.
// Always rendered by PageShell (every page has a header). The shape of this
// component matches the master spec: same spacing, same typography across
// every page in the product.
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  // breadcrumb + subtitle intentionally NOT rendered anymore (removed app-wide, Gev 2026-06-08).
  // Props stay on the interface so callers don't break; PageHeader just doesn't paint them.
  icon,
  title,
  statusSummary,
  pageTabs,
  primaryAction,
  secondaryActions,
  search,
}: PageHeaderProps) {
  const hasActions = !!primaryAction || (secondaryActions && secondaryActions.length > 0)
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (openMenu === null) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [openMenu])
  return (
    <header className="ps-header">
      <div className="ps-header-row">
        <div className="ps-header-main">
          {icon && (
            <span className="ps-header-icon" aria-hidden>
              {icon}
            </span>
          )}
          <div className="ps-header-titles">
            <h1 className="ps-header-title">{title}</h1>
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
              a.menu ? (
                <div
                  className="ps-header-menu-wrap"
                  key={`${a.label}-${i}`}
                  ref={openMenu === i ? menuRef : undefined}
                >
                  <Button variant="secondary" size="md" type="button"
                    onClick={() => setOpenMenu(openMenu === i ? null : i)}
                    disabled={a.disabled} aria-haspopup="menu" aria-expanded={openMenu === i}>
                    {a.icon}{a.label}
                  </Button>
                  {openMenu === i && (
                    <div className="ps-header-menu" role="menu">
                      {a.menu.map((mi, mj) => (
                        <button key={`${mi.label}-${mj}`} type="button" role="menuitem"
                          className="ps-header-menu-item"
                          onClick={() => { setOpenMenu(null); mi.onClick() }}>
                          {mi.icon}{mi.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Button variant="secondary" size="md" type="button"
                  key={`${a.label}-${i}`} onClick={a.onClick} disabled={a.disabled}>
                  {a.icon}{a.label}
                </Button>
              )
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
