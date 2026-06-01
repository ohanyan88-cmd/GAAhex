// FilterBar — Zone D.
//
// Layout (left → right):
//   [search]  [quick filter dropdowns…]  ─── [advanced toggle]  [saved views]
//
// Search always renders first. Quick filters and saved views are rendered
// only when supplied. The advanced filter is rendered behind a popover toggle
// — when the page provides an `advanced` ReactNode, we expose the toggle and
// reveal the node when clicked.
import { useEffect, useRef, useState } from 'react'
import { Filter, ChevronDown, Bookmark } from 'lucide-react'
import { Input } from '../primitives'
import type { FiltersSpec } from './types'

interface FilterBarProps {
  filters: FiltersSpec
}

export function FilterBar({ filters }: FilterBarProps) {
  const [advOpen, setAdvOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const advRef = useRef<HTMLDivElement>(null)
  const savedRef = useRef<HTMLDivElement>(null)

  // Close popovers on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (advRef.current && !advRef.current.contains(t)) setAdvOpen(false)
      if (savedRef.current && !savedRef.current.contains(t)) setSavedOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const hasContent =
    !!filters.search ||
    (filters.quick && filters.quick.length > 0) ||
    !!filters.advanced ||
    (filters.savedViews && filters.savedViews.length > 0)
  if (!hasContent) return null

  return (
    <div className="ps-filters">
      {filters.search && (
        <div className="ps-filter-search">
          <Input
            variant="search"
            size="sm"
            value={filters.search.value}
            onChange={(e) => filters.search!.onChange(e.target.value)}
            placeholder={filters.search.placeholder ?? 'Search…'}
          />
        </div>
      )}
      {filters.quick && filters.quick.length > 0 && (
        <div className="ps-filter-quicks">
          {filters.quick.map((q, i) => (
            <select
              key={`${q.label}-${i}`}
              className="inp inp-sm"
              value={q.value}
              onChange={(e) => q.onChange(e.target.value)}
              aria-label={q.label}
              style={{ width: 'auto', minWidth: 120 }}
            >
              {q.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {q.label}: {o.label}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}
      <div className="ps-filter-tail">
        {filters.advanced && (
          <div className="ps-filter-advanced-wrap" ref={advRef}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setAdvOpen((v) => !v)}
              aria-expanded={advOpen}
            >
              <Filter size={12} />
              Advanced
            </button>
            {advOpen && (
              <div className="ps-filter-advanced-pop" role="dialog" aria-label="Advanced filters">
                {filters.advanced}
              </div>
            )}
          </div>
        )}
        {filters.savedViews && filters.savedViews.length > 0 && (
          <div className="ps-saved-views-wrap" ref={savedRef}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSavedOpen((v) => !v)}
              aria-expanded={savedOpen}
            >
              <Bookmark size={12} />
              Saved views
              <ChevronDown size={12} />
            </button>
            {savedOpen && (
              <div className="ps-saved-views-pop" role="menu">
                {filters.savedViews.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="ps-saved-view-item"
                    role="menuitem"
                    onClick={() => {
                      filters.onSelectSavedView?.(v.id)
                      setSavedOpen(false)
                    }}
                  >
                    <span>{v.name}</span>
                    {v.isDefault && <span className="ps-saved-view-default">default</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
