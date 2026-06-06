// KPITile — THE shared KPI card primitive used across every dashboard, list, and
// module page in GAAhex. One component, identical behavior everywhere.
//
// Spec (Gev 2026-05-31):
//  - Hover lift on clickable tiles: shadow-md + translateY(-1px) + border-strong,
//    transitioned over var(--gx-dur-base). Plain tiles (no onClick / href) have
//    no hover lift, default cursor, no focus ring — we don't fake destinations.
//  - Click navigates to the real source list filtered to the metric (e.g. "Open
//    tickets" → tickets filtered to OPEN). Caller wires `onClick`/`href`. If the
//    metric has no real drill-through, omit both — the tile becomes a plain div.
//  - Focus-visible: 2px azure ring on clickable tiles (keyboard accessible).
//  - All tiles use the SAME visual treatment per the KPI Tile Standard (D17).
//    There is no "premium / headline" highlight — colored value text
//    (danger/warning/muted) carries state on its own. On hover, supply
//    `tooltip` to show a small 1–2-sentence "story" popover above the tile.
//  - Hide-if-missing is a CALLER concern: if the underlying fetch failed or there
//    is no value yet, the caller should not render the tile at all. A real fetched
//    0 still renders. The component shows a skeleton when `loading` is true.
//
// Backward-compat: the old prop signature (label, value, unit, delta, deltaPositive,
// icon, accessory, size, loading, error) still works. New props are additive.
import React from 'react'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

/** Any icon component that accepts `size` — covers lucide icons + our wrapped icons.
   Loose by design so both `LucideIcon` (size: number | string) and our SVG wrappers
   (size: number) pass without a cast at every call site. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = React.ComponentType<any>

type Size = 'sm' | 'md' | 'lg'

interface KPITileProps {
  label: string
  value?: string | number
  unit?: string
  delta?: string
  deltaPositive?: boolean
  /** Baseline label shown after the delta (default "vs 7d"). e.g. "WoW". */
  deltaBase?: string
  /** Small note pinned to the card's top-right corner (e.g. a date range). */
  cornerNote?: React.ReactNode
  /** Optional 0–100 progress/utilisation ratio → thin bar at the card bottom. */
  progress?: number
  /** Progress bar accent. */
  progressVariant?: 'neutral' | 'gold' | 'success' | 'danger'
  /** Small label rendered inline at the end of the progress bar (e.g. "23%"). */
  progressLabel?: React.ReactNode
  /** Optional mini-chart (e.g. a sparkline) rendered in the card's bottom group,
   *  where the progress bar would otherwise sit. */
  chart?: React.ReactNode
  /** Optional sub-line under the value (e.g. "5 active"). Mirrors `.kpi-sub`. */
  subtitle?: React.ReactNode
  icon?: IconComponent
  accessory?: React.ReactNode
  size?: Size
  loading?: boolean
  error?: string
  /** When defined, the tile renders as a <button>, gets pointer cursor, focus ring. */
  onClick?: () => void
  /** Alternative to onClick for cross-page navigation. Renders as an <a>. Use ONE, not both. */
  href?: string
  /** Danger accent — value text in danger color (e.g. overdue). */
  danger?: boolean
  /** Warning accent — value text in warning color (e.g. suspended). */
  warning?: boolean
  /** Muted accent — value text in muted color (e.g. cancelled / closed). */
  muted?: boolean
  /** Optional aria-label override (e.g. "Open tickets — 12. Click to filter to OPEN.") */
  ariaLabel?: string
  /** Hover-revealed info popover — second half of the KPI Tile Standard (D17).
   *  One-or-two-sentence "story" of what the metric means + (if clickable)
   *  what clicking it does. Plain text or rich ReactNode. */
  tooltip?: React.ReactNode
}

export function KPITile({
  label,
  value,
  unit,
  delta,
  deltaPositive,
  deltaBase = 'vs 7d',
  cornerNote,
  progress,
  progressVariant = 'neutral',
  progressLabel,
  chart,
  subtitle,
  icon: Icon,
  accessory,
  size = 'md',
  loading,
  error,
  onClick,
  href,
  danger,
  warning,
  muted,
  ariaLabel,
  tooltip,
}: KPITileProps) {
  const clickable = !!(onClick || href) && !loading && !error
  const tileCls = [
    'kpi-tile',
    error ? 'error' : '',
  ].filter(Boolean).join(' ')
  const valueCls = [
    'kpi-tile-value',
    size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '',
    danger ? 'danger' : '',
    warning ? 'warning' : '',
    muted ? 'muted' : '',
  ].filter(Boolean).join(' ')

  const inner = (
    <>
      {tooltip && (
        <div className="kpi-tile-tooltip" role="tooltip">
          {tooltip}
        </div>
      )}
      <div className="kpi-tile-head">
        <div className="kpi-tile-label">
          {Icon && <Icon size={11} />}
          <span>{label}</span>
        </div>
        {cornerNote && <span className="kpi-tile-corner">{cornerNote}</span>}
      </div>
      {loading ? (
        <>
          <div className="kpi-tile-skeleton" style={{ height: 28, width: '60%' }} />
          <div className="kpi-tile-skeleton" style={{ height: 12, width: '35%' }} />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--gx-space-3)' }}>
            <span className={valueCls}>{value}</span>
            {unit && <span className="kpi-tile-label" style={{ letterSpacing: 0, textTransform: 'none' }}>{unit}</span>}
          </div>
          {subtitle && <div className="kpi-tile-sub">{subtitle}</div>}
          {/* Bottom group pins to the card floor (token gap). Holds the optional
              progress/utilisation bar and the delta/trend row. Rendered only when
              there's something to show, so plain tiles stay clean. All sizing/colour
              comes from tokens + CSS — the only inline value is the live percentage. */}
          {(delta || accessory || progress != null || chart) && (
            <div className="kpi-tile-bottom">
              {chart && <div className="kpi-tile-chart">{chart}</div>}
              {progress != null && (
                <div className="kpi-tile-progress">
                  <span
                    className="kpi-tile-bar"
                    data-variant={progressVariant}
                    style={{ '--gx-kpi-pct': `${Math.max(0, Math.min(100, progress))}%` } as React.CSSProperties}
                  >
                    <i />
                  </span>
                  {progressLabel != null && (
                    <span className="kpi-tile-pct">{progressLabel}</span>
                  )}
                </div>
              )}
              {(delta || accessory) && (
                <div className="kpi-tile-foot">
                  {delta && (
                    <div className={['kpi-tile-delta', deltaPositive ? 'up' : 'down'].join(' ')}>
                      {deltaPositive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                      <span>{delta}</span>
                      <span className="kpi-tile-delta-base">{deltaBase}</span>
                    </div>
                  )}
                  {accessory}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  )

  const dataAttrs = {
    'data-clickable': clickable ? 'true' : undefined,
  }

  if (clickable && href) {
    return (
      <a
        className={tileCls}
        href={href}
        aria-label={ariaLabel}
        {...dataAttrs}
      >
        {inner}
      </a>
    )
  }
  if (clickable && onClick) {
    return (
      <button
        type="button"
        className={tileCls}
        onClick={onClick}
        aria-label={ariaLabel}
        {...dataAttrs}
      >
        {inner}
      </button>
    )
  }
  return (
    <div className={tileCls} {...dataAttrs}>
      {inner}
    </div>
  )
}
