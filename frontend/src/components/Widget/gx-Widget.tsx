// gx-Widget — base card chrome for workspace widgets.
// EN: One source for every boxed workspace widget: header row (icon · title · count · refresh · link)
//     + the four data states (ok · loading · error · empty). Leaf widgets put their content in
//     `children` and let gx-Widget own the chrome, so every card reads identically (§4 one-source).
//     Title is passed pre-translated by the caller (t(...)); micro-label is UPPERCASE per §2.
// HY: Բոլոր boxed workspace widget-երի մեկ source chrome-ը՝ header row (icon · title · count · refresh ·
//     link) + չորս data state (ok · loading · error · empty)։ Leaf widget-ները `children`-ում են դնում
//     բովանդակությունը, chrome-ը պատկանում է gx-Widget-ին, որ ամեն card նույնը կարդացվի (§4)։
//     Title-ը caller-ը փոխանցում է արդեն թարգմանված (t(...)); micro-label-ը UPPERCASE է ըստ §2-ի։
import type { ReactNode } from 'react'
import { RefreshCw, ArrowUpRight } from 'lucide-react'
import { t } from '../../lib/i18n'

export type GxWidgetState = 'ok' | 'loading' | 'error' | 'empty'

export interface GxWidgetProps {
  /** Pre-translated title (caller wraps with t()). */
  title: ReactNode
  icon?: ReactNode
  count?: number
  state?: GxWidgetState
  errorMessage?: string
  emptyMessage?: string
  onRetry?: () => void
  onRefresh?: () => void
  /** Optional "see all" affordance in the header. */
  linkLabel?: string
  onLink?: () => void
  /** 'full' spans both working-zone columns. */
  span?: 'full'
  className?: string
  children: ReactNode
}

export function GxWidget({
  title,
  icon,
  count,
  state = 'ok',
  errorMessage,
  emptyMessage,
  onRetry,
  onRefresh,
  linkLabel,
  onLink,
  span,
  className,
  children,
}: GxWidgetProps) {
  const cls = ['gx-widget', span === 'full' ? 'gx-widget-full' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <section className={cls}>
      <div className="gx-widget-head">
        {icon && (
          <span className="gx-widget-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <h3 className="gx-widget-title">{title}</h3>
        {count !== undefined && <span className="gx-widget-count">{count}</span>}
        <span className="gx-widget-head-spacer" />
        {onRefresh && (
          <button
            type="button"
            className="gx-widget-btn"
            onClick={onRefresh}
            aria-label={t('ws.widget.refresh', 'Refresh')}
          >
            <RefreshCw size={14} />
          </button>
        )}
        {linkLabel && onLink && (
          <button type="button" className="gx-widget-link" onClick={onLink}>
            {linkLabel}
            <ArrowUpRight size={13} />
          </button>
        )}
      </div>
      <div className="gx-widget-body">
        {state === 'loading' && (
          <div className="gx-widget-skel" aria-busy="true" aria-live="polite">
            {[0, 1, 2].map((i) => (
              <div key={i} className="gx-widget-skel-row" />
            ))}
          </div>
        )}
        {state === 'error' && (
          <div className="gx-widget-state gx-widget-state-error" role="alert">
            <span>{errorMessage ?? t('ws.widget.error', 'Couldn’t load this.')}</span>
            {onRetry && (
              <button type="button" className="gx-widget-retry" onClick={onRetry}>
                {t('ws.widget.retry', 'Retry')}
              </button>
            )}
          </div>
        )}
        {state === 'empty' && (
          <div className="gx-widget-state gx-widget-state-empty">
            {emptyMessage ?? t('ws.widget.empty', 'Nothing here yet.')}
          </div>
        )}
        {state === 'ok' && children}
      </div>
    </section>
  )
}
