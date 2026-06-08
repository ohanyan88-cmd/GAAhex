import { useMemo } from 'react'
import type { CustomFieldDef } from '../../../lib/pageConfig'
import type { OrgTreeNode, CFApi } from '../types'
import { toneClass, statusFieldKey } from '../utils'
import { NodeAvatar, NodeKebab, NodeStatusPill, NodeKpiChips, NodeCustomFields } from '../shared'

function ChartNode({ node, defs, cf, statusKey }: { node: OrgTreeNode; defs: CustomFieldDef[]; cf: CFApi; statusKey: string | null }) {
  const hasKids = node.children.length > 0
  return (
    <li className="org-chart-li">
      <div className={`org-chart-box org-chart-${node.type.toLowerCase()}`}>
        <div className="org-chart-top">
          <NodeAvatar node={node} />
          <NodeKebab node={node} />
        </div>
        <span className={`badge ${toneClass(node.type)}`}>{node.type}</span>
        <span className="org-chart-name">{node.name}</span>
        <span className="org-chart-code">{node.code ?? node.path.split('.').slice(-1)[0]}</span>
        <div className="org-card-meta org-chart-meta">
          <NodeStatusPill node={node} statusKey={statusKey} cf={cf} />
          <NodeKpiChips node={node} cf={cf} />
        </div>
        <NodeCustomFields node={node} defs={defs} cf={cf} />
      </div>
      {hasKids && (
        <ul className="org-chart-children">
          {node.children.map((c) => <ChartNode key={c.id} node={c} defs={defs} cf={cf} statusKey={statusKey} />)}
        </ul>
      )}
    </li>
  )
}

export function HierarchyLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const statusKey = useMemo(() => statusFieldKey(defs), [defs])
  return (
    <div className="org-chart-scroll">
      <ul className="org-chart">
        {roots.map((n) => <ChartNode key={n.id} node={n} defs={defs} cf={cf} statusKey={statusKey} />)}
      </ul>
    </div>
  )
}
