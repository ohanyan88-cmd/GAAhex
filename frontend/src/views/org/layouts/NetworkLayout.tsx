import { useMemo, useState, useRef, useEffect } from 'react'
import type { OrgTreeNode } from '../types'
import { descendantCount, typeFill, flattenTree } from '../utils'

type SimNode = { id: string; node: OrgTreeNode; x: number; y: number; vx: number; vy: number; r: number }
type SimLink = { source: string; target: string }

export function NetworkLayout({ roots }: { roots: OrgTreeNode[] }) {
  const W = 1000
  const H = 600
  const svgRef = useRef<SVGSVGElement>(null)
  const [, force] = useState(0)
  const [active, setActive] = useState<string | null>(null)

  const { simNodes, simLinks } = useMemo(() => {
    const flat = flattenTree(roots)
    const maxSub = flat.reduce((m, f) => Math.max(m, descendantCount(f.node) + 1), 1)
    const sn: SimNode[] = flat.map((f, i) => {
      const sub = descendantCount(f.node) + 1
      const ang = i * 2.399963
      const rad = 30 + i * 6
      return {
        id: f.node.id,
        node: f.node,
        x: W / 2 + Math.cos(ang) * rad,
        y: H / 2 + Math.sin(ang) * rad,
        vx: 0, vy: 0,
        r: 7 + Math.sqrt(sub / maxSub) * 20,
      }
    })
    const sl: SimLink[] = flat
      .filter((f) => f.parentId != null)
      .map((f) => ({ source: f.parentId as string, target: f.node.id }))
    return { simNodes: sn, simLinks: sl }
  }, [roots])

  const nodesRef = useRef<SimNode[]>(simNodes)
  const linksRef = useRef<SimLink[]>(simLinks)
  nodesRef.current = simNodes
  linksRef.current = simLinks

  useEffect(() => {
    const nodes = nodesRef.current
    const links = linksRef.current
    if (nodes.length === 0) return
    const byId = new Map(nodes.map((n) => [n.id, n]))
    let raf = 0
    let alpha = 1

    const tick = () => {
      const cx = W / 2
      const cy = H / 2
      for (const n of nodes) {
        n.vx += (cx - n.x) * 0.0009 * alpha
        n.vy += (cy - n.y) * 0.0009 * alpha
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j]
          let dx = a.x - b.x, dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = dx * dx + dy * dy }
          const dist = Math.sqrt(d2)
          const rep = (2400 * alpha) / d2
          const fx = (dx / dist) * rep
          const fy = (dy / dist) * rep
          a.vx += fx; a.vy += fy
          b.vx -= fx; b.vy -= fy
        }
      }
      const LINK = 90
      for (const l of links) {
        const s = byId.get(l.source), t = byId.get(l.target)
        if (!s || !t) continue
        const dx = t.x - s.x, dy = t.y - s.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
        const k = (dist - LINK) * 0.045 * alpha
        const fx = (dx / dist) * k
        const fy = (dy / dist) * k
        s.vx += fx; s.vy += fy
        t.vx -= fx; t.vy -= fy
      }
      for (const n of nodes) {
        n.vx *= 0.82; n.vy *= 0.82
        n.x += n.vx; n.y += n.vy
        n.x = Math.max(n.r, Math.min(W - n.r, n.x))
        n.y = Math.max(n.r, Math.min(H - n.r, n.y))
      }
      alpha *= 0.992
      force((c) => c + 1)
      if (alpha > 0.02) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [simNodes, simLinks])

  if (simNodes.length === 0) {
    return <div className="org-empty muted">No organization nodes to graph.</div>
  }

  const byId = new Map(simNodes.map((n) => [n.id, n]))

  return (
    <div className="org-network">
      <svg
        ref={svgRef}
        className="org-network-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Organization network graph"
      >
        <g className="org-net-links">
          {simLinks.map((l) => {
            const s = byId.get(l.source), t = byId.get(l.target)
            if (!s || !t) return null
            const on = active === l.source || active === l.target
            return (
              <line
                key={`${l.source}-${l.target}`}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                className={`org-net-link${on ? ' on' : ''}`}
              />
            )
          })}
        </g>
        <g className="org-net-nodes">
          {simNodes.map((n) => {
            const on = active === n.id
            return (
              <g
                key={n.id}
                className={`org-net-node${on ? ' on' : ''}`}
                transform={`translate(${n.x} ${n.y})`}
                tabIndex={0}
                role="button"
                aria-label={`${n.node.type}: ${n.node.name}`}
                onMouseEnter={() => setActive(n.id)}
                onMouseLeave={() => setActive((a) => (a === n.id ? null : a))}
                onFocus={() => setActive(n.id)}
                onBlur={() => setActive((a) => (a === n.id ? null : a))}
              >
                <circle r={n.r} className="org-net-circle" style={{ fill: typeFill(n.node.type) }}>
                  <title>{`${n.node.name} — ${n.node.type} (${descendantCount(n.node) + 1})`}</title>
                </circle>
                {(on || n.r >= 16) && (
                  <text className="org-net-label" y={n.r + 12} textAnchor="middle">{n.node.name}</text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="org-sun-legend">
        {['Group', 'Region', 'Team'].map((t) => (
          <span key={t} className="org-sun-legend-item">
            <span className="org-sun-swatch" style={{ background: typeFill(t) }} aria-hidden="true" />
            {t}
          </span>
        ))}
        <span className="muted org-sun-hint">Force-directed parent→child graph. Node size ∝ subtree size. Hover to focus.</span>
      </div>
    </div>
  )
}
