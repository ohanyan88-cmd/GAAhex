import type { CustomFieldDef } from '../../../lib/pageConfig'
import type { OrgTreeNode, CFApi } from '../types'
import { toneClass, descendantCount } from '../utils'
import { NodeCustomFieldsReadonly } from '../shared'

export function GroupedLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  return (
    <div className="org-lanes">
      {roots.map((lane) => (
        <section key={lane.id} className="org-lane">
          <header className="org-lane-head">
            <span className={`badge ${toneClass(lane.type)}`}>{lane.type}</span>
            <span className="org-lane-name">{lane.name}</span>
            <span className="org-lane-count" title="Descendant nodes">{descendantCount(lane)}</span>
          </header>
          {lane.children.length === 0 ? (
            <div className="org-lane-empty muted">No child nodes.</div>
          ) : (
            <div className="org-lane-body">
              {lane.children.map((c) => (
                <div key={c.id} className="org-lane-card">
                  <div className="org-lane-card-head">
                    <span className={`badge ${toneClass(c.type)}`}>{c.type}</span>
                    <span className="org-lane-card-name">{c.name}</span>
                  </div>
                  <NodeCustomFieldsReadonly node={c} defs={defs} cf={cf} />
                  {c.children.length > 0 && (
                    <ul className="org-lane-sub">
                      {c.children.map((g) => (
                        <li key={g.id} className="org-lane-sub-item">
                          <span className={`badge ${toneClass(g.type)}`}>{g.type}</span>
                          <span>{g.name}</span>
                          <NodeCustomFieldsReadonly node={g} defs={defs} cf={cf} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
