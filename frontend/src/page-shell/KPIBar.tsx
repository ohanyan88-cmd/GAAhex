// KPIBar — Zone B.
//
// 3–5 compact KPI tiles. Reuses the existing KPITile primitive so the visual
// language is identical to what already ships in ProductsView and dashboards.
// Hidden by PageShell when:
//   - kpis prop is missing or empty
//   - type === 'PLACEHOLDER'
import { KPITile } from '../primitives'
import type { KPISpec } from './types'

interface KPIBarProps {
  kpis: KPISpec[]
}

export function KPIBar({ kpis }: KPIBarProps) {
  if (!kpis || kpis.length === 0) return null
  // Clamp to 5 — beyond 5 the row becomes visually overcrowded.
  const visible = kpis.slice(0, 5)
  return (
    <div className="ps-kpis" data-count={String(visible.length)}>
      {visible.map((k, i) => (
        <KPITile
          key={`${k.label}-${i}`}
          label={k.label}
          value={k.value}
          unit={k.unit}
          delta={k.delta}
          deltaPositive={k.deltaPositive}
          subtitle={k.subtitle}
          onClick={k.onClick}
          premium={k.premium}
          danger={k.danger}
          warning={k.warning}
          muted={k.muted}
          loading={k.loading}
          size="sm"
        />
      ))}
    </div>
  )
}
