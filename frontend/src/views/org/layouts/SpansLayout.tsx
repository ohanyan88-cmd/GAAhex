import { useMemo } from 'react'
import type { OrgTreeNode } from '../types'
import { descendantCount } from '../utils'

const SPAN_WIDE_THRESHOLD = 7

type SpanRow = {
  node: OrgTreeNode
  layer: number
  span: number
  descendants: number
  flag: 'wide' | 'thin' | 'healthy' | 'leaf'
}

function collectSpanRows(nodes: OrgTreeNode[], layer: number): SpanRow[] {
  const rows: SpanRow[] = []
  for (const n of nodes) {
    const span = n.children.length
    const desc = descendantCount(n)
    let flag: SpanRow['flag']
    if (span === 0) flag = 'leaf'
    else if (span > SPAN_WIDE_THRESHOLD) flag = 'wide'
    else if (span === 1) flag = 'thin'
    else flag = 'healthy'
    rows.push({ node: n, layer, span, descendants: desc, flag })
    rows.push(...collectSpanRows(n.children, layer + 1))
  }
  return rows
}

type LayerSummary = { layer: number; count: number; avgSpan: number }

function buildLayerSummaries(rows: SpanRow[]): LayerSummary[] {
  const map = new Map<number, { total: number; spanSum: number; nonLeafCount: number }>()
  for (const r of rows) {
    const e = map.get(r.layer) ?? { total: 0, spanSum: 0, nonLeafCount: 0 }
    e.total += 1
    if (r.flag !== 'leaf') { e.spanSum += r.span; e.nonLeafCount += 1 }
    map.set(r.layer, e)
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([layer, { total, spanSum, nonLeafCount }]) => ({
      layer,
      count: total,
      avgSpan: nonLeafCount > 0 ? Math.round((spanSum / nonLeafCount) * 10) / 10 : 0,
    }))
}

function SpanFlagBadge({ flag }: { flag: SpanRow['flag'] }) {
  if (flag === 'wide') return <span className="spans-flag spans-flag-wide">Wide</span>
  if (flag === 'thin') return <span className="spans-flag spans-flag-thin">Thin</span>
  if (flag === 'healthy') return <span className="spans-flag spans-flag-healthy">Healthy</span>
  return <span className="spans-flag spans-flag-leaf">Leaf</span>
}

function toneClass(type: string): string {
  const t = type.toLowerCase()
  if (t === 'group') return 'org-badge-group'
  if (t === 'region') return 'org-badge-region'
  if (t === 'team') return 'org-badge-team'
  return 'org-badge-other'
}

export function SpansLayout({ roots }: { roots: OrgTreeNode[] }) {
  const rows = useMemo(() => collectSpanRows(roots, 1), [roots])
  const layers = useMemo(() => buildLayerSummaries(rows), [rows])

  const totalNodes = rows.length
  const totalLayers = layers.length
  const nonLeafRows = rows.filter((r) => r.flag !== 'leaf')
  const avgSpan = nonLeafRows.length > 0
    ? Math.round((nonLeafRows.reduce((s, r) => s + r.span, 0) / nonLeafRows.length) * 10) / 10
    : 0
  const flaggedCount = rows.filter((r) => r.flag === 'wide' || r.flag === 'thin').length

  if (totalNodes === 0) {
    return <div className="org-empty muted">No organization nodes to analyze.</div>
  }

  return (
    <div className="spans-view">
      <div className="spans-summary">
        <div className="spans-stat">
          <span className="spans-stat-val">{totalLayers}</span>
          <span className="spans-stat-label">Layers</span>
        </div>
        <div className="spans-stat">
          <span className="spans-stat-val">{totalNodes}</span>
          <span className="spans-stat-label">Nodes</span>
        </div>
        <div className="spans-stat">
          <span className="spans-stat-val">{avgSpan}</span>
          <span className="spans-stat-label">Avg span</span>
        </div>
        <div className="spans-stat">
          <span className="spans-stat-val spans-stat-val-flagged">{flaggedCount}</span>
          <span className="spans-stat-label">Flagged</span>
        </div>
      </div>

      <section className="spans-section">
        <h3 className="spans-section-title">Layer breakdown</h3>
        <div className="spans-layer-list">
          {layers.map((l) => (
            <div key={l.layer} className="spans-layer-row">
              <span className="spans-layer-badge">Layer {l.layer}</span>
              <span className="spans-layer-count">{l.count} node{l.count !== 1 ? 's' : ''}</span>
              {l.avgSpan > 0 && (
                <span className="spans-layer-avg muted">avg span {l.avgSpan}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="spans-section">
        <h3 className="spans-section-title">Span of control — per node</h3>
        <div className="grid-wrap">
          <table className="grid spans-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Type</th>
                <th className="num">Layer</th>
                <th className="num">Span</th>
                <th className="num">Descendants</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.node.id} className={`spans-row spans-row-${r.flag}`}>
                  <td className="spans-node-name" style={{ paddingLeft: 8 + (r.layer - 1) * 16 }}>
                    {r.node.name}
                  </td>
                  <td><span className={`badge ${toneClass(r.node.type)}`}>{r.node.type}</span></td>
                  <td className="num">{r.layer}</td>
                  <td className="num">{r.span}</td>
                  <td className="num">{r.descendants}</td>
                  <td><SpanFlagBadge flag={r.flag} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="spans-legend">
        <span className="spans-legend-label">Legend:</span>
        <span className="spans-flag spans-flag-wide">Wide</span>
        <span className="spans-legend-desc muted">span &gt; {SPAN_WIDE_THRESHOLD} (over-managed)</span>
        <span className="spans-flag spans-flag-thin">Thin</span>
        <span className="spans-legend-desc muted">span = 1 (likely redundant layer)</span>
        <span className="spans-flag spans-flag-healthy">Healthy</span>
        <span className="spans-legend-desc muted">span 2–{SPAN_WIDE_THRESHOLD}</span>
        <span className="spans-flag spans-flag-leaf">Leaf</span>
        <span className="spans-legend-desc muted">no direct reports (individual contributor)</span>
      </div>
    </div>
  )
}
