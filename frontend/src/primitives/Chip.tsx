import type { ReactNode } from 'react'

// Chip — a compact, UPPERCASE status token driven entirely by SEMANTIC tokens
// (standard §2/§4: status colours only, never decoration). Distinct from StatusPill
// (entity status pill with a dot + project-wide uniform width); Chip is the small
// inline tag used in tables, headers, and alert rows.

export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

interface ChipProps {
  tone?: ChipTone
  children: ReactNode
  icon?: ReactNode
}

export function Chip({ tone = 'neutral', children, icon }: ChipProps) {
  return (
    <span className={`gx-chip gx-chip-${tone}`}>
      {icon}
      <span className="gx-chip-label">{children}</span>
    </span>
  )
}
