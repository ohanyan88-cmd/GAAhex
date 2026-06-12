// OrgPage — the single "Organisation" page (one page, three facets, an SST other modules lean on).
//   1. Hierarchy   → editable DEPARTMENT chart: CEO → departments → sub-units. Each card has an
//                    inline-editable name + a fixed department SVG icon (not user-choosable). Add /
//                    lock / move / delete, and re-wire by dragging a card's grip onto another.
//                    Local state only (UI-first; the backend model follows).
//   2. Branches    → geography (country → region → city → branch + addresses) — Region kernel data.
//   3. Departments → the "department corner" (scope shaped live by Gev).
//
// Reached at /org. Top tabs reuse the existing .org-switcher segmented control.
import { useState, type ReactNode } from 'react'
import { Lock, Unlock, Plus, Minus, Trash2, ChevronUp, ChevronDown, GripVertical, Building2, Crown, TrendingUp, Wrench, Headphones, Receipt, Briefcase } from 'lucide-react'
import { PageShell } from '../page-shell'
import { ChartIcon, MapIcon, LayersIcon, BuildingIcon } from '../components/icons'

type Tab = 'hierarchy' | 'branches' | 'departments'

const TABS: { id: Tab; label: string; Icon: typeof ChartIcon }[] = [
  { id: 'hierarchy',   label: 'Hierarchy',   Icon: ChartIcon },
  { id: 'branches',    label: 'Branches',    Icon: MapIcon },
  { id: 'departments', label: 'Departments', Icon: LayersIcon },
]

// ── Hierarchy: editable department tree (UI-first; local state) ──────────────────────────────────
type Unit = { id: string; name: string; locked?: boolean; children?: Unit[] }
type RawUnit = { name: string; locked?: boolean; children?: RawUnit[] }

const ORG_SEED: RawUnit = {
  name: 'CEO',
  children: [
    {
      name: 'COMMERCIAL',
      children: [
        { name: 'SALES' },
        { name: 'MARKETING' },
      ],
    },
    {
      name: 'TECHNICAL',
      children: [
        { name: 'On-Site Support' },
        { name: 'Service Installation' },
        { name: 'Network Construction' },
        { name: 'NOC' },
        { name: 'Service Fulfillment' },
      ],
    },
    {
      name: 'CUSTOMER CARE',
      children: [
        { name: 'Call Center & Customer Support' },
        { name: 'Retention & Loyalty' },
      ],
    },
    {
      name: 'BILLING & REVENUE',
      children: [
        { name: 'Billing Operations & Support' },
        { name: 'Activations' },
      ],
    },
    {
      name: 'ADMINISTRATIVE',
      children: [
        { name: 'Finance' },
        { name: 'Procurement' },
        { name: 'HR' },
      ],
    },
  ],
}

const newId = () => crypto.randomUUID()
function withIds(n: RawUnit): Unit {
  return { id: newId(), name: n.name, locked: n.locked, children: n.children?.map(withIds) }
}
function updateNode(n: Unit, id: string, fn: (u: Unit) => Unit): Unit {
  if (n.id === id) return fn(n)
  return n.children ? { ...n, children: n.children.map((c) => updateNode(c, id, fn)) } : n
}
function removeNode(n: Unit, id: string): Unit {
  if (!n.children) return n
  return { ...n, children: n.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)) }
}
function moveNode(n: Unit, id: string, dir: -1 | 1): Unit {
  if (!n.children) return n
  const idx = n.children.findIndex((c) => c.id === id)
  if (idx !== -1) {
    const j = idx + dir
    if (j < 0 || j >= n.children.length) return n
    const next = [...n.children]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    return { ...n, children: next }
  }
  return { ...n, children: n.children.map((c) => moveNode(c, id, dir)) }
}
function contains(n: Unit, id: string): boolean {
  return n.id === id || (n.children ?? []).some((c) => contains(c, id))
}
function findNode(n: Unit, id: string): Unit | null {
  if (n.id === id) return n
  for (const c of n.children ?? []) { const f = findNode(c, id); if (f) return f }
  return null
}
// Re-wire: make `dragId` a child of `targetId`. Refuses to move the root, onto itself, or under its
// own subtree (would orphan the tree).
function reparent(tree: Unit, dragId: string, targetId: string): Unit {
  if (dragId === targetId || dragId === tree.id) return tree
  const dragNode = findNode(tree, dragId)
  if (!dragNode || contains(dragNode, targetId)) return tree
  const without = removeNode(tree, dragId)
  return updateNode(without, targetId, (t) => ({ ...t, children: [...(t.children ?? []), dragNode] }))
}

// One brand colour + unique icon per top-level department; descendants inherit their department's.
const DEPT_COLORS = ['oc-c-cobalt', 'oc-c-green', 'oc-c-amber', 'oc-c-violet', 'oc-c-azure']
const DEPT_ICONS = [TrendingUp, Wrench, Headphones, Receipt, Briefcase]
const ROOT_ICON = Crown

type Ops = {
  add: (id: string) => void
  rename: (id: string, value: string) => void
  del: (id: string) => void
  move: (id: string, dir: -1 | 1) => void
  toggleLock: (id: string) => void
  dragId: string | null
  setDragId: (id: string | null) => void
  reparent: (dragId: string, targetId: string) => void
}

function OrgCard({ node, isRoot, colorClass, Icon, ops }: { node: Unit; isRoot: boolean; colorClass: string; Icon: typeof Building2; ops: Ops }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <div
      className={`oc-card ${colorClass}${isRoot ? ' is-root' : ''}${ops.dragId === node.id ? ' is-dragging' : ''}`}
      onDragOver={(e) => { if (ops.dragId && ops.dragId !== node.id) e.preventDefault() }}
      onDrop={(e) => { e.preventDefault(); if (ops.dragId) ops.reparent(ops.dragId, node.id) }}
    >
      <div className="oc-card-top">
        <div className="oc-card-main">
          <div className="oc-name-row">
            {!isRoot && (
              <span
                className="oc-grip"
                draggable
                title="Drag to re-wire"
                aria-label="Drag to re-wire"
                onDragStart={(e) => { ops.setDragId(node.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id) }}
                onDragEnd={() => ops.setDragId(null)}
              ><GripVertical size={14} /></span>
            )}
            <input
              className="oc-name-edit"
              value={node.name}
              placeholder="Department"
              onChange={(e) => ops.rename(node.id, e.target.value)}
              aria-label="Department name"
            />
            {node.locked && <Lock size={12} className="oc-card-lock" aria-label="Locked" />}
          </div>
          <div className="oc-card-meta">{node.children && node.children.length > 0 ? `${node.children.length} sub-unit${node.children.length > 1 ? 's' : ''}` : 'Team'}</div>
        </div>
        <span className="oc-card-icon" aria-hidden="true"><Icon size={24} /></span>
      </div>

      <div className="oc-card-actions">
        <button type="button" className="oc-act" title="Add sub-unit" aria-label="Add sub-unit" onClick={(e) => { stop(e); ops.add(node.id) }}><Plus size={13} /></button>
        <button type="button" className="oc-act" title={node.locked ? 'Unlock' : 'Lock'} aria-label={node.locked ? 'Unlock' : 'Lock'} onClick={(e) => { stop(e); ops.toggleLock(node.id) }}>{node.locked ? <Unlock size={12} /> : <Lock size={12} />}</button>
        <button type="button" className="oc-act" title="Move up" aria-label="Move up" onClick={(e) => { stop(e); ops.move(node.id, -1) }}><ChevronUp size={13} /></button>
        <button type="button" className="oc-act" title="Move down" aria-label="Move down" onClick={(e) => { stop(e); ops.move(node.id, 1) }}><ChevronDown size={13} /></button>
        {!isRoot && <button type="button" className="oc-act danger" title="Delete" aria-label="Delete" onClick={(e) => { stop(e); ops.del(node.id) }}><Trash2 size={12} /></button>}
      </div>
    </div>
  )
}

function OrgTreeNode({ node, isRoot, colorClass, Icon, ops }: { node: Unit; isRoot?: boolean; colorClass?: string; Icon?: typeof Building2; ops: Ops }) {
  const cc = colorClass ?? 'oc-c-gold'
  const Ic = Icon ?? ROOT_ICON
  return (
    <li>
      <OrgCard node={node} isRoot={!!isRoot} colorClass={cc} Icon={Ic} ops={ops} />
      {node.children && node.children.length > 0 && (
        <ul>{node.children.map((c, i) => (
          <OrgTreeNode
            key={c.id}
            node={c}
            colorClass={isRoot ? DEPT_COLORS[i % DEPT_COLORS.length] : cc}
            Icon={isRoot ? DEPT_ICONS[i % DEPT_ICONS.length] : Ic}
            ops={ops}
          />
        ))}</ul>
      )}
    </li>
  )
}

function HierarchyTab() {
  const [tree, setTree] = useState<Unit>(() => withIds(ORG_SEED))
  const [dragId, setDragId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const setZ = (z: number) => setZoom(Math.min(1.6, Math.max(0.4, Math.round(z * 10) / 10)))

  const ops: Ops = {
    dragId, setDragId,
    reparent: (d, target) => { setTree((t) => reparent(t, d, target)); setDragId(null) },
    add: (id) => setTree((t) => updateNode(t, id, (n) => ({ ...n, children: [...(n.children ?? []), { id: newId(), name: '' }] }))),
    rename: (id, value) => setTree((t) => updateNode(t, id, (n) => ({ ...n, name: value }))),
    del: (id) => setTree((t) => removeNode(t, id)),
    move: (id, dir) => setTree((t) => moveNode(t, id, dir)),
    toggleLock: (id) => setTree((t) => updateNode(t, id, (n) => ({ ...n, locked: !n.locked }))),
  }

  return (
    <>
      <div className="orgp-scaffold-note">
        <BuildingIcon size={14} />
        <span>
          <strong>Editable department chart</strong> — type a department name right in the card; hover for
          add · lock · move · delete; drag a card&rsquo;s <strong>grip</strong> onto another to re-wire. UI-first
          on local state; once the shape is right, the backend model + persistence follow. This tree is
          the SST tickets, round-sheets &amp; assignments lean on.
        </span>
      </div>
      <div className="oc-canvas">
        <div className="oc-zoombar">
          <button type="button" className="oc-zoom-btn" title="Zoom out" aria-label="Zoom out" onClick={() => setZ(zoom - 0.1)}><Minus size={14} /></button>
          <button type="button" className="oc-zoom-val" title="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="oc-zoom-btn" title="Zoom in" aria-label="Zoom in" onClick={() => setZ(zoom + 0.1)}><Plus size={14} /></button>
        </div>
        <div className="oc-scroll">
          <div className={`oc-tree${dragId ? ' oc-dragging' : ''}`} style={{ zoom }}>
            <ul><OrgTreeNode node={tree} isRoot ops={ops} /></ul>
          </div>
        </div>
      </div>
    </>
  )
}

function ScaffoldTab({ icon, title, lines }: { icon: ReactNode; title: string; lines: string[] }) {
  return (
    <div className="orgp-scaffold">
      <div className="orgp-scaffold-ic">{icon}</div>
      <div className="orgp-scaffold-title">{title}</div>
      <ul className="orgp-scaffold-list">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <div className="orgp-scaffold-foot">UI-first scaffold — shape it live, then we wire the data.</div>
    </div>
  )
}

export default function OrgPage() {
  const [tab, setTab] = useState<Tab>('hierarchy')
  return (
    <PageShell
      type="CONFIGURATION"
      breadcrumb={['Operations', 'Organisation']}
      icon={<BuildingIcon size={18} />}
      title="Organisation"
      subtitle="People & structure — one source of truth for hierarchy, branches and departments"
    >
      <div className="org-switcher-row">
        <div className="org-switcher" role="tablist" aria-label="Organisation view">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`org-switcher-btn${tab === id ? ' on' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {tab === 'hierarchy' && <HierarchyTab />}
        {tab === 'branches' && (
          <ScaffoldTab
            icon={<MapIcon size={22} />}
            title="Branches & Addresses"
            lines={[
              'Geographic tree: country → region → city → branch',
              'Per-branch address, contact, timezone, locale',
              'The geo partition key — which branch a record belongs to',
              'Backed by the kernel Region table (read API already exists)',
            ]}
          />
        )}
        {tab === 'departments' && (
          <ScaffoldTab
            icon={<LayersIcon size={22} />}
            title="Departments — the department corner"
            lines={[
              'Department directory (Sales, Billing, NOC, Care, HR, Finance…)',
              'Who sits in each department',
              '“Very different things will go in it” — shaped live by Gev',
              'Backed by the kernel Department dimension (user.department, SPEC §4.1)',
            ]}
          />
        )}
      </div>
    </PageShell>
  )
}
