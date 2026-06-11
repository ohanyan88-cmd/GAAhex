import type { CSSProperties } from 'react'
import { humanizeStatus } from '../lib/humanize'

type Variant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
type Size = 'sm' | 'md'

interface StatusPillProps {
  variant: Variant
  label?: string
  size?: Size
  /** When set, the pill pads to this fixed min-width (px) and centers — used to give
   *  a whole status column uniform pills sized to the longest label in the group. */
  minWidth?: number
}

const variantMap: Record<Variant, { kit: string; label: string }> = {
  active:   { kit: 'pill-success', label: 'Active' },
  degraded: { kit: 'pill-warning', label: 'Degraded' },
  critical: { kit: 'pill-danger',  label: 'Critical' },
  neutral:  { kit: 'pill-neutral', label: 'Neutral' },
  info:     { kit: 'pill-info',    label: 'Info' },
}

export function StatusPill({ variant, label, size = 'md', minWidth }: StatusPillProps) {
  const v = variantMap[variant]
  // `pill-uniform` is ALWAYS on: every status pill in the project gets the same width from the
  // single `--gx-pill-min-w` token (project-wide, not hardcoded per call site). `minWidth` is an
  // optional per-instance override. The label is ALWAYS humanized — raw enum keys
  // (`contract_signed`) never reach the UI; they render as "Contract Signed" everywhere.
  const cls = ['pill', v.kit, size === 'sm' ? 'pill-sm' : '', 'pill-uniform'].filter(Boolean).join(' ')
  const style = minWidth ? ({ '--gx-pill-min': `${minWidth}px` } as CSSProperties) : undefined
  return (
    <span className={cls} style={style}>
      <span className="d" style={{ background: 'currentColor' }} />
      {label != null ? humanizeStatus(label) : v.label}
    </span>
  )
}
