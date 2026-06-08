import { useMemo } from 'react'
import type { OrgTreeNode } from '../types'
import { toneClass, flattenTree } from '../utils'

export function TimelineLayout({ roots }: { roots: OrgTreeNode[] }) {
  const flat = useMemo(() => flattenTree(roots), [roots])
  const maxDepth = useMemo(() => flat.reduce((m, f) => Math.max(m, f.depth), 0), [flat])

  const cols = useMemo(() => {
    const map = new Map<number, typeof flat>()
    for (const f of flat) {
      const arr = map.get(f.depth) ?? []
      arr.push(f)
      map.set(f.depth, arr)
    }
    const out: { depth: number; items: typeof flat }[] = []
    for (let d = 0; d <= maxDepth; d++) out.push({ depth: d, items: map.get(d) ?? [] })
    return out
  }, [flat, maxDepth])

  if (flat.length === 0) {
    return <div className="org-empty muted">No organization nodes to place.</div>
  }

  return (
    <div className="org-timeline">
      <p className="org-timeline-caption muted">
        v1 — structural progression. Nodes are placed by depth (root → leaf), not by date; org nodes
        carry no temporal data yet. A real time axis arrives once nodes gain start/created dates.
      </p>
      <div className="org-timeline-track">
        <div className="org-timeline-axis" aria-hidden="true" />
        {cols.map(({ depth, items }) => (
          <div key={depth} className="org-timeline-col">
            <div className="org-timeline-tick" aria-hidden="true" />
            <span className="org-timeline-stage">Depth {depth + 1}</span>
            <div className="org-timeline-items">
              {items.map((f) => (
                <div key={f.node.id} className={`org-timeline-item org-card-${f.node.type.toLowerCase()}`} title={`/${f.node.path}/`}>
                  <span className={`badge ${toneClass(f.node.type)}`}>{f.node.type}</span>
                  <span className="org-timeline-item-name">{f.node.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
