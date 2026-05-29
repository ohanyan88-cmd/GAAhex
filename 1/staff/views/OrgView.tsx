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
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { usePageConfig, type CustomFieldDef } from '../lib/pageConfig'
import { useCustomFields, CustomFieldChip } from '../components/CustomCells'
import { StatusPill } from '../primitives'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { createOrgNode, renameOrgNode, moveOrgNode, deleteOrgNode, OrgWriteError } from '../lib/api'
import {
  ChartIcon, PackageIcon, LayersIcon, RowsIcon, MapIcon, ActivityIcon, GlobeIcon,
  ChevronRightIcon, ChevronDownIcon, SearchIcon, ArrowUpIcon, ArrowDownIcon,
  ArrowRightIcon, SunIcon, ServerIcon, PlusIcon, EditIcon, TrashIcon,
  UsersIcon, CalendarIcon, ShieldIcon, BuildingIcon,
} from '../components/icons'

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

type OrgLayout =
  | 'hierarchy' | 'cards' | 'outline' | 'list' | 'grouped' | 'spans' | 'map' | 'sunburst' | 'treemap'
  | 'network' | 'heatmap' | 'timeline' | 'raci'
const STORAGE_KEY = 'gaaex-org-view'

function loadLayout(): OrgLayout {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    // Migrate the old 'tree' label → the renamed 'outline' layout.
    if (v === 'tree') return 'outline'
    if (
      v === 'hierarchy' || v === 'cards' || v === 'outline' || v === 'list' ||
      v === 'grouped' || v === 'spans' || v === 'map' || v === 'sunburst' || v === 'treemap' ||
      v === 'network' || v === 'heatmap' || v === 'timeline' || v === 'raci'
    ) return v
  } catch { /* private mode / unavailable — fall through to default */ }
  return 'hierarchy'
}

// A node plus its resolved children — what every layout consumes.
type OrgTreeNode = OrgNode & { children: OrgTreeNode[] }

// ── Structure editing (kebab → Rename / Add child / Move / Delete) ──────────────
// The kebab menu lives deep inside the recursive layouts, so rather than thread a fat
// callback bundle through every layout we publish the open-modal handlers via context.
// Editing is gated on config.manage (the same gate the backend write endpoints enforce);
// when editing is off the kebab/Add-node controls are simply not rendered.
type OrgEditAction = (node: OrgNode) => void
type OrgEdit = {
  rename: OrgEditAction
  addChild: OrgEditAction
  move: OrgEditAction
  remove: OrgEditAction
}
const OrgEditContext = createContext<OrgEdit | null>(null)
function useOrgEdit(): OrgEdit | null {
  return useContext(OrgEditContext)
}

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

// ── Node-card status + KPI chips (Hierarchy + Cards) ────────────────────────────
// Org nodes carry no built-in status field (OrgNode = id/type/name/path/code/parent_id), so a
// status pill is only meaningful if the superadmin added a custom "status" field. Find it the same
// way the Map layout finds its Location field: explicit key === 'status', else label "Status".
function statusFieldKey(defs: CustomFieldDef[]): string | null {
  const byKey = defs.find((d) => d.key.toLowerCase() === 'status')
  if (byKey) return byKey.key
  const byLabel = defs.find((d) => d.label.trim().toLowerCase() === 'status')
  return byLabel ? byLabel.key : null
}

// Map a free-text status value → a StatusPill variant. Conservative: only obvious "good/bad/warn"
// words drive active/critical/degraded; anything unrecognised stays neutral (never fabricate an
// alarming 'critical' from unknown data). Returns null for empty values (no pill).
function statusVariant(raw: unknown): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null
  if (/^(active|online|operational|healthy|live|ok|up|good|open)$/.test(s)) return 'active'
  if (/^(degraded|warning|warn|at risk|maintenance|partial|pending|paused)$/.test(s)) return 'degraded'
  if (/^(critical|down|offline|outage|failed|error|closed|inactive|suspended)$/.test(s)) return 'critical'
  return 'info' // a known-but-unmapped status string — show it as informational, not alarming
}

// The status pill for a node. With a status custom field present + a recognised value we colour it;
// otherwise we fall back to a neutral pill labelled with the node's type (honest, non-alarming).
function NodeStatusPill({ node, statusKey, cf }: { node: OrgNode; statusKey: string | null; cf: CFApi }) {
  if (statusKey) {
    const raw = cf.value(node.id, statusKey)
    const variant = statusVariant(raw)
    if (variant) return <StatusPill variant={variant} label={String(raw)} size="sm" />
  }
  // No status data → neutral pill carrying the node type, so the pill still reads as a label.
  return <StatusPill variant="neutral" label={node.type} size="sm" />
}

// Compact KPI chips for a node card: Span of control (direct children) + Headcount (a numeric
// 'headcount' custom field, when present — same accessor the Treemap uses). Headcount is omitted
// when absent rather than faked.
function NodeKpiChips({ node, cf }: { node: OrgTreeNode; cf: CFApi }) {
  const span = node.children.length
  const rawHead = cf.value(node.id, 'headcount')
  const head = rawHead != null && rawHead !== '' ? Number(rawHead) : NaN
  const hasHead = Number.isFinite(head)
  return (
    <span className="org-kpi-chips">
      <span className="org-kpi-chip" title="Direct reports (span of control)">
        <span className="org-kpi-label">Span</span>
        <span className="org-kpi-value">{span}</span>
      </span>
      {hasHead && (
        <span className="org-kpi-chip" title="Headcount">
          <span className="org-kpi-label">Headcount</span>
          <span className="org-kpi-value">{head}</span>
        </span>
      )}
    </span>
  )
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

// The kebab quick-action menu: Rename · Add child · Move · Delete. Renders only when structure
// editing is enabled (config.manage) — i.e. an OrgEdit is published on the context. Closes on
// outside-click and Escape; absolutely positioned under the trigger.
function NodeKebab({ node }: { node: OrgNode }) {
  const edit = useOrgEdit()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!edit) return null

  const run = (fn: OrgEditAction) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(false)
    fn(node)
  }

  return (
    <span className="org-kebab-wrap" ref={wrapRef}>
      <button
        type="button"
        className={'org-node-kebab' + (open ? ' on' : '')}
        aria-label={`Actions for ${node.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="org-kebab-menu" role="menu" aria-label={`Actions for ${node.name}`}>
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(edit.rename)}>
            <EditIcon size={15} /><span>Rename</span>
          </button>
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(edit.addChild)}>
            <PlusIcon size={15} /><span>Add child</span>
          </button>
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(edit.move)}>
            <ArrowRightIcon size={15} /><span>Move…</span>
          </button>
          <div className="org-kebab-divider" />
          <button type="button" className="org-kebab-item org-kebab-danger" role="menuitem" onClick={run(edit.remove)}>
            <TrashIcon size={15} /><span>Delete</span>
          </button>
        </div>
      )}
    </span>
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

function OutlineLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  return <ul className="org-tree">{roots.map((n) => <OutlineNode key={n.id} node={n} depth={0} defs={defs} cf={cf} />)}</ul>
}

// ── Layout: Cards (each node a card, nested by level) ──
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

function CardsLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const statusKey = useMemo(() => statusFieldKey(defs), [defs])
  return (
    <div className="org-cards">
      {roots.map((n) => <CardNode key={n.id} node={n} defs={defs} cf={cf} statusKey={statusKey} />)}
    </div>
  )
}

// ── Layout: Hierarchy (top-down org chart, CSS boxes + connectors) ──
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

function HierarchyLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const statusKey = useMemo(() => statusFieldKey(defs), [defs])
  return (
    <div className="org-chart-scroll">
      <ul className="org-chart">
        {roots.map((n) => <ChartNode key={n.id} node={n} defs={defs} cf={cf} statusKey={statusKey} />)}
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

// ── Layout: Spans & Layers (org-design analytics) ──────────────────────────────
// All computation is derived purely from the existing tree — no backend calls.
// Span of control = number of DIRECT children of a node.
// Layer = depth level in the tree (root nodes = layer 1).
// Wide (over-managed): span > SPAN_WIDE_THRESHOLD  → warning
// Thin (single-report): span === 1                 → caution
// Healthy: 2..SPAN_WIDE_THRESHOLD                  → ok
// Leaves: span === 0                               → neutral (individual contributor)

const SPAN_WIDE_THRESHOLD = 7 // configurable: flag "wide / over-managed" above this

type SpanRow = {
  node: OrgTreeNode
  layer: number     // 1-indexed depth
  span: number      // direct children count
  descendants: number  // all descendants (recursive)
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

function SpansLayout({ roots }: { roots: OrgTreeNode[] }) {
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
      {/* ── Summary header ── */}
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

      {/* ── Layer summary ── */}
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

      {/* ── Per-node span breakdown ── */}
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

      {/* ── Legend ── */}
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

// ── Layout: Map (sites on a real map — ties org nodes to ISP coverage) ─────────
// Plots every node that carries a *Location* — a custom field (keyed `location`, or
// labeled "Location") holding "lat,lng" text. Read via the existing useCustomFields
// `value(node.id, key)`. No API key (OpenStreetMap tiles). Markers are L.divIcon
// pins (token-styled, colored per type) — this DELIBERATELY avoids Leaflet's default
// PNG marker icon, which 404s under Vite/bundlers.

const YEREVAN: [number, number] = [40.18, 44.51] // default center when nothing is plotted

// Marker pin colors per node type (kept in sync with the badge tones above).
function pinColor(type: string): string {
  const t = type.toLowerCase()
  if (t === 'group') return 'var(--accent)'
  if (t === 'region') return 'var(--text-2)'
  if (t === 'team') return 'var(--text-3)'
  return 'var(--text-3)'
}

// A token-styled teardrop pin as an inline SVG divIcon (no external assets).
function makePinIcon(type: string): L.DivIcon {
  const fill = pinColor(type)
  const html = `
    <span class="org-map-pin" style="color:${fill}">
      <svg width="26" height="34" viewBox="0 0 26 34" aria-hidden="true">
        <path d="M13 0C5.82 0 0 5.82 0 13c0 9.1 11.5 20.1 12 20.6a1.4 1.4 0 0 0 2 0C14.5 33.1 26 22.1 26 13 26 5.82 20.18 0 13 0z" fill="currentColor"/>
        <circle cx="13" cy="13" r="5.2" fill="#fff" fill-opacity="0.92"/>
      </svg>
    </span>`
  return L.divIcon({
    html,
    className: 'org-map-divicon',
    iconSize: [26, 34],
    iconAnchor: [13, 34],     // tip of the teardrop
    popupAnchor: [0, -30],
  })
}

// Find the location field key: prefer an explicit key === 'location', else a field
// whose label is "Location" (case-insensitive). Returns null if no such field exists.
function locationFieldKey(defs: CustomFieldDef[]): string | null {
  const byKey = defs.find((d) => d.key.toLowerCase() === 'location')
  if (byKey) return byKey.key
  const byLabel = defs.find((d) => d.label.trim().toLowerCase() === 'location')
  return byLabel ? byLabel.key : null
}

// Parse "lat,lng" (tolerating spaces) into a [lat, lng] pair, or null if invalid /
// out of range.
function parseLatLng(raw: unknown): [number, number] | null {
  if (raw == null) return null
  const parts = String(raw).split(',')
  if (parts.length !== 2) return null
  const lat = Number(parts[0].trim())
  const lng = Number(parts[1].trim())
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return [lat, lng]
}

type MapPoint = { node: OrgNode; pos: [number, number] }

// Imperatively fit the map to the plotted markers (react-leaflet has no declarative
// bounds prop). Re-fits whenever the set of points changes.
function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0].pos, 13)
      return
    }
    const bounds = L.latLngBounds(points.map((p) => p.pos))
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 })
  }, [map, points])
  return null
}

function MapLayout({ nodes, defs, cf }: { nodes: OrgNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const locKey = useMemo(() => locationFieldKey(defs), [defs])

  const points = useMemo<MapPoint[]>(() => {
    if (!locKey) return []
    const out: MapPoint[] = []
    for (const node of nodes) {
      const pos = parseLatLng(cf.value(node.id, locKey))
      if (pos) out.push({ node, pos })
    }
    return out
  }, [nodes, locKey, cf])

  // Cache one divIcon per node type so markers don't rebuild on every render.
  const iconCache = useMemo(() => new Map<string, L.DivIcon>(), [])
  const iconFor = (type: string): L.DivIcon => {
    let icon = iconCache.get(type)
    if (!icon) { icon = makePinIcon(type); iconCache.set(type, icon) }
    return icon
  }

  return (
    <div className="org-map-wrap">
      {points.length === 0 && (
        <div className="org-map-hint" role="status">
          Add a 'Location' field (lat,lng) to your org nodes via Configure → Custom fields to plot them on the map.
        </div>
      )}
      <MapContainer
        className="org-map"
        center={YEREVAN}
        zoom={11}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((p) => (
          <Marker key={p.node.id} position={p.pos} icon={iconFor(p.node.type)}>
            <Popup>
              <div className="org-map-popup">
                <div className="org-map-popup-top">
                  <span className={`badge ${toneClass(p.node.type)}`}>{p.node.type}</span>
                  <span className="org-map-popup-name">{p.node.name}</span>
                </div>
                <div className="org-map-popup-path">/{p.node.path}/</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

// ── Shared: node-type → fill color (SVG charts). Mirrors the badge tones above, but
// needs concrete CSS variables for SVG `fill` (tones recolor with the palette).
function typeFill(type: string): string {
  const t = type.toLowerCase()
  if (t === 'group') return 'var(--accent)'
  if (t === 'region') return 'var(--primary)'
  if (t === 'team') return 'var(--text-2)'
  return 'var(--text-3)'
}

// ── Layout: Sunburst (radial hierarchy) ─────────────────────────────────────────
// Root sits at the center; every depth level is a concentric ring. A node's angular
// width is proportional to its WEIGHT = descendantCount()+1 (its whole subtree), so a
// branch's slice is shared out among its children by their own weights. Pure SVG: each
// segment is an annular-sector <path> built from two arcs (`A` commands) + two radial
// edges. Colored by node type; hover/click highlights a segment and names it in the
// center. Compact — rings get thinner as depth grows, so deep trees still fit.

type SunSeg = {
  node: OrgTreeNode
  depth: number       // 0 = root ring (innermost)
  a0: number          // start angle (radians, 0 = 12 o'clock, clockwise)
  a1: number          // end angle
}

// Flatten the tree into ring segments. Each node owns the angular span [a0,a1]; its
// children divide that span in proportion to their weight (descendantCount+1).
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
  // A synthetic full circle is split across the (possibly multiple) roots by weight.
  walk(roots, 0, 0, Math.PI * 2)
  return segs
}

// Annular-sector path: from inner radius r0 to outer r1, between angles a0..a1.
// Angles measured from 12 o'clock, clockwise. cx/cy = center.
function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  // Point on circle for angle a (0 = up, clockwise positive).
  const pt = (r: number, a: number): [number, number] => [
    cx + r * Math.sin(a),
    cy - r * Math.cos(a),
  ]
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0o, y0o] = pt(r1, a0)
  const [x1o, y1o] = pt(r1, a1)
  const [x1i, y1i] = pt(r0, a1)
  const [x0i, y0i] = pt(r0, a0)
  // outer arc (sweep=1 clockwise) → line in → inner arc (sweep=0 back) → close
  return [
    `M ${x0o} ${y0o}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1o} ${y1o}`,
    `L ${x1i} ${y1i}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x0i} ${y0i}`,
    'Z',
  ].join(' ')
}

function SunburstLayout({ roots }: { roots: OrgTreeNode[] }) {
  const segs = useMemo(() => buildSunSegments(roots), [roots])
  const [active, setActive] = useState<string | null>(null)

  const SIZE = 560
  const cx = SIZE / 2
  const cy = SIZE / 2
  const maxDepth = useMemo(() => segs.reduce((m, s) => Math.max(m, s.depth), 0), [segs])
  // Center hole + thinner rings as we go deeper (keeps deep trees compact).
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
          // tiny gap between rings so segments read as distinct
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
        {/* Center label: the hovered/selected node, else a hint. */}
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

// ── Layout: Treemap (nested rectangles, area ∝ metric) ──────────────────────────
// Each node's METRIC prefers a 'headcount' custom field — Number(cf.value(id,'headcount'))
// when present and numeric — otherwise falls back to descendantCount()+1 (subtree size).
// We lay out the LEAVES of the tree (every node with no children) via a squarified
// treemap so rectangle areas read against each other. Labeled with name + metric,
// colored by node type. Pure layout math — no dependency.

function metricFor(node: OrgTreeNode, cf: CFApi): number {
  // Prefer a 'headcount' custom field if it's present and numeric.
  const raw = cf.value(node.id, 'headcount')
  if (raw != null && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  // Fallback: subtree size (the node itself + all descendants).
  return descendantCount(node) + 1
}

// Collect leaves (nodes with no children) — the cells that get rectangles.
function collectLeaves(roots: OrgTreeNode[]): OrgTreeNode[] {
  const out: OrgTreeNode[] = []
  const walk = (nodes: OrgTreeNode[]) => {
    for (const n of nodes) {
      if (n.children.length === 0) out.push(n)
      else walk(n.children)
    }
  }
  walk(roots)
  return out
}

type TmRect = { node: OrgTreeNode; metric: number; x: number; y: number; w: number; h: number }
type TmRow = { x: number; y: number; w: number; h: number }

// Squarified treemap (Bruls/Huizing/van Wijk). Items are pre-sorted descending by
// metric; we fill the shorter side first to keep aspect ratios near 1.
function squarify(
  items: { node: OrgTreeNode; metric: number }[],
  x: number, y: number, w: number, h: number,
): TmRect[] {
  const out: TmRect[] = []
  const totalArea = w * h
  const totalMetric = items.reduce((s, it) => s + it.metric, 0)
  if (totalMetric <= 0 || totalArea <= 0) return out
  // Scale metrics → pixel area.
  const scaled = items.map((it) => ({ node: it.node, metric: it.metric, area: (it.metric / totalMetric) * totalArea }))

  const worst = (row: { area: number }[], side: number): number => {
    const sum = row.reduce((s, r) => s + r.area, 0)
    const max = Math.max(...row.map((r) => r.area))
    const min = Math.min(...row.map((r) => r.area))
    const s2 = side * side
    const sum2 = sum * sum
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min))
  }

  let rect: TmRow = { x, y, w, h }
  let i = 0
  while (i < scaled.length) {
    const side = Math.min(rect.w, rect.h)
    const row: typeof scaled = [scaled[i]]
    i++
    // Greedily add to the current row while it improves (lowers worst aspect ratio).
    while (i < scaled.length) {
      const withNext = [...row, scaled[i]]
      if (worst(withNext, side) <= worst(row, side)) { row.push(scaled[i]); i++ }
      else break
    }
    // Lay the row along the shorter side, advancing the longer side.
    const rowArea = row.reduce((s, r) => s + r.area, 0)
    if (rect.w <= rect.h) {
      const rowH = rowArea / rect.w
      let cx = rect.x
      for (const r of row) {
        const cw = r.area / rowH
        out.push({ node: r.node, metric: r.metric, x: cx, y: rect.y, w: cw, h: rowH })
        cx += cw
      }
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH }
    } else {
      const rowW = rowArea / rect.h
      let cy = rect.y
      for (const r of row) {
        const ch = r.area / rowW
        out.push({ node: r.node, metric: r.metric, x: rect.x, y: cy, w: rowW, h: ch })
        cy += ch
      }
      rect = { x: rect.x + rowW, y: rect.y, w: rect.w - rowW, h: rect.h }
    }
  }
  return out
}

function TreemapLayout({ roots, cf }: { roots: OrgTreeNode[]; cf: CFApi }) {
  const W = 1000
  const H = 560
  const PAD = 2

  const rects = useMemo(() => {
    const leaves = collectLeaves(roots)
    const items = leaves
      .map((node) => ({ node, metric: metricFor(node, cf) }))
      .filter((it) => it.metric > 0)
      .sort((a, b) => b.metric - a.metric)
    return squarify(items, 0, 0, W, H)
  }, [roots, cf])

  if (rects.length === 0) {
    return <div className="org-empty muted">No leaf nodes to lay out.</div>
  }

  return (
    <div className="org-treemap">
      <svg
        className="org-treemap-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Organization treemap"
      >
        {rects.map((r) => {
          const w = Math.max(0, r.w - PAD)
          const h = Math.max(0, r.h - PAD)
          const showLabel = w > 54 && h > 26
          const showMetric = w > 54 && h > 44
          return (
            <g key={r.node.id} className="org-tm-cell" transform={`translate(${r.x + PAD / 2} ${r.y + PAD / 2})`}>
              <rect
                width={w}
                height={h}
                rx={4}
                className="org-tm-rect"
                style={{ fill: typeFill(r.node.type) }}
              >
                <title>{`${r.node.name} — ${r.node.type} · metric ${r.metric}`}</title>
              </rect>
              {showLabel && (
                <text x={8} y={18} className="org-tm-name" clipPath="none">
                  {r.node.name}
                </text>
              )}
              {showMetric && (
                <text x={8} y={34} className="org-tm-metric">
                  {r.node.type} · {r.metric}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="org-sun-legend">
        {['Group', 'Region', 'Team'].map((t) => (
          <span key={t} className="org-sun-legend-item">
            <span className="org-sun-swatch" style={{ background: typeFill(t) }} aria-hidden="true" />
            {t}
          </span>
        ))}
        <span className="muted org-sun-hint">Area ∝ headcount (custom field) or subtree size.</span>
      </div>
    </div>
  )
}

// ── Shared: flatten the tree to (node, depth, parentId) rows in document order ──
// Used by Network / Heatmap / Timeline — they all need depth + the parent link.
type FlatRow = { node: OrgTreeNode; depth: number; parentId: string | null }
function flattenTree(roots: OrgTreeNode[]): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (nodes: OrgTreeNode[], depth: number, parentId: string | null) => {
    for (const n of nodes) {
      out.push({ node: n, depth, parentId })
      if (n.children.length > 0) walk(n.children, depth + 1, n.id)
    }
  }
  walk(roots, 0, null)
  return out
}

// ── Layout: Network graph (force-directed node-link diagram) ────────────────────
// Pure SVG + a tiny hand-rolled force simulation (matching the no-dependency pattern the
// Sunburst/Treemap already set — there is NO d3 in this project). The sim runs on rAF in a
// ref, mutating x/y in place, and is ALWAYS cancelled on unmount (cancelAnimationFrame) to
// avoid React-18 leak warnings. Circle radius ∝ subtree size (descendantCount+1); fill by type.
// Links are the parent→child edges. Layout is the org tree, so this reads as a relationship map.

type SimNode = { id: string; node: OrgTreeNode; x: number; y: number; vx: number; vy: number; r: number }
type SimLink = { source: string; target: string }

function NetworkLayout({ roots }: { roots: OrgTreeNode[] }) {
  const W = 1000
  const H = 600
  const svgRef = useRef<SVGSVGElement>(null)
  const [, force] = useState(0) // re-render tick: bump to flush mutated positions to the DOM
  const [active, setActive] = useState<string | null>(null)

  // Build the (stable) node + link sets from the tree. Radius scales with subtree size.
  const { simNodes, simLinks } = useMemo(() => {
    const flat = flattenTree(roots)
    const maxSub = flat.reduce((m, f) => Math.max(m, descendantCount(f.node) + 1), 1)
    // Seed positions on a spiral around center so the sim untangles quickly + deterministically.
    const sn: SimNode[] = flat.map((f, i) => {
      const sub = descendantCount(f.node) + 1
      const ang = i * 2.399963 // golden-angle spread
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

  // The simulation. Refs (not state) hold the mutating arrays so rAF never restarts the effect.
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
    let alpha = 1 // cooling factor: high = lots of movement, decays toward 0

    const tick = () => {
      const cx = W / 2
      const cy = H / 2
      // 1) Mild centering gravity (keeps the graph on-screen).
      for (const n of nodes) {
        n.vx += (cx - n.x) * 0.0009 * alpha
        n.vy += (cy - n.y) * 0.0009 * alpha
      }
      // 2) Pairwise repulsion (Coulomb-ish, O(n²) — fine for org sizes).
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
      // 3) Spring attraction along parent→child links toward a target length.
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
      // 4) Integrate with damping + clamp inside the viewBox.
      for (const n of nodes) {
        n.vx *= 0.82; n.vy *= 0.82
        n.x += n.vx; n.y += n.vy
        n.x = Math.max(n.r, Math.min(W - n.r, n.x))
        n.y = Math.max(n.r, Math.min(H - n.r, n.y))
      }
      alpha *= 0.992
      force((c) => c + 1) // flush mutated positions to React
      if (alpha > 0.02) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // MUST clean up: cancel the rAF so the cooling loop can't run after unmount.
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

// ── Layout: Heatmap (nodes laid out by depth, colored by a metric) ──────────────
// Default metric = descendantCount (subtree weight); when a numeric 'headcount' custom field
// exists, the user can toggle to headcount. Cells are grouped into rows by depth (layer) and
// tinted along a sequential scale (accent at the high end). A legend shows the scale + range.

type HeatMetric = 'descendants' | 'headcount'

// Mix two hex colors by t∈[0,1]. Used to build the sequential color ramp from a faint
// surface tint up to the brand accent. Works on #RRGGBB inputs only.
function mixHex(from: string, to: string, t: number): string {
  const f = parseInt(from.slice(1), 16)
  const g = parseInt(to.slice(1), 16)
  const fr = (f >> 16) & 255, fg = (f >> 8) & 255, fb = f & 255
  const gr = (g >> 16) & 255, gg = (g >> 8) & 255, gb = g & 255
  const r = Math.round(fr + (gr - fr) * t)
  const gn = Math.round(fg + (gg - fg) * t)
  const b = Math.round(fb + (gb - fb) * t)
  return `#${((1 << 24) + (r << 16) + (gn << 8) + b).toString(16).slice(1)}`
}

// Whether a numeric 'headcount' custom field is configured (offers the headcount metric toggle).
function hasHeadcountField(defs: CustomFieldDef[]): boolean {
  return defs.some((d) => d.type === 'number' && (d.key.toLowerCase() === 'headcount' || d.label.trim().toLowerCase() === 'headcount'))
}

function HeatmapLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const offerHeadcount = useMemo(() => hasHeadcountField(defs), [defs])
  const [metric, setMetric] = useState<HeatMetric>('descendants')
  const effMetric: HeatMetric = metric === 'headcount' && offerHeadcount ? 'headcount' : 'descendants'

  const flat = useMemo(() => flattenTree(roots), [roots])

  // Value per node for the active metric (headcount falls back to 0 when unset).
  const valueOf = (n: OrgTreeNode): number => {
    if (effMetric === 'headcount') {
      const raw = cf.value(n.id, 'headcount')
      const v = raw != null && raw !== '' ? Number(raw) : NaN
      return Number.isFinite(v) ? v : 0
    }
    return descendantCount(n)
  }

  const rowsByDepth = useMemo(() => {
    const map = new Map<number, FlatRow[]>()
    for (const f of flat) {
      const arr = map.get(f.depth) ?? []
      arr.push(f)
      map.set(f.depth, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [flat])

  const max = useMemo(() => flat.reduce((m, f) => Math.max(m, valueOf(f.node)), 0), [flat, effMetric, cf])

  if (flat.length === 0) {
    return <div className="org-empty muted">No organization nodes to map.</div>
  }

  // Sequential ramp: faint surface-2 (low) → brand accent (high). Inline so SVG-free CSS vars
  // aren't needed; the endpoints are the dark-theme tokens' literal hexes.
  const LOW = '#262D37'  // --surface-2 (dark)
  const HIGH = '#C5A059' // --accent
  const tint = (v: number): string => (max <= 0 ? LOW : mixHex(LOW, HIGH, Math.min(1, v / max)))
  const metricLabel = effMetric === 'headcount' ? 'Headcount' : 'Descendants'

  return (
    <div className="org-heatmap">
      <div className="org-heatmap-toolbar">
        <span className="org-heatmap-metric-label">Metric:</span>
        <div className="org-heatmap-toggle" role="group" aria-label="Heatmap metric">
          <button
            type="button"
            className={`org-heatmap-toggle-btn${effMetric === 'descendants' ? ' on' : ''}`}
            onClick={() => setMetric('descendants')}
          >Descendants</button>
          {offerHeadcount && (
            <button
              type="button"
              className={`org-heatmap-toggle-btn${effMetric === 'headcount' ? ' on' : ''}`}
              onClick={() => setMetric('headcount')}
            >Headcount</button>
          )}
        </div>
      </div>

      <div className="org-heatmap-grid">
        {rowsByDepth.map(([depth, items]) => (
          <div key={depth} className="org-heatmap-row">
            <span className="org-heatmap-rowlabel">Layer {depth + 1}</span>
            <div className="org-heatmap-cells">
              {items.map((f) => {
                const v = valueOf(f.node)
                // Light text on dark/saturated tints, dark text on faint ones.
                const lit = max > 0 && v / max > 0.45
                return (
                  <div
                    key={f.node.id}
                    className="org-heatmap-cell"
                    style={{ background: tint(v), color: lit ? '#1A1F26' : 'var(--text-2)' }}
                    title={`${f.node.name} — ${f.node.type} · ${metricLabel} ${v}`}
                  >
                    <span className="org-heatmap-cell-name">{f.node.name}</span>
                    <span className="org-heatmap-cell-val">{v}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="org-heatmap-legend">
        <span className="org-heatmap-legend-label">{metricLabel}</span>
        <span className="org-heatmap-legend-min muted">0</span>
        <span className="org-heatmap-legend-ramp" style={{ background: `linear-gradient(90deg, ${LOW}, ${HIGH})` }} aria-hidden="true" />
        <span className="org-heatmap-legend-max muted">{max}</span>
      </div>
    </div>
  )
}

// ── Layout: Timeline (v1 — STRUCTURAL progression, not temporal) ────────────────
// There is no temporal data on org nodes yet, so we deliberately DO NOT fake dates. Instead this
// v1 sorts nodes by DEPTH (root at the left → deepest at the right) and lays them out along a
// horizontal axis as a structural-progression placeholder. A caption makes the v1 nature explicit.

function TimelineLayout({ roots }: { roots: OrgTreeNode[] }) {
  const flat = useMemo(() => flattenTree(roots), [roots])
  const maxDepth = useMemo(() => flat.reduce((m, f) => Math.max(m, f.depth), 0), [flat])

  const cols = useMemo(() => {
    const map = new Map<number, FlatRow[]>()
    for (const f of flat) {
      const arr = map.get(f.depth) ?? []
      arr.push(f)
      map.set(f.depth, arr)
    }
    const out: { depth: number; items: FlatRow[] }[] = []
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

// ── Layout: RACI Matrix (v1 — Responsible / Accountable / Consulted / Informed) ──
// Gev-authorized. Rows = org nodes, columns = R/A/C/I. We populate cells ONLY from a configured
// RACI-style custom field; we do NOT fabricate assignments. If none is configured (the likely
// current state) we render the matrix SCAFFOLD with an honest empty state telling the admin how to
// wire it up. The RACI field, when present, holds a comma/space-separated set of letters (e.g.
// "R, A" or "RACI") per node — we just light the matching column.

const RACI_COLS: { key: 'R' | 'A' | 'C' | 'I'; label: string; full: string }[] = [
  { key: 'R', label: 'R', full: 'Responsible' },
  { key: 'A', label: 'A', full: 'Accountable' },
  { key: 'C', label: 'C', full: 'Consulted' },
  { key: 'I', label: 'I', full: 'Informed' },
]

// Find a RACI custom field: explicit key === 'raci', else label "RACI" (case-insensitive).
function raciFieldKey(defs: CustomFieldDef[]): string | null {
  const byKey = defs.find((d) => d.key.toLowerCase() === 'raci')
  if (byKey) return byKey.key
  const byLabel = defs.find((d) => d.label.trim().toLowerCase() === 'raci')
  return byLabel ? byLabel.key : null
}

// Parse a node's RACI value into the set of lit columns. Accepts "R,A", "R A", "RACI", etc.
function parseRaci(raw: unknown): Set<'R' | 'A' | 'C' | 'I'> {
  const out = new Set<'R' | 'A' | 'C' | 'I'>()
  if (raw == null) return out
  const s = String(raw).toUpperCase()
  for (const ch of ['R', 'A', 'C', 'I'] as const) if (s.includes(ch)) out.add(ch)
  return out
}

function RaciLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const raciKey = useMemo(() => raciFieldKey(defs), [defs])
  const flat = useMemo(() => flattenTree(roots), [roots])

  if (flat.length === 0) {
    return <div className="org-empty muted">No organization nodes for the RACI matrix.</div>
  }

  return (
    <div className="org-raci">
      {!raciKey && (
        <div className="org-raci-empty" role="status">
          No RACI assignments configured yet — add a <strong>RACI</strong> custom field (a text field
          keyed/labelled “RACI”) via Configure → Custom fields, then set each node’s value to the
          letters that apply (e.g. <code>R, A</code>). The matrix scaffold below shows the structure;
          cells stay empty until that field exists.
        </div>
      )}
      <div className="grid-wrap">
        <table className="grid org-raci-table">
          <thead>
            <tr>
              <th scope="col">Node</th>
              <th scope="col">Type</th>
              {RACI_COLS.map((c) => (
                <th key={c.key} scope="col" className="org-raci-col" title={c.full}>
                  <span className="org-raci-colcode">{c.label}</span>
                  <span className="org-raci-colname">{c.full}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flat.map((f) => {
              const lit = raciKey ? parseRaci(cf.value(f.node.id, raciKey)) : new Set<'R' | 'A' | 'C' | 'I'>()
              return (
                <tr key={f.node.id}>
                  <td className="org-raci-node" style={{ paddingLeft: 8 + f.depth * 16 }}>{f.node.name}</td>
                  <td><span className={`badge ${toneClass(f.node.type)}`}>{f.node.type}</span></td>
                  {RACI_COLS.map((c) => (
                    <td key={c.key} className="org-raci-cell">
                      {lit.has(c.key)
                        ? <span className={`org-raci-mark org-raci-${c.key}`} title={`${c.full} — ${f.node.name}`}>{c.label}</span>
                        : <span className="org-raci-dot" aria-hidden="true" />}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="org-raci-legend">
        {RACI_COLS.map((c) => (
          <span key={c.key} className="org-raci-legend-item">
            <span className={`org-raci-mark org-raci-${c.key}`}>{c.label}</span>
            <span className="muted">{c.full}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Structure-editing modals ────────────────────────────────────────────────────
// Reuse the shared Modal (Overlay-based, focus-trapped, Esc/click-outside) — same primitive
// ProfileModal/SecurityModal use. Each modal owns its draft state + busy/error, calls the api
// client, then onDone() (which re-fetches via OrgView's onRefresh) and closes.

// What the editing layer is acting on: a structure op + the node it targets (null for top-level add).
type EditState =
  | { kind: 'add'; parent: OrgNode | null }
  | { kind: 'rename'; node: OrgNode }
  | { kind: 'move'; node: OrgNode }
  | { kind: 'delete'; node: OrgNode }
  | null

// Add / Add-child: type + name + code. `parent` is locked when adding a child (shown read-only).
function AddNodeModal({ token, parent, onClose, onDone }: {
  token: string; parent: OrgNode | null; onClose: () => void; onDone: () => Promise<void>
}) {
  const [type, setType] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!type.trim() || !name.trim()) { setErr('Type and name are required.'); return }
    setBusy(true); setErr('')
    try {
      await createOrgNode(token, {
        type: type.trim(),
        name: name.trim(),
        code: code.trim() || undefined,
        parent_id: parent ? parent.id : null,
      })
      toast.success(`Created “${name.trim()}”`)
      await onDone()
      onClose()
    } catch (e2) {
      setErr((e2 as Error).message || 'Failed to create node.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={parent ? `Add child to “${parent.name}”` : 'Add node'} size="sm">
      <form className="org-edit-form" onSubmit={submit}>
        {parent && (
          <label className="field-block">
            <span className="field-label">Parent</span>
            <input className="inp inp-md" value={parent.name} disabled aria-label="Parent" />
          </label>
        )}
        <label className="field-block">
          <span className="field-label">Type</span>
          <input
            className="inp inp-md" value={type} autoFocus
            onChange={(e) => setType(e.target.value)}
            placeholder="e.g. Region, Team, Department"
            aria-label="Type"
          />
        </label>
        <label className="field-block">
          <span className="field-label">Name</span>
          <input
            className="inp inp-md" value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            aria-label="Name"
          />
        </label>
        <label className="field-block">
          <span className="field-label">Code <span className="muted">(optional)</span></span>
          <input
            className="inp inp-md" value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Defaults to a slug of the name"
            aria-label="Code"
          />
        </label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="org-edit-foot">
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-md" disabled={busy || !type.trim() || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// Rename: single name field, prefilled.
function RenameNodeModal({ token, node, onClose, onDone }: {
  token: string; node: OrgNode; onClose: () => void; onDone: () => Promise<void>
}) {
  const [name, setName] = useState(node.name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setErr('Name cannot be empty.'); return }
    setBusy(true); setErr('')
    try {
      await renameOrgNode(token, node.id, trimmed)
      toast.success('Renamed')
      await onDone()
      onClose()
    } catch (e2) {
      setErr((e2 as Error).message || 'Failed to rename node.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Rename node" size="sm">
      <form className="org-edit-form" onSubmit={submit}>
        <label className="field-block">
          <span className="field-label">Name</span>
          <input
            className="inp inp-md" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
          />
        </label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="org-edit-foot">
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-md" disabled={busy || !name.trim() || name.trim() === node.name}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// Set of a node's own id + every descendant id — the candidates a Move must EXCLUDE so a node can
// never be moved under itself or its own subtree (which the backend also rejects, but excluding
// them keeps illegal targets out of the picker entirely).
function selfAndDescendantIds(rootId: string, nodes: OrgNode[]): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parent_id != null) {
      const arr = childrenOf.get(n.parent_id) ?? []
      arr.push(n.id)
      childrenOf.set(n.parent_id, arr)
    }
  }
  const out = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const child of childrenOf.get(cur) ?? []) {
      if (!out.has(child)) { out.add(child); stack.push(child) }
    }
  }
  return out
}

// Move: searchable parent picker. Excludes the node itself + its descendants (no cycles) AND the
// node's current parent (a no-op). A "Top level (root)" option moves the node to the root.
function MoveNodeModal({ token, node, nodes, onClose, onDone }: {
  token: string; node: OrgNode; nodes: OrgNode[]; onClose: () => void; onDone: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<string | null>(null) // null = nothing chosen; '' = root
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // byId for path display; banned = cycle-creating targets.
  const banned = useMemo(() => selfAndDescendantIds(node.id, nodes), [node.id, nodes])
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return nodes
      .filter((n) => !banned.has(n.id) && n.id !== node.parent_id)
      .filter((n) => !q || n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
  }, [nodes, banned, node.parent_id, query])

  const rootAllowed = node.parent_id != null // already at root ⇒ moving to root is a no-op

  async function doMove() {
    if (target === null) return
    setBusy(true); setErr('')
    try {
      await moveOrgNode(token, node.id, target === '' ? null : target)
      toast.success(`Moved “${node.name}”`)
      await onDone()
      onClose()
    } catch (e2) {
      setErr((e2 as Error).message || 'Failed to move node.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Move “${node.name}”`} size="sm">
      <div className="org-edit-form">
        <div className="org-search org-move-search">
          <SearchIcon size={15} />
          <input
            type="text" className="org-search-input" value={query} autoFocus
            placeholder="Search a new parent…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search parent nodes"
          />
        </div>
        <div className="org-move-list" role="listbox" aria-label="Candidate parents">
          {rootAllowed && (!query.trim() || 'top level root'.includes(query.trim().toLowerCase())) && (
            <button
              type="button" role="option" aria-selected={target === ''}
              className={'org-move-opt' + (target === '' ? ' on' : '')}
              onClick={() => setTarget('')}
            >
              <span className="org-move-opt-name">Top level (root)</span>
              <span className="org-move-opt-path muted">no parent</span>
            </button>
          )}
          {candidates.length === 0 ? (
            <div className="org-move-empty muted">No eligible parent matches.</div>
          ) : candidates.map((n) => (
            <button
              key={n.id} type="button" role="option" aria-selected={target === n.id}
              className={'org-move-opt' + (target === n.id ? ' on' : '')}
              onClick={() => setTarget(n.id)}
            >
              <span className={`badge ${toneClass(n.type)}`}>{n.type}</span>
              <span className="org-move-opt-name">{n.name}</span>
              <span className="org-move-opt-path muted">/{n.path}/</span>
            </button>
          ))}
        </div>
        <p className="hint">A node can’t move under itself or its own descendants — those are hidden.</p>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="org-edit-foot">
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary btn-md" onClick={doMove} disabled={busy || target === null}>
            {busy ? 'Moving…' : 'Move here'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// Delete: confirmation. The backend returns 409 when the node has children — surface that message
// inline instead of failing silently.
function DeleteNodeModal({ token, node, onClose, onDone }: {
  token: string; node: OrgNode; onClose: () => void; onDone: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function doDelete() {
    setBusy(true); setErr('')
    try {
      await deleteOrgNode(token, node.id)
      toast.success(`Deleted “${node.name}”`)
      await onDone()
      onClose()
    } catch (e2) {
      // 409 = node still has children; show the backend's clear message rather than a silent failure.
      const msg = e2 instanceof OrgWriteError && e2.status === 409
        ? e2.message
        : (e2 as Error).message || 'Failed to delete node.'
      setErr(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Delete node" size="sm">
      <div className="org-edit-form">
        <p>Delete <strong>{node.name}</strong>? This can’t be undone.</p>
        <p className="hint">A node that still has children can’t be deleted — delete or move its children first.</p>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="org-edit-foot">
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-danger btn-md" onClick={doDelete} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const SWITCHER: { id: OrgLayout; label: string; Icon: typeof LayersIcon }[] = [
  { id: 'hierarchy', label: 'Hierarchy', Icon: ChartIcon },
  { id: 'cards', label: 'Cards', Icon: PackageIcon },
  { id: 'outline', label: 'Outline', Icon: LayersIcon },
  { id: 'list', label: 'List', Icon: RowsIcon },
  { id: 'grouped', label: 'Grouped', Icon: MapIcon },
  { id: 'spans', label: 'Spans', Icon: ActivityIcon },
  { id: 'map', label: 'Map', Icon: GlobeIcon },
  { id: 'sunburst', label: 'Sunburst', Icon: SunIcon },
  { id: 'treemap', label: 'Treemap', Icon: ServerIcon },
  { id: 'network', label: 'Network', Icon: UsersIcon },
  { id: 'heatmap', label: 'Heatmap', Icon: BuildingIcon },
  { id: 'timeline', label: 'Timeline', Icon: CalendarIcon },
  { id: 'raci', label: 'RACI', Icon: ShieldIcon },
]

export default function OrgView({ nodes, token, configVersion, canConfigure = false, onRefresh }: {
  nodes: OrgNode[]
  token: string
  configVersion: number
  canConfigure?: boolean        // config.manage — gates the structure-editing controls
  onRefresh?: () => Promise<void>  // re-fetch the org tree after a successful write
}) {
  const cfg = usePageConfig(token, 'org', configVersion)
  const [layout, setLayout] = useState<OrgLayout>(loadLayout)
  const roots = useMemo(() => buildTree(nodes), [nodes])

  // Custom fields (superadmin-added on the Org page) carried on every node: editable in List
  // (table cells) + Cards/Hierarchy (label:value chips); read-only compact in Outline/Grouped.
  const allNodeIds = useMemo(() => nodes.map((n) => n.id), [nodes])
  const cf = useCustomFields(token, 'org', cfg.customFields, allNodeIds)
  const defs = cfg.customFields

  // Structure editing: which op the user opened (or null). Published to the kebabs via context.
  const [editState, setEditState] = useState<EditState>(null)
  const editing = canConfigure && !!onRefresh
  const edit = useMemo<OrgEdit | null>(() => {
    if (!editing) return null
    return {
      rename: (node) => setEditState({ kind: 'rename', node }),
      addChild: (node) => setEditState({ kind: 'add', parent: node }),
      move: (node) => setEditState({ kind: 'move', node }),
      remove: (node) => setEditState({ kind: 'delete', node }),
    }
  }, [editing])
  // After any successful write, re-fetch the tree (onRefresh is supplied by the parent).
  const refresh = async () => { if (onRefresh) await onRefresh() }

  const choose = (next: OrgLayout) => {
    setLayout(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  }

  return (
    <OrgEditContext.Provider value={edit}>
    <div className="org-view">
      <div className="view-head">
        <div className="view-icon"><LayersIcon size={20} /></div>
        <div className="view-title-wrap">
          <h2>{cfg.title}</h2>
          <span className="view-sub">Organization hierarchy</span>
        </div>
        {editing && (
          <div className="view-head-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm org-add-node-btn"
              onClick={() => setEditState({ kind: 'add', parent: null })}
            >
              <PlusIcon size={14} /> <span>Add node</span>
            </button>
          </div>
        )}
      </div>

      {/* The layout switcher is a wide 13-tab segmented control, so it gets its own
          full-width row below the title rather than being crammed into the header
          actions slot (which is sized for a single button and would otherwise wrap
          on top of the title). */}
      <div className="org-switcher-row">
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

      {roots.length === 0 ? (
        <div className="org-empty muted">
          No organization nodes yet.
          {editing && (
            <>
              {' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditState({ kind: 'add', parent: null })}>
                <PlusIcon size={14} /> Add the first node
              </button>
            </>
          )}
        </div>
      ) : layout === 'hierarchy' ? (
        <HierarchyLayout roots={roots} defs={defs} cf={cf} />
      ) : layout === 'cards' ? (
        <CardsLayout roots={roots} defs={defs} cf={cf} />
      ) : layout === 'outline' ? (
        <OutlineLayout roots={roots} defs={defs} cf={cf} />
      ) : layout === 'list' ? (
        <ListLayout nodes={nodes} cf={cf} />
      ) : layout === 'spans' ? (
        <SpansLayout roots={roots} />
      ) : layout === 'map' ? (
        <MapLayout nodes={nodes} defs={defs} cf={cf} />
      ) : layout === 'sunburst' ? (
        <SunburstLayout roots={roots} />
      ) : layout === 'treemap' ? (
        <TreemapLayout roots={roots} cf={cf} />
      ) : layout === 'network' ? (
        <NetworkLayout roots={roots} />
      ) : layout === 'heatmap' ? (
        <HeatmapLayout roots={roots} defs={defs} cf={cf} />
      ) : layout === 'timeline' ? (
        <TimelineLayout roots={roots} />
      ) : layout === 'raci' ? (
        <RaciLayout roots={roots} defs={defs} cf={cf} />
      ) : (
        <GroupedLayout roots={roots} defs={defs} cf={cf} />
      )}

      {/* Structure-editing modals — one mounted at a time per editState. */}
      {editState?.kind === 'add' && (
        <AddNodeModal token={token} parent={editState.parent} onClose={() => setEditState(null)} onDone={refresh} />
      )}
      {editState?.kind === 'rename' && (
        <RenameNodeModal token={token} node={editState.node} onClose={() => setEditState(null)} onDone={refresh} />
      )}
      {editState?.kind === 'move' && (
        <MoveNodeModal token={token} node={editState.node} nodes={nodes} onClose={() => setEditState(null)} onDone={refresh} />
      )}
      {editState?.kind === 'delete' && (
        <DeleteNodeModal token={token} node={editState.node} onClose={() => setEditState(null)} onDone={refresh} />
      )}
    </div>
    </OrgEditContext.Provider>
  )
}
