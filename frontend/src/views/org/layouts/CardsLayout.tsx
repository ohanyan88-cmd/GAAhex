import { useMemo } from 'react'
import type { CustomFieldDef } from '../../../lib/pageConfig'
import type { OrgTreeNode, CFApi } from '../types'
import { toneClass, statusFieldKey } from '../utils'
import { NodeAvatar, NodeKebab, NodeStatusPill, NodeKpiChips, NodeCustomFields } from '../shared'

function CardNode({ node, defs, cf, statusKey }: { node: OrgTreeNode; defs: CustomFieldDef[]; cf: CFApi; statusKey: string | null }) {
  return (
    <div className={`org-card org-card-${node.type.toLowerCase()}`}>
      <div className="org-card-head">
        <NodeAvatar node={node} />
        <div className="org-card-headmain">
          <div className="org-card-headtop">
            <span className={`badge ${toneClass(node.type)}`}>{node.type}</span>
            <span className="org-card-name">{node.name}</span>
          </div>
          <div className="org-card-path">/{node.path}/</div>
        </div>
        <NodeKebab node={node} />
      </div>
      <div className="org-card-meta">
        <NodeStatusPill node={node} statusKey={statusKey} cf={cf} />
        <NodeKpiChips node={node} cf={cf} />
      </div>
      <NodeCustomFields node={node} defs={defs} cf={cf} />
      {node.children.length > 0 && (
        <div className="org-card-children">
          {node.children.map((c) => <CardNode key={c.id} node={c} defs={defs} cf={cf} statusKey={statusKey} />)}
        </div>
      )}
    </div>
  )
}

export function CardsLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const statusKey = useMemo(() => statusFieldKey(defs), [defs])
  return (
    <div className="org-cards">
      {roots.map((n) => <CardNode key={n.id} node={n} defs={defs} cf={cf} statusKey={statusKey} />)}
    </div>
  )
}
