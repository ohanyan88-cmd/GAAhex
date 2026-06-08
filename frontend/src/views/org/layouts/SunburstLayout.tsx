import { useMemo, useState } from 'react'
import type { OrgTreeNode } from '../types'
import { descendantCount, typeFill } from '../utils'

type SunSeg = {
  node: OrgTreeNode
  depth: number
  a0: number
  a1: number
}

function buildSunSegments(roots: OrgTreeNode[]): SunSeg[] {
  const segs: SunSeg[] = []
  const weight = (n: OrgTreeNode) => descendantCount(n) + 1
  const walk = (nodes: OrgTreeNode[], depth: number, a0: number, a1: number) => {
    const total = nodes.reduce((s, n) => s + weight(n), 0)
    if (total <= 0) return
    let a = a0
    for (const n of nodes) {
      const frac = weight(n) / total
      const span = (a1 - a0) * frac
      const start = a
      const end = a + span
      segs.push({ node: n, depth, a0: start, a1: end })
      if (n.children.length > 0) walk(n.children, depth + 1, start, end)
      a = end
    }
  }
  walk(roots, 0, 0, Math.PI * 2)
  return segs
}

function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const pt = (r: number, a: number): [number, number] => [
    cx + r * Math.sin(a),
    cy - r * Math.cos(a),
  ]
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0o, y0o] = pt(r1, a0)
  const [x1o, y1o] = pt(r1, a1)
  const [x1i, y1i] = pt(r0, a1)
  const [x0i, y0i] = pt(r0, a0)
  return [
    `M ${x0o} ${y0o}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1o} ${y1o}`,
    `L ${x1i} ${y1i}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x0i} ${y0i}`,
    'Z',
  ].join(' ')
}

export function SunburstLayout({ roots }: { roots: OrgTreeNode[] }) {
  const segs = useMemo(() => buildSunSegments(roots), [roots])
  const [active, setActive] = useState<string | null>(null)

  const SIZE = 560
  const cx = SIZE / 2
  const cy = SIZE / 2
  const maxDepth = useMemo(() => segs.reduce((m, s) => Math.max(m, s.depth), 0), [segs])
  const inner = 46
  const ringMax = (SIZE / 2) - 18 - inner
  const ringSpan = ringMax / (maxDepth + 1)

  const activeSeg = active ? segs.find((s) => s.node.id === active) : null

  return (
    <div className="org-sunburst">
      <svg
        className="org-sunburst-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Organization sunburst"
      >
        {segs.map((s) => {
          const r0 = inner + s.depth * ringSpan
          const r1 = r0 + ringSpan - 1.5
          const d = arcPath(cx, cy, r0, r1, s.a0, s.a1)
          const on = active === s.node.id
          return (
            <path
              key={s.node.id}
              d={d}
              className={`org-sun-seg${on ? ' on' : ''}`}
              style={{ fill: typeFill(s.node.type) }}
              tabIndex={0}
              role="button"
              aria-label={`${s.node.type}: ${s.node.name}`}
              onMouseEnter={() => setActive(s.node.id)}
              onMouseLeave={() => setActive((a) => (a === s.node.id ? null : a))}
              onFocus={() => setActive(s.node.id)}
              onClick={() => setActive((a) => (a === s.node.id ? null : s.node.id))}
            >
              <title>{`${s.node.name} — ${s.node.type} (${descendantCount(s.node) + 1})`}</title>
            </path>
          )
        })}
        <circle cx={cx} cy={cy} r={inner - 4} className="org-sun-hub" />
        <text x={cx} y={cy - 4} className="org-sun-hub-name" textAnchor="middle">
          {activeSeg ? activeSeg.node.name : 'Org'}
        </text>
        <text x={cx} y={cy + 14} className="org-sun-hub-sub" textAnchor="middle">
          {activeSeg ? activeSeg.node.type : `${segs.length} nodes`}
        </text>
      </svg>
      <div className="org-sun-legend">
        {['Group', 'Region', 'Team'].map((t) => (
          <span key={t} className="org-sun-legend-item">
            <span className="org-sun-swatch" style={{ background: typeFill(t) }} aria-hidden="true" />
            {t}
          </span>
        ))}
        <span className="muted org-sun-hint">Hover or click a ring segment to inspect a node.</span>
      </div>
    </div>
  )
}
