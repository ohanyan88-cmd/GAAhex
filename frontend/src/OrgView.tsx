// -----------------------------------------------------------------------------
// OrgView — the Org page (view.type === 'org'). Renders the org hierarchy in one
// of FIVE switchable layouts (Hierarchy | Cards | Outline | List | Grouped). The
// chosen layout is a pure presentation preference, persisted to localStorage
// ('gaaex-org-view') and applied on load (default 'hierarchy').
//
// PHASE 1 (this file): view layouts + switcher ONLY. No node custom-fields,
// node-type/look config, or structure editing yet (later phases). The List view's
// columns work strictly from the current node fields (richer columns — role /
// headcount / manager — arrive in a later phase).
//
// The hierarchy is derived from the flat node list: parent_id when present
// (the API returns it), otherwise falling back to the dot-path. All layouts
// render from a single nested `OrgTreeNode[]` tree so they stay consistent.
// -----------------------------------------------------------------------------
import { useMemo, useState } from 'react'
import { usePageConfig, type CustomFieldDef } from './pageConfig'
import { useCustomFields, CustomFieldChip } from './CustomCells'
import {
  ChartIcon, PackageIcon, LayersIcon, RowsIcon, MapIcon,
  ChevronRightIcon, ChevronDownIcon, SearchIcon, ArrowUpIcon, ArrowDownIcon,
  ArrowRightIcon,
} from './icons'

// The custom-fields hook return, threaded into each layout so nodes can show + edit values.
type CFApi = ReturnType<typeof useCustomFields>

// Initials for a node's avatar: first letters of up to two words (e.g. "North Region" → "NR").
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export type OrgNode = {
  id: string
  type: string
  name: string
  path: string
  code?: string
  parent_id?: string | null
}

type OrgLayout = 'hierarchy' | 'cards' | 'outline' | 'list' | 'grouped'
const STORAGE_KEY = 'gaaex-org-view'

function loadLayout(): OrgLayout {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    // Migrate the old 'tree' label → the renamed 'outline' layout.
    if (v === 'tree') return 'outline'
    if (v === 'hierarchy' || v === 'cards' || v === 'outline' || v === 'list' || v === 'grouped') return v
  } catch { /* private mode / unavailable — fall through to default */ }
  return 'hierarchy'
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

// Count every descendant of a node (children, grandchildren, …) — the lane's
// "headcount-for-now" badge in the Grouped layout.
function descendantCount(n: OrgTreeNode): number {
  let total = 0
  for (const c of n.children) total += 1 + descendantCount(c)
  return total
}

// type → badge tone class (theme-driven via tokens; falls back to neutral).
function toneClass(type: string): string {
  const t = type.toLowerCase()
  if (t === 'group') return 'org-badge-group'
  if (t === 'region') return 'org-badge-region'
  if (t === 'team') return 'org-badge-team'
  return 'org-badge-other'
}

// Avatar/initials circle for a node, themed per type tone alongside the existing badge.
function NodeAvatar({ node }: { node: OrgNode }) {
  return <span className={`org-avatar ${toneClass(node.type)}`} aria-hidden="true">{initials(node.name)}</span>
}

// A small kebab quick-action affordance (no-op placeholder for now — present, accessible, tidy).
function NodeKebab({ node }: { node: OrgNode }) {
  return (
    <button
      type="button"
      className="org-node-kebab"
      aria-label={`Actions for ${node.name}`}
      onClick={(e) => { e.stopPropagation() }}
    >
      <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
      </svg>
    </button>
  )
}

// Editable label:value chips for a node's custom fields (Cards + Hierarchy boxes). Reuses the
// shared CustomFieldChip (same field types + same save path as the table cells).
function NodeCustomFields({ node, defs, cf }: { node: OrgNode; defs: CustomFieldDef[]; cf: CFApi }) {
  if (defs.length === 0) return null
  return (
    <div className="org-cf-list">
      {defs.map((f) => (
        <CustomFieldChip
          key={f.key}
          def={f}
          value={cf.value(node.id, f.key)}
          onSave={(v) => cf.setValue(node.id, f.key, v)}
        />
      ))}
    </div>
  )
}

// Read-only compact rendering of custom fields for Outline + Grouped (inline edit is awkward there).
function NodeCustomFieldsReadonly({ node, defs, cf }: { node: OrgNode; defs: CustomFieldDef[]; cf: CFApi }) {
  if (defs.length === 0) return null
  const shown = defs
    .map((f) => ({ f, v: cf.value(node.id, f.key) }))
    .filter(({ v }) => v != null && v !== '')
  if (shown.length === 0) return null
  return (
    <span className="org-cf-inline">
      {shown.map(({ f, v }) => (
        <span key={f.key} className="org-cf-tag">
          <span className="org-cf-tag-label">{f.label}</span>
          <span className="org-cf-tag-value">{f.type === 'boolean' ? (v === true ? 'Yes' : 'No') : String(v)}</span>
        </span>
      ))}
    </span>
  )
}

// ── Layout: Outline (collapsible indented tree — dense, keyboard-friendly) ──
function OutlineNode({ node, depth, defs, cf }: { node: OrgTreeNode; depth: number; defs: CustomFieldDef[]; cf: CFApi }) {
  const [open, setOpen] = useState(true) // default expanded
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
      </div>
      {hasKids && open && (
        <ul className="org-tree-children">
          {node.children.map((c) => <OutlineNode key={c.id} node={c} depth={depth + 1} defs={defs} cf={cf} />)}
        </ul>
      )}
    </li>
  )
}

function OutlineLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  return <ul className="org-tree">{roots.map((n) => <OutlineNode key={n.id} node={n} depth={0} defs={defs} cf={cf} />)}</ul>
}

// ── Layout: Cards (each node a card, nested by level) ──
function CardNode({ node, defs, cf }: { node: OrgTreeNode; defs: CustomFieldDef[]; cf: CFApi }) {
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
      <NodeCustomFields node={node} defs={defs} cf={cf} />
      {node.children.length > 0 && (
        <div className="org-card-children">
          {node.children.map((c) => <CardNode key={c.id} node={c} defs={defs} cf={cf} />)}
        </div>
      )}
    </div>
  )
}

function CardsLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  return (
    <div className="org-cards">
      {roots.map((n) => <CardNode key={n.id} node={n} defs={defs} cf={cf} />)}
    </div>
  )
}

// ── Layout: Hierarchy (top-down org chart, CSS boxes + connectors) ──
function ChartNode({ node, defs, cf }: { node: OrgTreeNode; defs: CustomFieldDef[]; cf: CFApi }) {
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
        <NodeCustomFields node={node} defs={defs} cf={cf} />
      </div>
      {hasKids && (
        <ul className="org-chart-children">
          {node.children.map((c) => <ChartNode key={c.id} node={c} defs={defs} cf={cf} />)}
        </ul>
      )}
    </li>
  )
}

function HierarchyLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  return (
    <div className="org-chart-scroll">
      <ul className="org-chart">
        {roots.map((n) => <ChartNode key={n.id} node={n} defs={defs} cf={cf} />)}
      </ul>
    </div>
  )
}

// ── Layout: List / Table (flat, sortable + searchable) ──
type SortCol = 'name' | 'type' | 'path' | 'parent'
type SortDir = 'asc' | 'desc'

// Flatten the original node list with each node's parent name resolved (its
// "manager/owner"). Built from the flat list directly so we keep every node.
type ListRow = { node: OrgNode; parentName: string }

function ListLayout({ nodes, cf }: { nodes: OrgNode[]; cf: CFApi }) {
  const [query, setQuery] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const rows = useMemo<ListRow[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    return nodes.map((n) => ({
      node: n,
      parentName: n.parent_id != null ? (byId.get(n.parent_id)?.name ?? '') : '',
    }))
  }, [nodes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? rows.filter((r) => r.node.name.toLowerCase().includes(q) || r.node.path.toLowerCase().includes(q))
      : rows
    const val = (r: ListRow): string => {
      switch (sortCol) {
        case 'name': return r.node.name
        case 'type': return r.node.type
        case 'path': return r.node.path
        case 'parent': return r.parentName
      }
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...base].sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true, sensitivity: 'base' }) * dir)
  }, [rows, query, sortCol, sortDir])

  const sortBy = (col: SortCol) => {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortHead = ({ col, label }: { col: SortCol; label: string }) => {
    const active = sortCol === col
    return (
      <th>
        <button type="button" className={`org-th-sort${active ? ' on' : ''}`} onClick={() => sortBy(col)} aria-label={`Sort by ${label}`}>
          <span>{label}</span>
          {active && (sortDir === 'asc' ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />)}
        </button>
      </th>
    )
  }

  return (
    <div className="org-list">
      <div className="org-list-toolbar">
        <div className="org-search">
          <SearchIcon size={15} />
          <input
            type="text"
            className="org-search-input"
            placeholder="Filter by name or path…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter nodes"
          />
        </div>
        <span className="org-list-count muted">{filtered.length} node{filtered.length === 1 ? '' : 's'}</span>
      </div>
      <div className="grid-wrap">
        <table className="grid org-list-table">
          <thead>
            <tr>
              <SortHead col="name" label="Name" />
              <SortHead col="type" label="Type" />
              <SortHead col="path" label="Path / Code" />
              <SortHead col="parent" label="Parent" />
              {cf.headers()}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={4 + cf.defs.length} className="org-list-empty muted">No nodes match “{query}”.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.node.id}>
                <td className="org-list-name">{r.node.name}</td>
                <td><span className={`badge ${toneClass(r.node.type)}`}>{r.node.type}</span></td>
                <td className="org-list-path">{r.node.code ? r.node.code : `/${r.node.path}/`}</td>
                <td className="org-list-parent">{r.parentName || <span className="muted">—</span>}</td>
                {cf.cells(r.node.id)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Layout: Grouped / swimlanes (one lane per top-level division) ──
function GroupedLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
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

const SWITCHER: { id: OrgLayout; label: string; Icon: typeof LayersIcon }[] = [
  { id: 'hierarchy', label: 'Hierarchy', Icon: ChartIcon },
  { id: 'cards', label: 'Cards', Icon: PackageIcon },
  { id: 'outline', label: 'Outline', Icon: LayersIcon },
  { id: 'list', label: 'List', Icon: RowsIcon },
  { id: 'grouped', label: 'Grouped', Icon: MapIcon },
]

export default function OrgView({ nodes, token, configVersion }: { nodes: OrgNode[]; token: string; configVersion: number }) {
  const cfg = usePageConfig(token, 'org', configVersion)
  const [layout, setLayout] = useState<OrgLayout>(loadLayout)
  const roots = useMemo(() => buildTree(nodes), [nodes])

  // Custom fields (superadmin-added on the Org page) carried on every node: editable in List
  // (table cells) + Cards/Hierarchy (label:value chips); read-only compact in Outline/Grouped.
  const allNodeIds = useMemo(() => nodes.map((n) => n.id), [nodes])
  const cf = useCustomFields(token, 'org', cfg.customFields, allNodeIds)
  const defs = cfg.customFields

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
      ) : layout === 'hierarchy' ? (
        <HierarchyLayout roots={roots} defs={defs} cf={cf} />
      ) : layout === 'cards' ? (
        <CardsLayout roots={roots} defs={defs} cf={cf} />
      ) : layout === 'outline' ? (
        <OutlineLayout roots={roots} defs={defs} cf={cf} />
      ) : layout === 'list' ? (
        <ListLayout nodes={nodes} cf={cf} />
      ) : (
        <GroupedLayout roots={roots} defs={defs} cf={cf} />
      )}
    </div>
  )
}
