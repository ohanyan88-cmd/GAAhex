// -----------------------------------------------------------------------------
// OrgView — the Org page (view.type === 'org'). Renders the org hierarchy in one
// of THREE switchable layouts (Tree | Cards | Hierarchy). The chosen layout is a
// pure presentation preference, persisted to localStorage ('gaaex-org-view') and
// applied on load (default 'tree').
//
// PHASE 1 (this file): view layouts + switcher ONLY. No node custom-fields,
// node-type/look config, or structure editing yet (later phases).
//
// The hierarchy is derived from the flat node list: parent_id when present
// (the API returns it), otherwise falling back to the dot-path. All three layouts
// render from a single nested `OrgTreeNode[]` tree so they stay consistent.
// -----------------------------------------------------------------------------
import { useMemo, useState } from 'react'
import { usePageConfig } from './pageConfig'
import { LayersIcon, PackageIcon, ChartIcon } from './icons'

export type OrgNode = {
  id: string
  type: string
  name: string
  path: string
  code?: string
  parent_id?: string | null
}

type OrgLayout = 'tree' | 'cards' | 'hierarchy'
const STORAGE_KEY = 'gaaex-org-view'

function loadLayout(): OrgLayout {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'tree' || v === 'cards' || v === 'hierarchy') return v
  } catch { /* private mode / unavailable — fall through to default */ }
  return 'tree'
}

// A node plus its resolved children — what every layout consumes.
type OrgTreeNode = OrgNode & { children: OrgTreeNode[] }

// Build a nested tree from the flat list. Prefer explicit parent_id (unambiguous);
// otherwise reconstruct from the dot-path within document order (paths can collide
// across groups, so path is only a fallback for the parentless case).
function buildTree(nodes: OrgNode[]): OrgTreeNode[] {
  const wrapped: OrgTreeNode[] = nodes.map((n) => ({ ...n, children: [] }))
  const byId = new Map(wrapped.map((n) => [n.id, n]))
  const roots: OrgTreeNode[] = []
  const hasParentId = wrapped.some((n) => n.parent_id != null)

  if (hasParentId) {
    for (const n of wrapped) {
      const parent = n.parent_id != null ? byId.get(n.parent_id) : undefined
      if (parent) parent.children.push(n)
      else roots.push(n)
    }
    return roots
  }

  // Fallback: stack-based reconstruction from path depth in document order.
  const stack: OrgTreeNode[] = []
  for (const n of wrapped) {
    const depth = n.path.split('.').length
    while (stack.length >= depth) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(n)
    else roots.push(n)
    stack.push(n)
  }
  return roots
}

// type → badge tone class (theme-driven via tokens; falls back to neutral).
function toneClass(type: string): string {
  const t = type.toLowerCase()
  if (t === 'group') return 'org-badge-group'
  if (t === 'region') return 'org-badge-region'
  if (t === 'team') return 'org-badge-team'
  return 'org-badge-other'
}

// ── Layout: Tree (indented nested list — the original look, now a real tree) ──
function TreeLayout({ roots }: { roots: OrgTreeNode[] }) {
  const render = (n: OrgTreeNode, depth: number): React.ReactNode => (
    <li key={n.id} className="org-tree-li">
      <div className="org-tree-row" style={{ marginLeft: depth * 22 }}>
        <span className={`badge ${toneClass(n.type)}`}>{n.type}</span>
        <span className="org-tree-name">{n.name}</span>
        <span className="org-tree-path">/{n.path}/</span>
      </div>
      {n.children.length > 0 && (
        <ul className="org-tree-children">{n.children.map((c) => render(c, depth + 1))}</ul>
      )}
    </li>
  )
  return <ul className="org-tree">{roots.map((n) => render(n, 0))}</ul>
}

// ── Layout: Cards (each node a card, nested by level) ──
function CardNode({ node }: { node: OrgTreeNode }) {
  return (
    <div className={`org-card org-card-${node.type.toLowerCase()}`}>
      <div className="org-card-head">
        <span className={`badge ${toneClass(node.type)}`}>{node.type}</span>
        <span className="org-card-name">{node.name}</span>
      </div>
      <div className="org-card-path">/{node.path}/</div>
      {node.children.length > 0 && (
        <div className="org-card-children">
          {node.children.map((c) => <CardNode key={c.id} node={c} />)}
        </div>
      )}
    </div>
  )
}

function CardsLayout({ roots }: { roots: OrgTreeNode[] }) {
  return (
    <div className="org-cards">
      {roots.map((n) => <CardNode key={n.id} node={n} />)}
    </div>
  )
}

// ── Layout: Hierarchy (top-down org chart, CSS boxes + connectors) ──
function ChartNode({ node }: { node: OrgTreeNode }) {
  const hasKids = node.children.length > 0
  return (
    <li className="org-chart-li">
      <div className={`org-chart-box org-chart-${node.type.toLowerCase()}`}>
        <span className={`badge ${toneClass(node.type)}`}>{node.type}</span>
        <span className="org-chart-name">{node.name}</span>
        <span className="org-chart-code">{node.code ?? node.path.split('.').slice(-1)[0]}</span>
      </div>
      {hasKids && (
        <ul className="org-chart-children">
          {node.children.map((c) => <ChartNode key={c.id} node={c} />)}
        </ul>
      )}
    </li>
  )
}

function HierarchyLayout({ roots }: { roots: OrgTreeNode[] }) {
  return (
    <div className="org-chart-scroll">
      <ul className="org-chart">
        {roots.map((n) => <ChartNode key={n.id} node={n} />)}
      </ul>
    </div>
  )
}

const SWITCHER: { id: OrgLayout; label: string; Icon: typeof LayersIcon }[] = [
  { id: 'tree', label: 'Tree', Icon: LayersIcon },
  { id: 'cards', label: 'Cards', Icon: PackageIcon },
  { id: 'hierarchy', label: 'Hierarchy', Icon: ChartIcon },
]

export default function OrgView({ nodes, token, configVersion }: { nodes: OrgNode[]; token: string; configVersion: number }) {
  const cfg = usePageConfig(token, 'org', configVersion)
  const [layout, setLayout] = useState<OrgLayout>(loadLayout)
  const roots = useMemo(() => buildTree(nodes), [nodes])

  const choose = (next: OrgLayout) => {
    setLayout(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  }

  return (
    <div className="org-view">
      <div className="view-head">
        <div className="view-icon"><LayersIcon size={20} /></div>
        <div className="view-title-wrap">
          <h2>{cfg.title}</h2>
          <span className="view-sub">Organization hierarchy</span>
        </div>
        <div className="view-head-actions">
          <div className="org-switcher" role="tablist" aria-label="Org view layout">
            {SWITCHER.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={layout === id}
                className={`org-switcher-btn${layout === id ? ' on' : ''}`}
                onClick={() => choose(id)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {roots.length === 0 ? (
        <div className="org-empty muted">No organization nodes yet.</div>
      ) : layout === 'tree' ? (
        <TreeLayout roots={roots} />
      ) : layout === 'cards' ? (
        <CardsLayout roots={roots} />
      ) : (
        <HierarchyLayout roots={roots} />
      )}
    </div>
  )
}
