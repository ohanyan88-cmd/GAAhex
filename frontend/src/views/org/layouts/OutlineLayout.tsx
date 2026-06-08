import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '../../../components/icons'
import type { CustomFieldDef } from '../../../lib/pageConfig'
import type { OrgTreeNode, CFApi } from '../types'
import { toneClass } from '../utils'
import { NodeCustomFieldsReadonly, NodeKebab } from '../shared'

function OutlineNode({ node, depth, defs, cf }: { node: OrgTreeNode; depth: number; defs: CustomFieldDef[]; cf: CFApi }) {
  const [open, setOpen] = useState(true)
  const hasKids = node.children.length > 0
  return (
    <li className="org-tree-li">
      <div className="org-tree-row" style={{ paddingLeft: 8 + depth * 22 }}>
        {hasKids ? (
          <button
            type="button"
            className="org-tree-toggle"
            aria-expanded={open}
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </button>
        ) : (
          <span className="org-tree-toggle org-tree-toggle-leaf" aria-hidden="true" />
        )}
        <span className={`badge ${toneClass(node.type)}`}>{node.type}</span>
        <span className="org-tree-name">{node.name}</span>
        <span className="org-tree-path">/{node.path}/</span>
        <NodeCustomFieldsReadonly node={node} defs={defs} cf={cf} />
        <NodeKebab node={node} />
      </div>
      {hasKids && open && (
        <ul className="org-tree-children">
          {node.children.map((c) => <OutlineNode key={c.id} node={c} depth={depth + 1} defs={defs} cf={cf} />)}
        </ul>
      )}
    </li>
  )
}

export function OutlineLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  return <ul className="org-tree">{roots.map((n) => <OutlineNode key={n.id} node={n} depth={0} defs={defs} cf={cf} />)}</ul>
}
