// KPIBar — Zone B.
//
// 3–5 compact KPI tiles. Reuses the existing KPITile primitive so the visual
// language is identical to what already ships in the dashboards and registry views.
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
  // Standard 10 (Gev 2026-06-14): EVERY page's KPI strip is exactly 4 cards. Cap at 4; pad short
  // pages with placeholder slots so the structure is identical app-wide.
  const visible = kpis.slice(0, 4)
  const pad = Math.max(0, 4 - visible.length)
  return (
    <div className="ps-kpis" data-count="4">
      {visible.map((k, i) => (
        <KPITile
          key={`${k.label}-${i}`}
          label={k.label}
          value={k.value}
          unit={k.unit}
          delta={k.delta}
          deltaPositive={k.deltaPositive}
          deltaBase={k.deltaBase}
          cornerNote={k.cornerNote}
          progress={k.progress}
          progressVariant={k.progressVariant}
          progressLabel={k.progressLabel}
          chart={k.chart}
          subtitle={k.subtitle}
          danger={k.danger}
          warning={k.warning}
          muted={k.muted}
          loading={k.loading}
          tooltip={k.tooltip}
          size="sm"
        />
      ))}
      {Array.from({ length: pad }).map((_, i) => (
        <div key={`ph-${i}`} className="ps-kpi-ph" aria-hidden="true" />
      ))}
    </div>
  )
}
