// T-P2-2 — <Pagination>.
//
// 16 PageShell views render the same table footer:
//
//   <div className="table-foot">
//     <span className="hint">Showing 1–25 of 87</span>
//     <span className="spacer" />
//     <div style={{ display: 'flex', gap: 4 }}>
//       <button .btn.btn-ghost.btn-sm.btn-icon disabled={page<=1}>‹</button>
//       {Array.from({length: pageCount}, (_, i) => i+1).slice(0,5).map(p =>
//         <button ...>{p}</button>)}
//       <button .btn.btn-ghost.btn-sm.btn-icon disabled={page>=last}>›</button>
//     </div>
//   </div>
//
// This primitive collapses that markup. The numeric range never shows more than
// `maxNumbers` (default 5) buttons; if `pageCount` exceeds that, the slice
// scrolls so the active page stays in view. Edge-case page counts (0 or 1)
// hide the numeric/arrow row but keep the count summary so the table doesn't
// shift when results drop.
//
// Accessibility: the whole row is wrapped in a `role="navigation"` landmark
// with an aria-label, and the number buttons get `aria-current="page"` when
// active. Disabled arrows are real `disabled` attributes (not styled blocks)
// so keyboard tabbing skips them.
import type { CSSProperties } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export type PaginationProps = {
  page: number
  pageCount: number
  pageSize: number
  total: number
  onChange: (next: number) => void
  /** How many numbered buttons to render. Default 5. */
  maxNumbers?: number
  /** Override the "Showing X–Y of Z" line (e.g. for an i18n string). */
  summary?: string
  /** Aria-label for the nav landmark (i18n). Default "Page navigation". */
  ariaLabel?: string
  /** Optional extra style override on the outer row. */
  style?: CSSProperties
}

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  onChange,
  maxNumbers = 5,
  summary,
  ariaLabel = 'Page navigation',
  style,
}: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const summaryText = summary ?? (total === 0 ? '0 records' : `Showing ${from}–${to} of ${total}`)

  // Compute the window of numbered buttons. The active page should remain
  // visible when pageCount > maxNumbers; we anchor the window so it slides.
  const numbers: number[] = []
  if (pageCount > 0) {
    const half = Math.floor(maxNumbers / 2)
    let start = Math.max(1, page - half)
    let end = Math.min(pageCount, start + maxNumbers - 1)
    start = Math.max(1, end - maxNumbers + 1)
    for (let p = start; p <= end; p++) numbers.push(p)
  }

  return (
    <div className="table-foot" role="navigation" aria-label={ariaLabel} style={style}>
      <span className="hint">{summaryText}</span>
      <span className="spacer" />
      {pageCount > 1 && (
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            disabled={page <= 1}
            onClick={() => onChange(Math.max(1, page - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </button>
          {numbers.map((p) => (
            <button
              key={p}
              type="button"
              className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')}
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Page ${p}`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            disabled={page >= pageCount}
            onClick={() => onChange(Math.min(pageCount, page + 1))}
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

export default Pagination
