// GAAex Studio — P5 rich panes.
// TypeScript port of all 11 components from design-system/ui_kits/portal/studio-panes.jsx
// plus AppearancePane and EntityBuilder from Studio.jsx.
//
// All panes are fully self-contained: useState/useRef internal state, seed data, no props.
// No backend calls. Export each as a named export consumed by richPaneFor() in StudioGenericPane.

import { useState, useRef } from 'react'
import {
  // layout builder palette icons
  Rows3,
  Columns3,
  Grid3x3,
  Square,
  FolderOpen,
  Layers,
  Minus,
  Image as ImageIcon,
  // device toggle
  Monitor,
  Tablet,
  Smartphone,
  // canvas controls
  ChevronUp,
  ChevronDown,
  X,
  Plus,
  // page manager / general
  Files,
  File,
  SquarePen,
  Copy,
  Trash2,
  // components library
  MousePointerClick,
  TextCursorInput,
  List,
  ToggleLeft,
  Calendar,
  Table,
  BarChart3,
  Gauge,
  Kanban,
  ListTree,
  PanelTop,
  Menu,
  FileText,
  Images,
  BadgeDollarSign,
  Quote,
  Search,
  // content editor
  Type,
  Upload,
  Check,
  // data binding
  Database,
  Info,
  Boxes,
  Unlink,
  // actions & logic
  Zap,
  ArrowRight,
  // permissions
  Lock,
  // preview mode
  Eye,
  // version history
  History,
  GitCompare,
  GitCommitHorizontal,
  Pencil,
  RotateCcw,
  // templates
  Store,
  // publish settings
  Rocket,
  Save,
  Code,
  LayoutDashboard,
  IdCard,
  CreditCard,
  // entity builder
  CheckCircle2,
  // appearance pane
  Moon,
  Sun,
  Users,
  Settings,
  Palette,
} from 'lucide-react'

// ── shared helper: section header ────────────────────────────────────────────

function SecHead({
  icon,
  title,
  hint,
  right,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
  right?: React.ReactNode
}) {
  return (
    <div className="section-head" style={{ marginTop: 0 }}>
      <span className="section-icon" style={{ display: 'inline-flex' }}>{icon}</span>
      {title}
      {hint && (
        <span className="hint" style={{ fontWeight: 400, marginLeft: 6 }}>
          · {hint}
        </span>
      )}
      {right && (
        <>
          <span style={{ flex: 1 }} />
          {right}
        </>
      )}
    </div>
  )
}

// ── toast shim (no-op — pane is self-contained; toast wiring optional) ────────
function toast(msg: string) {
  // In the real app, call the app-level toast system.
  // We silently no-op here so panes are fully independent.
  console.debug('[studio toast]', msg)
}

// ── 1 PAGE MANAGER ───────────────────────────────────────────────────────────

const PAGE_TYPES = ['home', 'dashboard', 'list', 'form', 'detail', 'landing', 'checkout', 'profile', 'report']

interface PageRow {
  id: string
  name: string
  type: string
  status: 'Published' | 'Draft' | 'In review'
  updated: string
}

export function PageManager() {
  const [pages, setPages] = useState<PageRow[]>([
    { id: 'p1', name: 'Operations Home', type: 'home', status: 'Published', updated: '2h ago' },
    { id: 'p2', name: 'Invoices', type: 'list', status: 'Published', updated: '1d ago' },
    { id: 'p3', name: 'New Order', type: 'form', status: 'Draft', updated: '3h ago' },
    { id: 'p4', name: 'Customer 360', type: 'detail', status: 'Published', updated: '5d ago' },
    { id: 'p5', name: 'Executive Dashboard', type: 'dashboard', status: 'Published', updated: '1w ago' },
    { id: 'p6', name: 'Upgrade Landing', type: 'landing', status: 'In review', updated: '30m ago' },
  ])
  const idRef = useRef(7)

  const add = () => {
    const id = 'p' + idRef.current++
    setPages(p => [{ id, name: 'Untitled page', type: 'list', status: 'Draft', updated: 'now' }, ...p])
    toast('Page created')
  }
  const dup = (pg: PageRow) => {
    const id = 'p' + idRef.current++
    setPages(p => [{ ...pg, id, name: pg.name + ' copy', status: 'Draft', updated: 'now' }, ...p])
    toast('Page duplicated')
  }
  const rename = (pg: PageRow) => {
    const n = window.prompt('Rename page', pg.name)
    if (n) {
      setPages(p => p.map(x => x.id === pg.id ? { ...x, name: n, updated: 'now' } : x))
      toast('Renamed')
    }
  }
  const del = (pg: PageRow) => {
    setPages(p => p.filter(x => x.id !== pg.id))
    toast('Page deleted')
  }
  const setType = (pg: PageRow, t: string) =>
    setPages(p => p.map(x => x.id === pg.id ? { ...x, type: t } : x))

  const statusCls = (s: string) =>
    s === 'Published' ? 'pill pill-success' : s === 'Draft' ? 'pill pill-neutral' : 'pill pill-warning'

  return (
    <div>
      <SecHead
        icon={<Files size={15} />}
        title="Page Manager"
        hint="create, duplicate, rename, delete pages"
        right={
          <button className="btn btn-primary btn-sm" type="button" onClick={add}>
            <Plus size={13} />New page
          </button>
        }
      />
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Page</th>
              <th>Type</th>
              <th>Status</th>
              <th>Updated</th>
              <th style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {pages.map(pg => (
              <tr key={pg.id}>
                <td style={{ fontWeight: 600 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <File size={14} style={{ color: 'var(--gx-text-3)' }} />
                    {pg.name}
                  </span>
                </td>
                <td>
                  <select
                    className="inp inp-sm"
                    style={{ width: 130 }}
                    value={pg.type}
                    onChange={e => setType(pg, e.target.value)}
                  >
                    {PAGE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </td>
                <td><span className={statusCls(pg.status)}>{pg.status}</span></td>
                <td className="hint" style={{ fontSize: 11.5 }}>{pg.updated}</td>
                <td>
                  <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm btn-icon" type="button" title="Rename" onClick={() => rename(pg)}>
                      <SquarePen size={14} />
                    </button>
                    <button className="btn btn-ghost btn-sm btn-icon" type="button" title="Duplicate" onClick={() => dup(pg)}>
                      <Copy size={14} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      type="button"
                      title="Delete"
                      style={{ color: 'var(--gx-danger-fg)' }}
                      onClick={() => del(pg)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 2 LAYOUT BUILDER ─────────────────────────────────────────────────────────

type Device = 'desktop' | 'tablet' | 'mobile'

const LAYOUT_PALETTE: [React.ReactNode, string][] = [
  [<Rows3 size={16} />, 'Section'],
  [<Columns3 size={16} />, 'Columns'],
  [<Grid3x3 size={16} />, 'Grid'],
  [<Square size={16} />, 'Card'],
  [<FolderOpen size={16} />, 'Tabs'],
  [<Layers size={16} />, 'Modal'],
  [<Minus size={16} />, 'Divider'],
  [<ImageIcon size={16} />, 'Media'],
]

interface CanvasBlock {
  id: number
  type: string
  h: number
}

export function LayoutBuilder() {
  const [device, setDevice] = useState<Device>('desktop')
  const [blocks, setBlocks] = useState<CanvasBlock[]>([
    { id: 1, type: 'Header', h: 54 },
    { id: 2, type: 'KPI Row · 4 cards', h: 96 },
    { id: 3, type: 'Columns · Chart + List', h: 180 },
    { id: 4, type: 'Data Table', h: 150 },
  ])
  const idRef = useRef(5)

  const addBlock = (t: string) => {
    const h = t === 'Grid' ? 140 : t === 'Modal' ? 110 : 80
    setBlocks(b => [...b, { id: idRef.current++, type: t, h }])
    toast(t + ' added')
  }
  const removeBlock = (id: number) => setBlocks(b => b.filter(x => x.id !== id))
  const move = (i: number, d: -1 | 1) => {
    setBlocks(b => {
      const n = [...b]
      const j = i + d
      if (j < 0 || j >= n.length) return n
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  }

  const canvasWidth: string | number =
    device === 'desktop' ? '100%' : device === 'tablet' ? 620 : 340

  return (
    <div>
      <SecHead
        icon={<Monitor size={15} />}
        title="Layout Builder"
        hint="drag sections, columns, grids, cards, tabs, modals"
        right={
          <div className="seg">
            {([['desktop', <Monitor size={13} />], ['tablet', <Tablet size={13} />], ['mobile', <Smartphone size={13} />]] as [Device, React.ReactNode][]).map(([d, icon]) => (
              <button key={d} className={device === d ? 'on' : ''} type="button" onClick={() => setDevice(d)}>
                {icon}
              </button>
            ))}
          </div>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16 }}>
        {/* palette */}
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>Blocks</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {LAYOUT_PALETTE.map(([icon, label]) => (
              <button
                key={label}
                className="palette-block"
                type="button"
                style={{ flexDirection: 'column', alignItems: 'center', gap: 5, padding: '10px 6px' }}
                onClick={() => addBlock(label)}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>
          <p className="hint" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
            Click a block to drop it on the canvas. Reorder with the arrows; resize handles in full editor.
          </p>
        </div>
        {/* canvas */}
        <div className="card" style={{ padding: 16, background: 'var(--gx-bg-subtle)', minHeight: 420 }}>
          <div style={{ width: canvasWidth, margin: '0 auto', transition: 'width var(--gx-dur-base)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {blocks.map((b, i) => (
              <div key={b.id} className="canvas-block" style={{ height: b.h }}>
                <span className="canvas-tag">{b.type}</span>
                <div className="canvas-actions">
                  <button type="button" title="Up" onClick={() => move(i, -1)}>
                    <ChevronUp size={13} />
                  </button>
                  <button type="button" title="Down" onClick={() => move(i, 1)}>
                    <ChevronDown size={13} />
                  </button>
                  <button type="button" title="Remove" style={{ color: 'var(--gx-danger-fg)' }} onClick={() => removeBlock(b.id)}>
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
            <button className="canvas-add" type="button" onClick={() => addBlock('Section')}>
              <Plus size={14} />Add block
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 3 COMPONENTS LIBRARY ─────────────────────────────────────────────────────

const COMP_GROUPS: [string, [React.ReactNode, string][]][] = [
  ['Inputs', [
    [<MousePointerClick size={18} />, 'Button'],
    [<TextCursorInput size={18} />, 'Text field'],
    [<List size={18} />, 'Select'],
    [<ToggleLeft size={18} />, 'Toggle'],
    [<Calendar size={18} />, 'Date picker'],
  ]],
  ['Data', [
    [<Table size={18} />, 'Table'],
    [<BarChart3 size={18} />, 'Chart'],
    [<Gauge size={18} />, 'KPI tile'],
    [<Kanban size={18} />, 'Board'],
    [<ListTree size={18} />, 'Tree'],
  ]],
  ['Layout', [
    [<PanelTop size={18} />, 'Banner'],
    [<Menu size={18} />, 'Menu'],
    [<Square size={18} />, 'Card'],
    [<FolderOpen size={18} />, 'Tabs'],
    [<Rows3 size={18} />, 'List'],
  ]],
  ['Content', [
    [<FileText size={18} />, 'Form'],
    [<Images size={18} />, 'Gallery'],
    [<BadgeDollarSign size={18} />, 'Pricing card'],
    [<Quote size={18} />, 'Testimonial'],
    [<ImageIcon size={18} />, 'Media'],
  ]],
]

export function ComponentsLibrary() {
  const [q, setQ] = useState('')
  return (
    <div>
      <SecHead
        icon={<Layers size={15} />}
        title="Components Library"
        hint="reusable blocks — drag into any page"
        right={
          <div className="tb-search" style={{ width: 200, height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)', background: 'var(--gx-surface)' }}>
            <Search size={14} style={{ color: 'var(--gx-text-3)', flexShrink: 0 }} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 12.5, fontFamily: 'var(--gx-font-sans)' }}
            />
          </div>
        }
      />
      {COMP_GROUPS.map(([groupName, items]) => {
        const filtered = items.filter(([, label]) => !q || label.toLowerCase().includes(q.toLowerCase()))
        if (!filtered.length) return null
        return (
          <div key={groupName} style={{ marginBottom: 18 }}>
            <div className="lbl" style={{ marginBottom: 10 }}>{groupName}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(132px,1fr))', gap: 10 }}>
              {filtered.map(([icon, label]) => (
                <button
                  key={label}
                  className="comp-card"
                  type="button"
                  draggable
                  onClick={() => toast(label + ' added to page')}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 10px', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)', background: 'var(--gx-surface)', cursor: 'grab', transition: 'all var(--gx-dur-fast)', position: 'relative' }}
                >
                  <span style={{ color: 'var(--gx-text-2)' }}>{icon}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
                  <Plus size={13} style={{ position: 'absolute', top: 8, right: 8, color: 'var(--gx-text-3)' }} />
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 4 CONTENT EDITOR ─────────────────────────────────────────────────────────

export function ContentEditor() {
  const [tab, setTab] = useState<'content' | 'seo'>('content')
  return (
    <div>
      <SecHead
        icon={<Type size={15} />}
        title="Content Editor"
        hint="text, images, links, labels & SEO"
        right={
          <div className="seg">
            <button className={tab === 'content' ? 'on' : ''} type="button" onClick={() => setTab('content')}>Content</button>
            <button className={tab === 'seo' ? 'on' : ''} type="button" onClick={() => setTab('seo')}>SEO</button>
          </div>
        }
      />
      {tab === 'content' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label className="field"><span>Page title</span><input className="inp inp-sm" defaultValue="Operations Home" /></label>
          <label className="field"><span>Subtitle</span><input className="inp inp-sm" defaultValue="Yerevan Net · live across all modules" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span>Body text</span>
            <textarea className="inp" rows={4} style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }} defaultValue={"Welcome back. Here's your operations summary for today."} />
          </label>
          <label className="field"><span>Primary button label</span><input className="inp inp-sm" defaultValue="Create" /></label>
          <label className="field"><span>Button link</span><input className="inp inp-sm mono" defaultValue="/revenue/orders/new" /></label>
          <label className="field">
            <span>Image</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--gx-bg-subtle)', border: '1px dashed var(--gx-border-strong)', borderRadius: 'var(--gx-radius-md)' }}>
              <ImageIcon size={18} style={{ color: 'var(--gx-text-3)' }} />
              <span className="hint" style={{ fontSize: 12 }}>hero.png</span>
              <button className="btn btn-ghost btn-sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => toast('Upload image')}>
                <Upload size={13} />Replace
              </button>
            </div>
          </label>
          <label className="field"><span>Placeholder text</span><input className="inp inp-sm" defaultValue="Search work items…" /></label>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14, maxWidth: 560 }}>
          <label className="field">
            <span>SEO title</span>
            <input className="inp inp-sm" defaultValue="Operations Home · GAAex" />
            <span className="hint" style={{ fontSize: 11 }}>58 / 60 characters</span>
          </label>
          <label className="field">
            <span>Meta description</span>
            <textarea className="inp" rows={3} style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }} defaultValue="Operations summary and quick actions for the GAAex platform." />
          </label>
          <label className="field"><span>URL slug</span><input className="inp inp-sm mono" defaultValue="/home" /></label>
          <div className="seo-preview" style={{ padding: '12px 14px', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)', background: 'var(--gx-bg-subtle)' }}>
            <div style={{ fontSize: 13, color: 'var(--azure-300)' }}>Operations Home · GAAex</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--gx-success-fg)' }}>gaaex.app › home</div>
            <div style={{ fontSize: 12, color: 'var(--gx-text-2)', marginTop: 2 }}>Operations summary and quick actions for the GAAex platform.</div>
          </div>
        </div>
      )}
      <div style={{ marginTop: 18 }}>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => toast('Content saved')}>
          <Check size={13} />Save content
        </button>
      </div>
    </div>
  )
}

// ── 5 DATA BINDING ───────────────────────────────────────────────────────────

const DATA_SOURCES = ['Customers', 'Orders', 'Invoices', 'Tickets', 'Devices', 'Subscriptions', 'Payments']

interface BindRow {
  comp: string
  src: string
  field: string
}

export function DataBinding() {
  const [showModel, setShowModel] = useState(false)
  const [binds, setBinds] = useState<BindRow[]>([
    { comp: 'KPI · Active subscribers', src: 'Customers', field: 'count(status=Active)' },
    { comp: 'Table · Recent invoices', src: 'Invoices', field: 'list · sort by date desc' },
    { comp: 'Chart · Revenue', src: 'Payments', field: 'sum(amount) by month' },
  ])

  if (showModel) {
    return (
      <div>
        <button className="btn btn-ghost btn-sm" type="button" style={{ marginBottom: 12 }} onClick={() => setShowModel(false)}>
          <ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} />Back to bindings
        </button>
        <EntityBuilder />
      </div>
    )
  }

  return (
    <div>
      <SecHead
        icon={<Database size={15} />}
        title="Data Binding"
        hint="connect components to database / API fields"
        right={
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowModel(true)}>
            <Boxes size={13} />Manage data model
          </button>
        }
      />
      <div className="banner" style={{ marginBottom: 16 }}>
        <Info size={16} style={{ color: 'var(--gx-primary)', flexShrink: 0, marginTop: 1 }} />
        <div>
          <div className="bt">Bindings are live</div>
          <div className="bm">Each component reads from an entity or API. Changes apply to every rendered instance.</div>
        </div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Component</th>
              <th>Data source</th>
              <th>Binding</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {binds.map((b, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{b.comp}</td>
                <td>
                  <select
                    className="inp inp-sm"
                    style={{ width: 140 }}
                    value={b.src}
                    onChange={e => setBinds(bs => bs.map((x, j) => j === i ? { ...x, src: e.target.value } : x))}
                  >
                    {DATA_SOURCES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>{b.field}</td>
                <td>
                  <button className="btn btn-ghost btn-sm btn-icon" type="button">
                    <Unlink size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-primary btn-sm" type="button" style={{ marginTop: 14 }} onClick={() => toast('Add binding')}>
        <Plus size={13} />Bind a component
      </button>
    </div>
  )
}

// ── 6 ACTIONS & LOGIC ────────────────────────────────────────────────────────

interface Rule {
  on: string
  cond: string
  act: string
  en: boolean
}

export function ActionsLogic() {
  const [rules, setRules] = useState<Rule[]>([
    { on: 'Button "Create" click', cond: 'always', act: 'Open form → New Order', en: true },
    { on: 'Form submit', cond: 'valid', act: 'Save record + toast "Created"', en: true },
    { on: 'Status = Overdue', cond: 'amount > $500', act: 'Notify collections team', en: true },
    { on: 'Row click', cond: 'role = Agent', act: 'Open record drawer', en: false },
  ])
  const toggle = (i: number) => setRules(r => r.map((x, j) => j === i ? { ...x, en: !x.en } : x))

  return (
    <div>
      <SecHead
        icon={<Zap size={15} />}
        title="Actions & Logic"
        hint="button actions, submit behavior, navigation, conditions, visibility"
        right={
          <button className="btn btn-primary btn-sm" type="button" onClick={() => toast('New rule')}>
            <Plus size={13} />New rule
          </button>
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rules.map((r, i) => (
          <div key={i} className="rule-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)', background: 'var(--gx-surface)', flexWrap: 'wrap' }}>
            <span className="rule-pill" style={{ background: 'var(--gx-primary-soft)', color: 'var(--gx-info-fg)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--gx-radius-full)', fontSize: 10, fontWeight: 700 }}>
              <Zap size={12} />WHEN
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.on}</span>
            <span className="rule-pill" style={{ background: 'var(--gx-warning-soft)', color: 'var(--gx-warning-fg)', display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 'var(--gx-radius-full)', fontSize: 10, fontWeight: 700 }}>IF</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>{r.cond}</span>
            <ArrowRight size={14} style={{ color: 'var(--gx-text-3)' }} />
            <span className="rule-pill" style={{ background: 'var(--gx-success-soft)', color: 'var(--gx-success-fg)', display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 'var(--gx-radius-full)', fontSize: 10, fontWeight: 700 }}>DO</span>
            <span style={{ fontSize: 12.5 }}>{r.act}</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className={'gx-toggle' + (r.en ? ' on' : '')}
              onClick={() => toggle(i)}
              style={{ flexShrink: 0 }}
            >
              <span className="knob" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 7 PERMISSIONS ────────────────────────────────────────────────────────────

const ROLES = ['Admin', 'Manager', 'Agent', 'Field Tech', 'Guest']
const PERM_PAGES = ['Operations Home', 'Invoices', 'New Order', 'Customer 360', 'Settings']

type PermLevel = 'edit' | 'view' | 'none'

function initPerm(ri: number, pi: number): PermLevel {
  if (ri === 0) return 'edit'
  if (ri === 4) return pi < 2 ? 'view' : 'none'
  if (ri === 1) return pi === 4 ? 'view' : 'edit'
  if (ri === 2) return pi === 4 ? 'none' : 'view'
  return pi === 0 ? 'view' : 'none'
}

export function Permissions() {
  const [grid, setGrid] = useState<PermLevel[][]>(() =>
    PERM_PAGES.map((_, pi) => ROLES.map((_, ri) => initPerm(ri, pi)))
  )
  const cycle = (pi: number, ri: number) =>
    setGrid(g => g.map((row, p) =>
      p === pi ? row.map((c, r) => r === ri ? (c === 'none' ? 'view' : c === 'view' ? 'edit' : 'none') : c) : row
    ))
  const dot = (v: PermLevel): [string, string] =>
    v === 'edit' ? ['Edit', 'var(--gx-success)'] : v === 'view' ? ['View', 'var(--gx-warning)'] : ['—', 'var(--gx-text-3)']

  return (
    <div>
      <SecHead icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each page or component" />
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Page</th>
              {ROLES.map(r => <th key={r} style={{ textAlign: 'center' }}>{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERM_PAGES.map((pg, pi) => (
              <tr key={pg}>
                <td style={{ fontWeight: 600 }}>{pg}</td>
                {ROLES.map((_, ri) => {
                  const [label, color] = dot(grid[pi][ri])
                  return (
                    <td key={ri} style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="perm-cell"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--gx-font-sans)' }}
                        onClick={() => cycle(pi, ri)}
                        title="Click to cycle"
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                        {label}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ fontSize: 11.5, marginTop: 10 }}>
        Click a cell to cycle None → View → Edit. Enforced server-side by the auth kernel — UI hiding is not authorization.
      </p>
    </div>
  )
}

// ── 8 PREVIEW MODE ───────────────────────────────────────────────────────────

const PREVIEW_ROLES = ['Admin', 'Manager', 'Agent', 'Field Tech', 'Guest']

export function PreviewMode() {
  const [device, setDevice] = useState<Device>('desktop')
  const [role, setRole] = useState('Admin')
  const W: string | number = device === 'desktop' ? '100%' : device === 'tablet' ? 640 : 360

  return (
    <div>
      <SecHead
        icon={<Eye size={15} />}
        title="Preview Mode"
        hint="preview as device & as different user roles"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="inp inp-sm" style={{ width: 130 }} value={role} onChange={e => setRole(e.target.value)}>
              {PREVIEW_ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
            <div className="seg">
              {([['desktop', <Monitor size={13} />], ['tablet', <Tablet size={13} />], ['mobile', <Smartphone size={13} />]] as [Device, React.ReactNode][]).map(([d, icon]) => (
                <button key={d} className={device === d ? 'on' : ''} type="button" onClick={() => setDevice(d)}>{icon}</button>
              ))}
            </div>
          </div>
        }
      />
      <div className="card" style={{ padding: 16, background: 'var(--gx-bg-subtle)' }}>
        <div style={{ width: W, margin: '0 auto', transition: 'width var(--gx-dur-base)', background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-lg)', overflow: 'hidden', boxShadow: 'var(--gx-shadow-md)' }}>
          {/* mock browser chrome */}
          <div style={{ height: 38, borderBottom: '1px solid var(--gx-border-subtle)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
            <span style={{ display: 'flex', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gx-danger)' }} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gx-warning)' }} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gx-success)' }} />
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--gx-text-3)' }}>gaaex.app/home</span>
            <span className="pill pill-gold" style={{ marginLeft: 'auto', height: 18 }}>as {role}</span>
          </div>
          <div style={{ padding: 18 }}>
            <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
              Operations Home
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: device === 'mobile' ? '1fr 1fr' : 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
              {['128,402', '$1.84M', '347', '99.98%'].map((v, i) => (
                <div key={i} className="tile" style={{ padding: 12 }}>
                  <div className="lbl" style={{ fontSize: 9 }}>Metric</div>
                  <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 18, fontWeight: 600, marginTop: 4 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ height: 80, borderRadius: 'var(--gx-radius-md)', background: 'linear-gradient(180deg,var(--gx-surface-2),var(--gx-bg-subtle))', border: '1px solid var(--gx-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)', fontSize: 12 }}>
              {role === 'Guest' ? 'Restricted — sign in to view data' : 'Chart · Revenue vs. churn'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 9 VERSION HISTORY ────────────────────────────────────────────────────────

interface VersionRow {
  v: string
  label: string
  who: string
  t: string
  tag: 'Draft' | 'Published'
  cur: boolean
}

const VERSION_DATA: VersionRow[] = [
  { v: 'v12', label: 'Current draft', who: 'Gevorg V.', t: '2h ago', tag: 'Draft', cur: true },
  { v: 'v11', label: 'Added Revenue Assurance KPIs', who: 'Ani H.', t: '1d ago', tag: 'Published', cur: false },
  { v: 'v10', label: 'New invoice table columns', who: 'Narek M.', t: '3d ago', tag: 'Published', cur: false },
  { v: 'v9', label: 'Layout redesign', who: 'Gevorg V.', t: '1w ago', tag: 'Published', cur: false },
  { v: 'v8', label: 'Initial publish', who: 'Gevorg V.', t: '2w ago', tag: 'Published', cur: false },
]

export function VersionHistory() {
  return (
    <div>
      <SecHead
        icon={<History size={15} />}
        title="Version History"
        hint="save drafts, publish, rollback, compare"
        right={
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => toast('Comparing v12 ↔ v11')}>
            <GitCompare size={13} />Compare
          </button>
        }
      />
      <div className="timeline" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {VERSION_DATA.map((r, i) => (
          <div key={i} className="tl-item" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: i < VERSION_DATA.length - 1 ? '1px solid var(--gx-border-subtle)' : 'none' }}>
            <span className="tl-dot" style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: r.cur ? 'var(--gx-primary-soft)' : 'var(--gx-surface-2)', color: r.cur ? 'var(--gx-primary)' : 'var(--gx-text-3)', marginTop: 1 }}>
              {r.cur ? <Pencil size={13} /> : <GitCommitHorizontal size={13} />}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--gx-link)' }}>{r.v}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</span>
                <span className={r.tag === 'Draft' ? 'pill pill-neutral' : 'pill pill-success'} style={{ height: 18 }}>{r.tag}</span>
                <span style={{ flex: 1 }} />
                {!r.cur && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => toast('Rolled back to ' + r.v)}>
                    <RotateCcw size={13} />Rollback
                  </button>
                )}
              </div>
              <div className="hint" style={{ fontSize: 11.5, marginTop: 2 }}>{r.who} · {r.t}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 10 TEMPLATES ─────────────────────────────────────────────────────────────

const TEMPLATE_DATA: [React.ReactNode, string, string][] = [
  [<LayoutDashboard size={26} />, 'Operations Dashboard', 'KPI tiles + charts + activity'],
  [<Rows3 size={26} />, 'Data List', 'Searchable table + filters'],
  [<FileText size={26} />, 'Record Form', 'Two-column form + actions'],
  [<IdCard size={26} />, 'Customer 360', 'Profile + related records'],
  [<CreditCard size={26} />, 'Checkout', 'Cart + payment + summary'],
  [<Rocket size={26} />, 'Landing Page', 'Hero + features + CTA'],
  [<Kanban size={26} />, 'Work Board', 'Kanban columns by status'],
  [<BarChart3 size={26} />, 'Analytics Report', 'Charts + pivot + export'],
]

export function Templates() {
  return (
    <div>
      <SecHead icon={<Store size={15} />} title="Templates" hint="ready-made pages & reusable saved sections" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 14 }}>
        {TEMPLATE_DATA.map(([icon, name, desc]) => (
          <div key={name} className="tpl-card" style={{ border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)', background: 'var(--gx-surface)', overflow: 'hidden' }}>
            <div className="tpl-thumb" style={{ height: 90, background: 'var(--gx-bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)', borderBottom: '1px solid var(--gx-border-subtle)' }}>
              {icon}
            </div>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
              <div className="hint" style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
              <button className="btn btn-secondary btn-sm" type="button" style={{ width: '100%', marginTop: 10 }} onClick={() => toast('"' + name + '" added')}>
                <Plus size={13} />Use template
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 11 PUBLISH SETTINGS ──────────────────────────────────────────────────────

type PublishStatus = 'Draft' | 'In review' | 'Published'
type AccessLevel = 'Public' | 'Authenticated' | 'Role-restricted' | 'Admin only'

export function PublishSettings() {
  const [status, setStatus] = useState<PublishStatus>('Draft')
  const [access, setAccess] = useState<AccessLevel>('Authenticated')
  const [code, setCode] = useState(false)

  return (
    <div>
      <SecHead icon={<Rocket size={15} />} title="Publish Settings" hint="slug, status, access, language, metadata, custom code" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 680 }}>
        <label className="field"><span>URL slug</span><input className="inp inp-sm mono" defaultValue="/home" /></label>
        <label className="field">
          <span>Status</span>
          <div className="seg" style={{ width: '100%' }}>
            {(['Draft', 'In review', 'Published'] as PublishStatus[]).map(s => (
              <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)} style={{ flex: 1 }}>{s}</button>
            ))}
          </div>
        </label>
        <label className="field">
          <span>Access level</span>
          <select className="inp inp-sm" value={access} onChange={e => setAccess(e.target.value as AccessLevel)}>
            {(['Public', 'Authenticated', 'Role-restricted', 'Admin only'] as AccessLevel[]).map(a => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Language</span>
          <select className="inp inp-sm" defaultValue="Հայerеն (hy-AM)">
            {['Հayerен (hy-AM)', 'English (en)', 'Русский (ru)'].map(l => <option key={l}>{l}</option>)}
          </select>
        </label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Page metadata (title / description)</span>
          <input className="inp inp-sm" defaultValue="Operations Home · GAAex" style={{ marginBottom: 8 }} />
          <textarea className="inp" rows={2} style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }} defaultValue="Operations summary and quick actions." />
        </label>
      </div>
      <div className="section-head">
        <Code size={15} className="section-icon" />
        Custom code
        <span style={{ flex: 1 }} />
        <button type="button" className={'gx-toggle' + (code ? ' on' : '')} onClick={() => setCode(c => !c)}>
          <span className="knob" />
        </button>
      </div>
      {code && (
        <textarea
          className="inp mono"
          rows={4}
          style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical', fontSize: 12 }}
          placeholder="<!-- custom head/script injected on publish -->"
          defaultValue={'<script>/* analytics */</script>'}
        />
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button className="btn btn-primary" type="button" onClick={() => toast('Published to production')}>
          <Rocket size={14} />Publish now
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => toast('Saved as draft')}>
          <Save size={14} />Save draft
        </button>
      </div>
    </div>
  )
}

// ── ENTITY BUILDER (from Studio.jsx) ─────────────────────────────────────────

const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'boolean', 'date', 'datetime', 'email', 'phone', 'select', 'ref', 'status']

interface FieldRow {
  key: string
  label: string
  type: string
  required: boolean
  extra: string
}

interface StatusDef {
  key: string
  label: string
  is_initial: boolean
}

export function EntityBuilder() {
  const [label, setLabel] = useState('Opportunity')
  const [labelPlural, setLabelPlural] = useState('Opportunities')
  const [key, setKey] = useState('opportunity')
  const [slug, setSlug] = useState('opportunities')
  const [fields, setFields] = useState<FieldRow[]>([
    { key: 'name', label: 'Name', type: 'text', required: true, extra: '' },
    { key: 'account', label: 'Account', type: 'ref', required: true, extra: 'customer' },
    { key: 'amount', label: 'Amount', type: 'money', required: false, extra: '' },
    { key: 'stage', label: 'Stage', type: 'status', required: true, extra: '' },
  ])
  const [statuses] = useState<StatusDef[]>([
    { key: 'NEW', label: 'New', is_initial: true },
    { key: 'QUALIFIED', label: 'Qualified', is_initial: false },
    { key: 'WON', label: 'Won', is_initial: false },
  ])
  const [created, setCreated] = useState(false)

  const upd = (i: number, patch: Partial<FieldRow>) =>
    setFields(f => f.map((r, j) => j === i ? { ...r, ...patch } : r))
  const addField = () => setFields(f => [...f, { key: '', label: '', type: 'text', required: false, extra: '' }])
  const rmField = (i: number) => setFields(f => f.filter((_, j) => j !== i))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--gx-font-sans)', fontSize: 16, fontWeight: 600 }}>New entity</h3>
          <p className="hint" style={{ margin: 0 }}>
            Define an entity as configuration. No code, no SQL — it appears in the sidebar instantly.
          </p>
        </div>
      </div>

      {created && (
        <div className="banner" style={{ marginBottom: 16, borderLeftColor: 'var(--gx-success)', background: 'var(--gx-success-soft)' }}>
          <CheckCircle2 size={16} style={{ color: 'var(--gx-success)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="bt">Done</div>
            <div className="bm">Created &ldquo;{labelPlural}&rdquo; — it&apos;s now in the sidebar and fully working.</div>
          </div>
        </div>
      )}

      <div className="section-head" style={{ marginTop: 0 }}>
        <SquarePen size={15} className="section-icon" />Identity
      </div>
      <div className="rec-form" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <label className="field"><span>Key (snake_case) *</span><input className="inp inp-sm mono" value={key} onChange={e => setKey(e.target.value)} /></label>
        <label className="field"><span>Label *</span><input className="inp inp-sm" value={label} onChange={e => setLabel(e.target.value)} /></label>
        <label className="field"><span>Label plural</span><input className="inp inp-sm" value={labelPlural} onChange={e => setLabelPlural(e.target.value)} /></label>
        <label className="field"><span>Route slug (kebab) *</span><input className="inp inp-sm mono" value={slug} onChange={e => setSlug(e.target.value)} /></label>
        <label className="field"><span>Icon</span><input className="inp inp-sm" defaultValue="git-branch" /></label>
      </div>

      <div className="section-head">
        <SquarePen size={15} className="section-icon" />Fields
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" type="button" onClick={addField}><Plus size={13} />Add field</button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th>Type</th>
              <th>Required</th>
              <th>Options / ref</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i}>
                <td><input className="inp inp-sm mono" value={f.key} onChange={e => upd(i, { key: e.target.value })} /></td>
                <td><input className="inp inp-sm" value={f.label} onChange={e => upd(i, { label: e.target.value })} /></td>
                <td>
                  <select className="inp inp-sm" value={f.type} onChange={e => upd(i, { type: e.target.value })}>
                    {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={f.required} onChange={e => upd(i, { required: e.target.checked })} />
                </td>
                <td>
                  <input
                    className="inp inp-sm mono"
                    value={f.extra}
                    placeholder={f.type === 'select' ? 'a, b, c' : f.type === 'ref' ? 'customer' : ''}
                    onChange={e => upd(i, { extra: e.target.value })}
                  />
                </td>
                <td>
                  <button className="btn btn-ghost btn-sm btn-icon" type="button" aria-label="Remove" onClick={() => rmField(i)}>
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-head">
        <ArrowRight size={15} className="section-icon" />Statuses
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {statuses.map((s, i) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="pill" style={{ background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border)', height: 26, color: 'var(--gx-text-1)' }}>
              {s.is_initial && <span className="d" style={{ background: 'var(--gx-gold)' }} />}
              <span className="mono">{s.key}</span>
            </span>
            {i < statuses.length - 1 && <ArrowRight size={14} style={{ color: 'var(--gx-text-3)' }} />}
          </span>
        ))}
        <button className="btn btn-ghost btn-sm" type="button"><Plus size={13} />Status</button>
      </div>

      <div className="section-head">
        <Eye size={15} className="section-icon" />Live preview
        <span className="hint" style={{ fontWeight: 400, marginLeft: 6 }}>· what this config renders</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card card-pad">
          <div className="lbl" style={{ marginBottom: 12 }}>Generated record form</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {fields.filter(f => f.key).map(f => (
              <label className="field" key={f.key}>
                <span>
                  {f.label || f.key}
                  {f.required && <span style={{ color: 'var(--gx-danger)' }}> *</span>}
                </span>
                {f.type === 'status' ? (
                  <select className="inp inp-sm">
                    {statuses.map(s => <option key={s.key}>{s.label}</option>)}
                  </select>
                ) : f.type === 'boolean' ? (
                  <div className="seg" style={{ alignSelf: 'flex-start' }}>
                    <button type="button" className="on">Yes</button>
                    <button type="button">No</button>
                  </div>
                ) : (
                  <input
                    className={'inp inp-sm' + (f.type === 'money' || f.type === 'number' ? ' mono' : '')}
                    placeholder={f.type === 'money' ? '$0.00' : f.type === 'ref' ? 'Pick a ' + f.extra : f.type}
                  />
                )}
              </label>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" type="button" style={{ marginTop: 14 }}>
            <Check size={13} />Save {label}
          </button>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head" style={{ padding: '10px 14px' }}>
            <h3 style={{ fontSize: 13 }}>{labelPlural}</h3>
            <span style={{ flex: 1 }} />
            <span className="pill pill-neutral">list view</span>
          </div>
          <table className="grid">
            <thead>
              <tr>
                {fields.filter(f => f.key).slice(0, 4).map(f => <th key={f.key}>{f.label || f.key}</th>)}
              </tr>
            </thead>
            <tbody>
              {[
                ['Acme Fiber Rollout', 'Acme Corp', '$48,000', 'QUALIFIED'],
                ['City Mesh Expansion', 'Metro Gov', '$120,000', 'NEW'],
              ].map((row, ri) => (
                <tr key={ri}>
                  {fields.filter(f => f.key).slice(0, 4).map((f, ci) => (
                    <td key={f.key} className={f.type === 'money' ? 'mono tnum' : ''}>
                      {f.type === 'status' ? (
                        <span className="pill pill-info">{row[ci]}</span>
                      ) : (
                        row[ci]
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="banner" style={{ margin: '20px 0 18px' }}>
        <Info size={16} style={{ color: 'var(--gx-primary)', flexShrink: 0, marginTop: 1 }} />
        <div>
          <div className="bt">Schema is config — no code change required</div>
          <div className="bm">
            Changes write to <code className="codez">studio_config</code>. Existing records validate lazily on next read. Destructive changes require confirmation with an impact summary.
          </div>
        </div>
      </div>

      <button className="btn btn-gold btn-md" type="button" onClick={() => setCreated(true)}>
        <Check size={14} />Create entity
      </button>
    </div>
  )
}

// ── APPEARANCE PANE (from Studio.jsx) ─────────────────────────────────────────

interface Accent {
  name: string
  val: string
  hover: string
  active: string
  soft: string
}

const ACCENTS: Accent[] = [
  { name: 'Azure', val: '#3B7BE0', hover: '#5293F2', active: '#2C63BC', soft: 'rgba(59,123,224,.16)' },
  { name: 'Cobalt', val: '#2A5187', hover: '#3A6299', active: '#1C3B68', soft: 'rgba(42,81,135,.20)' },
  { name: 'Gold', val: '#C5A059', hover: '#D2B06E', active: '#AC8847', soft: 'rgba(197,160,89,.18)' },
  { name: 'Emerald', val: '#1F9D57', hover: '#34C77B', active: '#16804A', soft: 'rgba(31,157,87,.16)' },
  { name: 'Violet', val: '#8B6FD6', hover: '#A78BE6', active: '#6F52BD', soft: 'rgba(139,111,214,.18)' },
  { name: 'Teal', val: '#2A9DB5', hover: '#41B4CC', active: '#1F8398', soft: 'rgba(42,157,181,.18)' },
]

const RADII: [string, number][] = [['Sharp', 4], ['Soft', 8], ['Rounded', 13], ['Pill', 999]]

type PaneTheme = 'Dark' | 'Light'
type Density = 'Compact' | 'Comfortable' | 'Spacious'

export function AppearancePane() {
  const [accent, setAccent] = useState<Accent>(ACCENTS[0])
  const [radius, setRadius] = useState(8)
  const [density, setDensity] = useState<Density>('Comfortable')
  const [paneTheme, setPaneTheme] = useState<PaneTheme>('Dark')

  const pad = density === 'Compact' ? '0 12px' : density === 'Spacious' ? '0 22px' : '0 16px'
  const ht = density === 'Compact' ? 28 : density === 'Spacious' ? 42 : 34

  const liveVars: React.CSSProperties & Record<string, string> = {
    '--gx-primary': accent.val,
    '--gx-primary-hover': accent.hover,
    '--gx-primary-active': accent.active,
    '--gx-primary-soft': accent.soft,
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--gx-font-sans)', fontSize: 16, fontWeight: 600 }}>Appearance</h3>
        <p className="hint" style={{ margin: 0 }}>
          Tenant branding. Set it once here — every rendered screen across all 18 modules updates. No code.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
        {/* controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* accent color */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Button / accent color</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {ACCENTS.map(a => (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => setAccent(a)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    borderRadius: 'var(--gx-radius-md)',
                    border: '1px solid ' + (accent.name === a.name ? a.val : 'var(--gx-border)'),
                    background: accent.name === a.name ? 'var(--gx-surface-2)' : 'transparent',
                    cursor: 'pointer',
                    boxShadow: accent.name === a.name ? '0 0 0 2px ' + a.soft : 'none',
                  }}
                >
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: a.val, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--gx-text-1)', fontWeight: accent.name === a.name ? 600 : 400 }}>{a.name}</span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10, fontFamily: 'var(--gx-font-mono)', fontSize: 12, background: 'var(--gx-bg-subtle)', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-sm)', padding: '4px 9px', display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--gx-text-1)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: accent.val }} />
              {accent.val.toUpperCase()}
            </div>
          </div>

          {/* corner radius */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Corner radius</div>
            <div className="seg" style={{ width: '100%' }}>
              {RADII.map(([name, val]) => (
                <button key={name} type="button" className={radius === val ? 'on' : ''} onClick={() => setRadius(val)} style={{ flex: 1 }}>{name}</button>
              ))}
            </div>
          </div>

          {/* density */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Density</div>
            <div className="seg" style={{ width: '100%' }}>
              {(['Compact', 'Comfortable', 'Spacious'] as Density[]).map(d => (
                <button key={d} type="button" className={density === d ? 'on' : ''} onClick={() => setDensity(d)} style={{ flex: 1 }}>{d}</button>
              ))}
            </div>
          </div>

          {/* default theme */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Default theme</div>
            <div className="seg" style={{ width: '100%' }}>
              {(['Dark', 'Light'] as PaneTheme[]).map(t => (
                <button key={t} type="button" className={paneTheme === t ? 'on' : ''} onClick={() => setPaneTheme(t)} style={{ flex: 1 }}>
                  {t === 'Dark' ? <Moon size={13} /> : <Sun size={13} />}{t}
                </button>
              ))}
            </div>
          </div>

          {/* logo slot */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Logo</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--gx-bg-subtle)', border: '1px dashed var(--gx-border-strong)', borderRadius: 'var(--gx-radius-md)' }}>
              <Palette size={20} style={{ color: 'var(--gx-text-3)' }} />
              <span className="hint" style={{ fontSize: 12 }}>GAAex-mark.svg</span>
              <button className="btn btn-ghost btn-sm" type="button" style={{ marginLeft: 'auto' }}>
                <Upload size={13} />Replace
              </button>
            </div>
          </div>
        </div>

        {/* live preview */}
        <div
          data-theme={paneTheme.toLowerCase()}
          className="card card-pad"
          style={{ ...liveVars, background: 'var(--gx-surface)', display: 'flex', flexDirection: 'column', gap: 18 }}
        >
          <div className="lbl">Live preview · applies everywhere</div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" style={{ height: ht, padding: pad, borderRadius: radius, border: 'none', background: 'var(--gx-primary)', color: '#fff', fontFamily: 'var(--gx-font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Plus size={14} />Primary
            </button>
            <button type="button" style={{ height: ht, padding: pad, borderRadius: radius, border: '1px solid var(--gx-border-strong)', background: 'var(--gx-surface-2)', color: 'var(--gx-text-1)', fontFamily: 'var(--gx-font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Secondary
            </button>
            <button type="button" style={{ height: ht, padding: pad, borderRadius: radius, border: '1px solid var(--gx-primary)', background: 'transparent', color: 'var(--gx-primary)', fontFamily: 'var(--gx-font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Outline
            </button>
            <button type="button" style={{ height: ht, width: ht, padding: 0, borderRadius: radius, border: 'none', background: 'var(--gx-primary-soft)', color: 'var(--gx-primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Settings size={15} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: 'var(--gx-primary-soft)', color: 'var(--gx-primary)' }}>Active</span>
            <span className="pill pill-success">Online</span>
            <span className="pill pill-warning">Degraded</span>
            <span className="pill pill-danger">SLA breached</span>
          </div>

          <label className="field">
            <span>Input field</span>
            <input
              className="inp inp-sm"
              defaultValue="Fiber 500"
              style={{ borderRadius: radius, height: ht }}
              onFocus={e => { e.target.style.borderColor = 'var(--gx-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--gx-primary-soft)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--gx-border)'; e.target.style.boxShadow = 'none' }}
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: radius, background: 'var(--gx-bg-subtle)', border: '1px solid var(--gx-border)' }}>
            <span style={{ width: 34, height: 34, borderRadius: radius > 20 ? '50%' : radius, background: 'var(--gx-primary-soft)', color: 'var(--gx-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={17} />
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Active subscribers</div>
              <div className="hint" style={{ fontSize: 11 }}>128,402 · +2.4%</div>
            </div>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--gx-font-display)', fontSize: 22, fontWeight: 600, color: 'var(--gx-primary)' }}>↗</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button className="btn btn-primary btn-md" type="button" style={{ background: accent.val }} onClick={() => toast('Appearance saved')}>
          <Check size={14} />Save appearance
        </button>
        <button
          className="btn btn-ghost btn-md"
          type="button"
          onClick={() => { setAccent(ACCENTS[0]); setRadius(8); setDensity('Comfortable'); setPaneTheme('Dark') }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
