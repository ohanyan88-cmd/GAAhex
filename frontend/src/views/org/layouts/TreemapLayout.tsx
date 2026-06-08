import { useMemo } from 'react'
import type { OrgTreeNode, CFApi } from '../types'
import { descendantCount, typeFill } from '../utils'

function metricFor(node: OrgTreeNode, cf: CFApi): number {
  const raw = cf.value(node.id, 'headcount')
  if (raw != null && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  return descendantCount(node) + 1
}

function collectLeaves(roots: OrgTreeNode[]): OrgTreeNode[] {
  const out: OrgTreeNode[] = []
  const walk = (nodes: OrgTreeNode[]) => {
    for (const n of nodes) {
      if (n.children.length === 0) out.push(n)
      else walk(n.children)
    }
  }
  walk(roots)
  return out
}

type TmRect = { node: OrgTreeNode; metric: number; x: number; y: number; w: number; h: number }
type TmRow = { x: number; y: number; w: number; h: number }

function squarify(
  items: { node: OrgTreeNode; metric: number }[],
  x: number, y: number, w: number, h: number,
): TmRect[] {
  const out: TmRect[] = []
  const totalArea = w * h
  const totalMetric = items.reduce((s, it) => s + it.metric, 0)
  if (totalMetric <= 0 || totalArea <= 0) return out
  const scaled = items.map((it) => ({ node: it.node, metric: it.metric, area: (it.metric / totalMetric) * totalArea }))

  const worst = (row: { area: number }[], side: number): number => {
    const sum = row.reduce((s, r) => s + r.area, 0)
    const max = Math.max(...row.map((r) => r.area))
    const min = Math.min(...row.map((r) => r.area))
    const s2 = side * side
    const sum2 = sum * sum
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min))
  }

  let rect: TmRow = { x, y, w, h }
  let i = 0
  while (i < scaled.length) {
    const side = Math.min(rect.w, rect.h)
    const row: typeof scaled = [scaled[i]]
    i++
    while (i < scaled.length) {
      const withNext = [...row, scaled[i]]
      if (worst(withNext, side) <= worst(row, side)) { row.push(scaled[i]); i++ }
      else break
    }
    const rowArea = row.reduce((s, r) => s + r.area, 0)
    if (rect.w <= rect.h) {
      const rowH = rowArea / rect.w
      let cx = rect.x
      for (const r of row) {
        const cw = r.area / rowH
        out.push({ node: r.node, metric: r.metric, x: cx, y: rect.y, w: cw, h: rowH })
        cx += cw
      }
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH }
    } else {
      const rowW = rowArea / rect.h
      let cy = rect.y
      for (const r of row) {
        const ch = r.area / rowW
        out.push({ node: r.node, metric: r.metric, x: rect.x, y: cy, w: rowW, h: ch })
        cy += ch
      }
      rect = { x: rect.x + rowW, y: rect.y, w: rect.w - rowW, h: rect.h }
    }
  }
  return out
}

export function TreemapLayout({ roots, cf }: { roots: OrgTreeNode[]; cf: CFApi }) {
  const W = 1000
  const H = 560
  const PAD = 2

  const rects = useMemo(() => {
    const leaves = collectLeaves(roots)
    const items = leaves
      .map((node) => ({ node, metric: metricFor(node, cf) }))
      .filter((it) => it.metric > 0)
      .sort((a, b) => b.metric - a.metric)
    return squarify(items, 0, 0, W, H)
  }, [roots, cf])

  if (rects.length === 0) {
    return <div className="org-empty muted">No leaf nodes to lay out.</div>
  }

  return (
    <div className="org-treemap">
      <svg
        className="org-treemap-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Organization treemap"
      >
        {rects.map((r) => {
          const w = Math.max(0, r.w - PAD)
          const h = Math.max(0, r.h - PAD)
          const showLabel = w > 54 && h > 26
          const showMetric = w > 54 && h > 44
          return (
            <g key={r.node.id} className="org-tm-cell" transform={`translate(${r.x + PAD / 2} ${r.y + PAD / 2})`}>
              <rect
                width={w}
                height={h}
                rx={4}
                className="org-tm-rect"
                style={{ fill: typeFill(r.node.type) }}
              >
                <title>{`${r.node.name} — ${r.node.type} · metric ${r.metric}`}</title>
              </rect>
              {showLabel && (
                <text x={8} y={18} className="org-tm-name" clipPath="none">
                  {r.node.name}
                </text>
              )}
              {showMetric && (
                <text x={8} y={34} className="org-tm-metric">
                  {r.node.type} · {r.metric}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="org-sun-legend">
        {['Group', 'Region', 'Team'].map((t) => (
          <span key={t} className="org-sun-legend-item">
            <span className="org-sun-swatch" style={{ background: typeFill(t) }} aria-hidden="true" />
            {t}
          </span>
        ))}
        <span className="muted org-sun-hint">Area ∝ headcount (custom field) or subtree size.</span>
      </div>
    </div>
  )
}
