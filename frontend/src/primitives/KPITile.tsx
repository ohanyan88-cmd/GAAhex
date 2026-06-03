// KPITile — THE shared KPI card primitive used across every dashboard, list, and
// module page in the Portal. One component, identical behavior everywhere.
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
      <div className="kpi-tile-label">
        {Icon && <Icon size={11} />}
        <span>{label}</span>
      </div>
      {loading ? (
        <>
          <div className="kpi-tile-skeleton" style={{ height: 28, width: '60%' }} />
          <div className="kpi-tile-skeleton" style={{ height: 12, width: '35%' }} />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className={valueCls}>{value}</span>
            {unit && <span className="kpi-tile-label" style={{ letterSpacing: 0, textTransform: 'none' }}>{unit}</span>}
          </div>
          {subtitle && <div className="kpi-tile-sub">{subtitle}</div>}
          <div className="kpi-tile-foot">
            {delta && (
              <div className={['kpi-tile-delta', deltaPositive ? 'up' : 'down'].join(' ')}>
                {deltaPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                <span>{delta}</span>
                <span style={{ color: 'var(--gx-text-3)' }}>vs 7d</span>
              </div>
            )}
            {accessory}
          </div>
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
