import { useMemo, useState } from 'react'
import type { CustomFieldDef } from '../../../lib/pageConfig'
import type { OrgTreeNode, CFApi } from '../types'
import { descendantCount, flattenTree, type FlatRow } from '../utils'

type HeatMetric = 'descendants' | 'headcount'

function mixHex(from: string, to: string, t: number): string {
  const f = parseInt(from.slice(1), 16)
  const g = parseInt(to.slice(1), 16)
  const fr = (f >> 16) & 255, fg = (f >> 8) & 255, fb = f & 255
  const gr = (g >> 16) & 255, gg = (g >> 8) & 255, gb = g & 255
  const r = Math.round(fr + (gr - fr) * t)
  const gn = Math.round(fg + (gg - fg) * t)
  const b = Math.round(fb + (gb - fb) * t)
  return `#${((1 << 24) + (r << 16) + (gn << 8) + b).toString(16).slice(1)}`
}

function hasHeadcountField(defs: CustomFieldDef[]): boolean {
  return defs.some((d) => d.type === 'number' && (d.key.toLowerCase() === 'headcount' || d.label.trim().toLowerCase() === 'headcount'))
}

export function HeatmapLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const offerHeadcount = useMemo(() => hasHeadcountField(defs), [defs])
  const [metric, setMetric] = useState<HeatMetric>('descendants')
  const effMetric: HeatMetric = metric === 'headcount' && offerHeadcount ? 'headcount' : 'descendants'

  const flat = useMemo(() => flattenTree(roots), [roots])

  const valueOf = (n: OrgTreeNode): number => {
    if (effMetric === 'headcount') {
      const raw = cf.value(n.id, 'headcount')
      const v = raw != null && raw !== '' ? Number(raw) : NaN
      return Number.isFinite(v) ? v : 0
    }
    return descendantCount(n)
  }

  const rowsByDepth = useMemo(() => {
    const map = new Map<number, FlatRow[]>()
    for (const f of flat) {
      const arr = map.get(f.depth) ?? []
      arr.push(f)
      map.set(f.depth, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [flat])

  const max = useMemo(() => flat.reduce((m, f) => Math.max(m, valueOf(f.node)), 0), [flat, effMetric, cf])

  if (flat.length === 0) {
    return <div className="org-empty muted">No organization nodes to map.</div>
  }

  // Sequential ramp: faint surface-2 (low) → brand gold (high).
  const LOW = '#182943'  // --gx-surface-2 (dark)
  const HIGH = '#C5A059' // --gx-gold (dark)
  const tint = (v: number): string => (max <= 0 ? LOW : mixHex(LOW, HIGH, Math.min(1, v / max)))
  const metricLabel = effMetric === 'headcount' ? 'Headcount' : 'Descendants'

  return (
    <div className="org-heatmap">
      <div className="org-heatmap-toolbar">
        <span className="org-heatmap-metric-label">Metric:</span>
        <div className="org-heatmap-toggle" role="group" aria-label="Heatmap metric">
          <button
            type="button"
            className={`org-heatmap-toggle-btn${effMetric === 'descendants' ? ' on' : ''}`}
            onClick={() => setMetric('descendants')}
          >Descendants</button>
          {offerHeadcount && (
            <button
              type="button"
              className={`org-heatmap-toggle-btn${effMetric === 'headcount' ? ' on' : ''}`}
              onClick={() => setMetric('headcount')}
            >Headcount</button>
          )}
        </div>
      </div>

      <div className="org-heatmap-grid">
        {rowsByDepth.map(([depth, items]) => (
          <div key={depth} className="org-heatmap-row">
            <span className="org-heatmap-rowlabel">Layer {depth + 1}</span>
            <div className="org-heatmap-cells">
              {items.map((f) => {
                const v = valueOf(f.node)
                const lit = max > 0 && v / max > 0.45
                return (
                  <div
                    key={f.node.id}
                    className="org-heatmap-cell"
                    style={{ background: tint(v), color: lit ? 'var(--gx-bg)' : 'var(--gx-text-2)' }}
                    title={`${f.node.name} — ${f.node.type} · ${metricLabel} ${v}`}
                  >
                    <span className="org-heatmap-cell-name">{f.node.name}</span>
                    <span className="org-heatmap-cell-val">{v}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="org-heatmap-legend">
        <span className="org-heatmap-legend-label">{metricLabel}</span>
        <span className="org-heatmap-legend-min muted">0</span>
        <span className="org-heatmap-legend-ramp" style={{ background: `linear-gradient(90deg, ${LOW}, ${HIGH})` }} aria-hidden="true" />
        <span className="org-heatmap-legend-max muted">{max}</span>
      </div>
    </div>
  )
}
