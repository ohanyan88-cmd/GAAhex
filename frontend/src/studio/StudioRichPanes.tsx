// GAAex Studio — P5 rich panes.
// Ported from kit studio-panes.jsx + Studio.jsx.
// All panes start in EMPTY / MINIMAL state — no hardcoded mock content.
// Icons: lucide-react only. State: internal useState only. No backend calls.

import { useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Columns3,
  Copy,
  CreditCard,
  Database,
  Eye,
  File,
  FilePen,
  Files,
  FileText,
  GitCommitHorizontal,
  GitCompare,
  Globe,
  Grid3X3,
  IdCard,
  Image,
  Info,
  Kanban,
  LayoutDashboard,
  LayoutTemplate,
  List,
  ListTree,
  Lock,
  Minus,
  Monitor,
  MousePointerClick,
  PanelTop,
  Plus,
  Quote,
  Rocket,
  RotateCcw,
  Rows3,
  Save,
  Search,
  Settings,
  Smartphone,
  Square,
  SquarePen,
  SquareStack,
  Store,
  Tablet,
  Table,
  TextCursorInput,
  ToggleLeft,
  Trash2,
  Type,
  Upload,
  X,
  Zap,
} from 'lucide-react'

// ── shared section header helper ──────────────────────────────────────────────

interface SecProps {
  icon: React.ReactNode
  title: string
  hint?: string
  right?: React.ReactNode
}

function Sec({ icon, title, hint, right }: SecProps) {
  return (
    <div className="section-head" style={{ marginTop: 0 }}>
      <span className="section-icon" style={{ display: 'inline-flex' }}>{icon}</span>
      {title}
      {hint && (
        <span className="hint" style={{ fontWeight: 400, marginLeft: 6 }}>· {hint}</span>
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

// ── 1  PAGE MANAGER ───────────────────────────────────────────────────────────

// TODO: bind to /api/studio/page-types (page archetype registry)
const PAGE_TYPES = ['home', 'dashboard', 'list', 'form', 'detail', 'landing', 'checkout', 'profile', 'report']

interface PageRow {
  id: string
  name: string
  type: string
  status: 'Published' | 'Draft' | 'In review'
  updated: string
}

export function PageManager() {
  const [pages, setPages] = useState<PageRow[]>([])
  let _id = { current: 1 }

  const add = () => {
    setPages(p => [
      { id: 'p' + (_id.current++), name: 'Untitled page', type: 'list', status: 'Draft', updated: 'now' },
      ...p,
    ])
  }
  const dup = (pg: PageRow) =>
    setPages(p => [{ ...pg, id: 'p' + (_id.current++), name: pg.name + ' copy', status: 'Draft', updated: 'now' }, ...p])
  const rename = (pg: PageRow) => {
    const n = window.prompt('Rename page', pg.name)
    if (n) setPages(p => p.map(x => x.id === pg.id ? { ...x, name: n, updated: 'now' } : x))
  }
  const del = (pg: PageRow) => setPages(p => p.filter(x => x.id !== pg.id))
  const setType = (pg: PageRow, t: string) =>
    setPages(p => p.map(x => x.id === pg.id ? { ...x, type: t } : x))

  const statusCls = (s: string) =>
    s === 'Published' ? 'pill pill-success' : s === 'Draft' ? 'pill pill-neutral' : 'pill pill-warning'

  return (
    <div>
      <Sec
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
              <th>Page</th><th>Type</th><th>Status</th><th>Updated</th>
              <th style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {pages.map(pg => (
              <tr key={pg.id} style={{ cursor: 'default' }}>
                <td style={{ fontWeight: 600 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <File size={14} style={{ color: 'var(--gx-text-3)' }} />{pg.name}
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
                    <button className="btn btn-ghost btn-sm btn-icon" title="Rename" type="button" onClick={() => rename(pg)}>
                      <FilePen size={14} />
                    </button>
                    <button className="btn btn-ghost btn-sm btn-icon" title="Duplicate" type="button" onClick={() => dup(pg)}>
                      <Copy size={14} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Delete"
                      type="button"
                      onClick={() => del(pg)}
                      style={{ color: 'var(--gx-danger-fg)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pages.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--gx-text-3)' }}>
                  No pages yet — click <strong>New page</strong> to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 2  LAYOUT BUILDER ─────────────────────────────────────────────────────────

type Device = 'desktop' | 'tablet' | 'mobile'

interface CanvasBlock {
  id: number
  type: string
  h: number
}

// TODO: bind to /api/studio/layout-blocks (registered block types for the layout builder)
const BLOCK_PALETTE: [React.ReactNode, string][] = [
  [<Rows3 size={16} />, 'Section'],
  [<Columns3 size={16} />, 'Columns'],
  [<Grid3X3 size={16} />, 'Grid'],
  [<Square size={16} />, 'Card'],
  [<File size={16} />, 'Tabs'],
  [<SquareStack size={16} />, 'Modal'],
  [<Minus size={16} />, 'Divider'],
  [<Image size={16} />, 'Media'],
]

export function LayoutBuilder() {
  const [device, setDevice] = useState<Device>('desktop')
  const [blocks, setBlocks] = useState<CanvasBlock[]>([])
  let _id = { current: 1 }

  const addBlock = (t: string) =>
    setBlocks(b => [...b, { id: _id.current++, type: t, h: t === 'Grid' ? 140 : t === 'Modal' ? 110 : 80 }])
  const rm = (id: number) => setBlocks(b => b.filter(x => x.id !== id))
  const move = (i: number, d: number) =>
    setBlocks(b => {
      const n = [...b]
      const j = i + d
      if (j < 0 || j >= n.length) return n
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  const W = device === 'desktop' ? '100%' : device === 'tablet' ? 620 : 340

  return (
    <div>
      <Sec
        icon={<LayoutTemplate size={15} />}
        title="Layout Builder"
        hint="drop sections, columns, grids, cards, tabs, modals"
        right={
          <div className="seg">
            {([['desktop', <Monitor size={13} />], ['tablet', <Tablet size={13} />], ['mobile', <Smartphone size={13} />]] as [Device, React.ReactNode][]).map(
              ([d, ic]) => (
                <button key={d} className={device === d ? 'on' : ''} type="button" onClick={() => setDevice(d)}>
                  {ic}
                </button>
              ),
            )}
          </div>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16 }}>
        {/* palette */}
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>Blocks</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {BLOCK_PALETTE.map(([ic, label]) => (
              <button
                key={label as string}
                className="palette-block"
                type="button"
                style={{ flexDirection: 'column', gap: 6, padding: '10px 8px', fontSize: 11 }}
                onClick={() => addBlock(label as string)}
              >
                {ic}
                <span>{label}</span>
              </button>
            ))}
          </div>
          <p className="hint" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
            Click a block to drop it on the canvas.
          </p>
        </div>
        {/* canvas */}
        <div className="card" style={{ padding: 16, background: 'var(--gx-bg-subtle)', minHeight: 420 }}>
          <div
            style={{
              width: W,
              margin: '0 auto',
              transition: 'width var(--gx-dur-base)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {blocks.map((b, i) => (
              <div key={b.id} className="canvas-block" style={{ height: b.h }}>
                <span className="canvas-tag">{b.type}</span>
                <div className="canvas-actions">
                  <button type="button" onClick={() => move(i, -1)} title="Up"><ChevronUp size={13} /></button>
                  <button type="button" onClick={() => move(i, 1)} title="Down"><ChevronDown size={13} /></button>
                  <button type="button" onClick={() => rm(b.id)} title="Remove" style={{ color: 'var(--gx-danger-fg)' }}>
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
            {blocks.length === 0 && (
              <div style={{
                flex: 1,
                minHeight: 360,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px dashed var(--gx-border)',
                borderRadius: 'var(--gx-radius-lg)',
                color: 'var(--gx-text-3)',
                fontSize: 13,
                flexDirection: 'column',
                gap: 10,
              }}>
                <LayoutTemplate size={28} style={{ opacity: 0.35 }} />
                <span>Canvas is empty — pick a block from the palette</span>
                <button className="canvas-add" type="button" onClick={() => addBlock('Section')}>
                  <Plus size={14} />Add block
                </button>
              </div>
            )}
            {blocks.length > 0 && (
              <button className="canvas-add" type="button" onClick={() => addBlock('Section')}>
                <Plus size={14} />Add block
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 3  COMPONENTS LIBRARY ─────────────────────────────────────────────────────

// TODO: bind to /api/studio/components (component registry grouped by category)
const COMP_GROUPS: [string, [React.ReactNode, string][]][] = [
  [
    'Inputs',
    [
      [<MousePointerClick size={18} />, 'Button'],
      [<TextCursorInput size={18} />, 'Text field'],
      [<List size={18} />, 'Select'],
      [<ToggleLeft size={18} />, 'Toggle'],
      [<Calendar size={18} />, 'Date picker'],
    ],
  ],
  [
    'Data',
    [
      [<Table size={18} />, 'Table'],
      [<BarChart3 size={18} />, 'Chart'],
      [<Globe size={18} />, 'KPI tile'],
      [<Kanban size={18} />, 'Board'],
      [<ListTree size={18} />, 'Tree'],
    ],
  ],
  [
    'Layout',
    [
      [<PanelTop size={18} />, 'Banner'],
      [<List size={18} />, 'Menu'],
      [<Square size={18} />, 'Card'],
      [<File size={18} />, 'Tabs'],
      [<Rows3 size={18} />, 'List'],
    ],
  ],
  [
    'Content',
    [
      [<FileText size={18} />, 'Form'],
      [<Image size={18} />, 'Gallery'],
      [<CreditCard size={18} />, 'Pricing card'],
      [<Quote size={18} />, 'Testimonial'],
      [<Image size={18} />, 'Media'],
    ],
  ],
]

export function ComponentsLibrary() {
  const [q, setQ] = useState('')

  return (
    <div>
      <Sec
        icon={<SquareStack size={15} />}
        title="Components Library"
        hint="reusable blocks — drag into any page"
        right={
          <div className="tb-search" style={{ width: 200, height: 30 }}>
            <Search size={14} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 12.5, fontFamily: 'var(--gx-font-sans)' }}
            />
          </div>
        }
      />
      {COMP_GROUPS.map(([group, items]) => {
        const filtered = items.filter(([, name]) => !q || (name as string).toLowerCase().includes(q.toLowerCase()))
        if (!filtered.length) return null
        return (
          <div key={group} style={{ marginBottom: 18 }}>
            <div className="lbl" style={{ marginBottom: 10 }}>{group}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(132px,1fr))', gap: 10 }}>
              {filtered.map(([ic, name]) => (
                <button
                  key={name as string}
                  className="comp-card"
                  type="button"
                  draggable
                >
                  <span className="comp-ic">{ic}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{name}</span>
                  <Plus size={13} className="comp-add" />
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {q && !COMP_GROUPS.some(([, items]) => items.some(([, n]) => (n as string).toLowerCase().includes(q.toLowerCase()))) && (
        <p className="hint" style={{ textAlign: 'center', padding: '30px 0' }}>No components match "{q}"</p>
      )}
    </div>
  )
}

// ── 4  CONTENT EDITOR ─────────────────────────────────────────────────────────

export function ContentEditor() {
  const [tab, setTab] = useState<'content' | 'seo'>('content')

  return (
    <div>
      <Sec
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
          <label className="field"><span>Page title</span><input className="inp inp-sm" /></label>
          <label className="field"><span>Subtitle</span><input className="inp inp-sm" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span>Body text</span>
            <textarea className="inp" rows={4} style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }} />
          </label>
          <label className="field"><span>Primary button label</span><input className="inp inp-sm" /></label>
          <label className="field"><span>Button link</span><input className="inp inp-sm mono" /></label>
          <label className="field">
            <span>Image</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--gx-bg-subtle)', border: '1px dashed var(--gx-border-strong)', borderRadius: 'var(--gx-radius-md)' }}>
              <Image size={18} style={{ color: 'var(--gx-text-3)' }} />
              <span className="hint" style={{ fontSize: 12 }}>No image</span>
              <button className="btn btn-ghost btn-sm" type="button" style={{ marginLeft: 'auto' }}>
                <Upload size={13} />Upload
              </button>
            </div>
          </label>
          <label className="field"><span>Placeholder text</span><input className="inp inp-sm" /></label>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14, maxWidth: 560 }}>
          <label className="field"><span>SEO title</span><input className="inp inp-sm" /></label>
          <label className="field">
            <span>Meta description</span>
            <textarea className="inp" rows={3} style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }} />
          </label>
          <label className="field"><span>URL slug</span><input className="inp inp-sm mono" /></label>
        </div>
      )}
      <div style={{ marginTop: 18 }}>
        {/* TODO: wire onClick to /api/pages/{pageId}/content (PUT) — disabled until backend exists */}
        <button className="btn btn-primary btn-sm" type="button" disabled>
          <Check size={13} />Save content
        </button>
      </div>
    </div>
  )
}

// ── 5  DATA BINDING ───────────────────────────────────────────────────────────

// TODO: bind to /api/data/sources (tenant-registered entity sources for binding picker)
const BINDING_SOURCES = ['Customers', 'Orders', 'Invoices', 'Tickets', 'Devices', 'Subscriptions', 'Payments']

interface Binding {
  id: number
  comp: string
  src: string
  field: string
}

export function DataBinding() {
  const [binds, setBinds] = useState<Binding[]>([])
  let _id = { current: 1 }

  const add = () =>
    setBinds(b => [...b, { id: _id.current++, comp: '', src: BINDING_SOURCES[0], field: '' }])
  const upd = (id: number, patch: Partial<Binding>) =>
    setBinds(b => b.map(x => x.id === id ? { ...x, ...patch } : x))
  const del = (id: number) => setBinds(b => b.filter(x => x.id !== id))

  return (
    <div>
      <Sec
        icon={<Database size={15} />}
        title="Data Binding"
        hint="connect components to database / API fields"
      />
      {binds.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Component</th><th>Data source</th><th>Expression</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {binds.map(b => (
                <tr key={b.id} style={{ cursor: 'default' }}>
                  <td>
                    <input
                      className="inp inp-sm"
                      placeholder="Component name"
                      value={b.comp}
                      onChange={e => upd(b.id, { comp: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="inp inp-sm"
                      style={{ width: 140 }}
                      value={b.src}
                      onChange={e => upd(b.id, { src: e.target.value })}
                    >
                      {BINDING_SOURCES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      className="inp inp-sm mono"
                      placeholder="e.g. count(status=Active)"
                      value={b.field}
                      onChange={e => upd(b.id, { field: e.target.value })}
                    />
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm btn-icon" type="button" onClick={() => del(b.id)}>
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {binds.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13 }}>
          No bindings yet — click <strong>Bind a component</strong> to connect data.
        </div>
      )}
      <button className="btn btn-primary btn-sm" type="button" onClick={add}>
        <Plus size={13} />Bind a component
      </button>
    </div>
  )
}

// ── 6  ACTIONS & LOGIC ────────────────────────────────────────────────────────

interface Rule {
  id: number
  on: string
  cond: string
  act: string
  en: boolean
}

export function ActionsLogic() {
  const [rules, setRules] = useState<Rule[]>([
    { id: 1, on: '', cond: '', act: '', en: true },
  ])
  let _id = { current: 2 }

  const toggle = (id: number) => setRules(r => r.map(x => x.id === id ? { ...x, en: !x.en } : x))
  const upd = (id: number, patch: Partial<Rule>) => setRules(r => r.map(x => x.id === id ? { ...x, ...patch } : x))
  const add = () => setRules(r => [...r, { id: _id.current++, on: '', cond: '', act: '', en: true }])
  const del = (id: number) => setRules(r => r.filter(x => x.id !== id))

  return (
    <div>
      <Sec
        icon={<Zap size={15} />}
        title="Actions & Logic"
        hint="button actions, submit behavior, navigation, conditions, visibility"
        right={
          <button className="btn btn-primary btn-sm" type="button" onClick={add}>
            <Plus size={13} />New rule
          </button>
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rules.map(r => (
          <div key={r.id} className="rule-card">
            <span className="rule-pill" style={{ background: 'var(--gx-primary-soft)', color: 'var(--gx-info-fg)' }}>
              WHEN
            </span>
            <input
              className="inp inp-sm"
              placeholder="Event trigger…"
              value={r.on}
              onChange={e => upd(r.id, { on: e.target.value })}
              style={{ flex: 1, minWidth: 120 }}
            />
            <span className="rule-pill" style={{ background: 'var(--gx-warning-soft)', color: 'var(--gx-warning-fg)' }}>IF</span>
            <input
              className="inp inp-sm mono"
              placeholder="Condition…"
              value={r.cond}
              onChange={e => upd(r.id, { cond: e.target.value })}
              style={{ flex: 1, minWidth: 100 }}
            />
            <ArrowRight size={14} style={{ color: 'var(--gx-text-3)', flexShrink: 0 }} />
            <span className="rule-pill" style={{ background: 'var(--gx-success-soft)', color: 'var(--gx-success-fg)' }}>DO</span>
            <input
              className="inp inp-sm"
              placeholder="Action…"
              value={r.act}
              onChange={e => upd(r.id, { act: e.target.value })}
              style={{ flex: 1, minWidth: 120 }}
            />
            <span style={{ flex: 0 }} />
            <button
              onClick={() => toggle(r.id)}
              className={'gx-toggle' + (r.en ? ' on' : '')}
              type="button"
              aria-label="Toggle rule"
            >
              <span className="knob" />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" type="button" onClick={() => del(r.id)}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 7  PERMISSIONS ────────────────────────────────────────────────────────────

// TODO: bind to /api/roles (tenant role catalog from auth kernel)
const PERM_ROLES = ['Admin', 'Manager', 'Agent', 'Field Tech', 'Guest']
// TODO: bind to /api/pages (registered pages enforceable by the auth kernel)
const PERM_PAGES = ['Operations Home', 'Invoices', 'New Order', 'Customer 360', 'Settings']

type PermLevel = 'none' | 'view' | 'edit'

export function Permissions() {
  const [grid, setGrid] = useState<PermLevel[][]>(() =>
    PERM_PAGES.map(() => PERM_ROLES.map(() => 'none' as PermLevel)),
  )

  const cycle = (pi: number, ri: number) =>
    setGrid(g =>
      g.map((row, p) =>
        p === pi
          ? row.map((c, r) => r === ri ? (c === 'none' ? 'view' : c === 'view' ? 'edit' : 'none') : c)
          : row,
      ),
    )

  const dot = (v: PermLevel): [string, string] =>
    v === 'edit'
      ? ['Edit', 'var(--gx-success)']
      : v === 'view'
      ? ['View', 'var(--gx-warning)']
      : ['—', 'var(--gx-text-3)']

  return (
    <div>
      <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each page or component" />
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Page</th>
              {PERM_ROLES.map(r => <th key={r} style={{ textAlign: 'center' }}>{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERM_PAGES.map((pg, pi) => (
              <tr key={pg} style={{ cursor: 'default' }}>
                <td style={{ fontWeight: 600 }}>{pg}</td>
                {PERM_ROLES.map((_, ri) => {
                  const [label, color] = dot(grid[pi][ri])
                  return (
                    <td key={ri} style={{ textAlign: 'center' }}>
                      <button
                        className="perm-cell"
                        type="button"
                        onClick={() => cycle(pi, ri)}
                        style={{ color }}
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
        Click a cell to cycle None → View → Edit. Enforced server-side by the auth kernel.
      </p>
    </div>
  )
}

// ── 8  PREVIEW MODE ───────────────────────────────────────────────────────────

// TODO: bind to /api/roles (tenant role catalog for preview impersonation)
const PREVIEW_ROLES = ['Admin', 'Manager', 'Agent', 'Field Tech', 'Guest']

export function PreviewMode() {
  const [device, setDevice] = useState<Device>('desktop')
  const [role, setRole] = useState('Admin')

  const W = device === 'desktop' ? '100%' : device === 'tablet' ? 640 : 360

  return (
    <div>
      <Sec
        icon={<Eye size={15} />}
        title="Preview Mode"
        hint="preview as device & as different user roles"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="inp inp-sm"
              style={{ width: 130 }}
              value={role}
              onChange={e => setRole(e.target.value)}
            >
              {PREVIEW_ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
            <div className="seg">
              {([['desktop', <Monitor size={13} />], ['tablet', <Tablet size={13} />], ['mobile', <Smartphone size={13} />]] as [Device, React.ReactNode][]).map(
                ([d, ic]) => (
                  <button key={d} className={device === d ? 'on' : ''} type="button" onClick={() => setDevice(d)}>
                    {ic}
                  </button>
                ),
              )}
            </div>
          </div>
        }
      />
      <div className="card" style={{ padding: 16, background: 'var(--gx-bg-subtle)' }}>
        <div
          style={{
            width: W,
            margin: '0 auto',
            transition: 'width var(--gx-dur-base)',
            background: 'var(--gx-surface)',
            border: '1px solid var(--gx-border)',
            borderRadius: 'var(--gx-radius-lg)',
            overflow: 'hidden',
            boxShadow: 'var(--gx-shadow-md)',
          }}
        >
          {/* browser chrome */}
          <div style={{ height: 38, borderBottom: '1px solid var(--gx-border-subtle)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
            <span style={{ display: 'flex', gap: 5 }}>
              {['var(--gx-danger)', 'var(--gx-warning)', 'var(--gx-success)'].map((c, i) => (
                <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
              ))}
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--gx-text-3)' }}>gaaex.app</span>
            <span className="pill pill-gold" style={{ marginLeft: 'auto', height: 18 }}>as {role}</span>
          </div>
          {/* empty preview body */}
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: 'var(--gx-text-3)', fontSize: 13, gap: 8 }}>
            <Eye size={28} style={{ opacity: 0.3 }} />
            <span>No preview available — publish first</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 9  VERSION HISTORY ────────────────────────────────────────────────────────

export function VersionHistory() {
  return (
    <div>
      <Sec
        icon={<GitCommitHorizontal size={15} />}
        title="Version History"
        hint="save drafts, publish, rollback, compare"
        right={
          <button className="btn btn-secondary btn-sm" type="button" disabled>
            <GitCompare size={13} />Compare
          </button>
        }
      />
      <div className="timeline" style={{ minHeight: 160 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '50px 0', color: 'var(--gx-text-3)', fontSize: 13, gap: 8 }}>
          <GitCommitHorizontal size={28} style={{ opacity: 0.3 }} />
          <span>No versions yet — publish to create version 1</span>
        </div>
      </div>
    </div>
  )
}

// ── 10  TEMPLATES ─────────────────────────────────────────────────────────────

// TODO: bind to /api/templates (template gallery from tenant template registry)
const TEMPLATE_GALLERY: [React.ReactNode, string, string][] = [
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
      <Sec icon={<Store size={15} />} title="Templates" hint="ready-made pages & reusable saved sections" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 14 }}>
        {TEMPLATE_GALLERY.map(([ic, name, desc]) => (
          <div key={name as string} className="tpl-card">
            <div className="tpl-thumb">{ic}</div>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
              <div className="hint" style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
              {/* TODO: wire onClick to /api/templates/{templateId}/instantiate (POST) — disabled until backend exists */}
              <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 10 }} type="button" disabled>
                <Plus size={13} />Use template
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 11  PUBLISH SETTINGS ──────────────────────────────────────────────────────

export function PublishSettings() {
  const [status, setStatus] = useState('Draft')
  const [access, setAccess] = useState('Authenticated')
  const [code, setCode] = useState(false)

  return (
    <div>
      <Sec icon={<Rocket size={15} />} title="Publish Settings" hint="slug, status, access, language, metadata, custom code" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 680 }}>
        <label className="field">
          <span>URL slug</span>
          <input className="inp inp-sm mono" placeholder="/page-slug" />
        </label>
        <label className="field">
          <span>Status</span>
          <div className="seg" style={{ width: '100%' }}>
            {/* TODO: bind to /api/pages/statuses (workflow status registry) */}
            {['Draft', 'In review', 'Published'].map(s => (
              <button key={s} className={status === s ? 'on' : ''} type="button" onClick={() => setStatus(s)} style={{ flex: 1 }}>
                {s}
              </button>
            ))}
          </div>
        </label>
        <label className="field">
          <span>Access level</span>
          {/* TODO: bind to /api/auth/access-levels (access-level registry from auth kernel) */}
          <select className="inp inp-sm" value={access} onChange={e => setAccess(e.target.value)}>
            {['Public', 'Authenticated', 'Role-restricted', 'Admin only'].map(a => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Language</span>
          {/* TODO: bind to /api/tenant/settings/locales (enabled locales) */}
          <select className="inp inp-sm">
            {['Հայերեն (hy-AM)', 'English (en)', 'Русский (ru)'].map(l => <option key={l}>{l}</option>)}
          </select>
        </label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Page metadata (title / description)</span>
          <input className="inp inp-sm" placeholder="Page title" style={{ marginBottom: 8 }} />
          <textarea
            className="inp"
            rows={2}
            style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }}
            placeholder="Meta description"
          />
        </label>
      </div>
      <div className="section-head">
        <Settings size={15} className="section-icon" />
        Custom code
        <span style={{ flex: 1 }} />
        <button onClick={() => setCode(c => !c)} className={'gx-toggle' + (code ? ' on' : '')} type="button" aria-label="Toggle custom code">
          <span className="knob" />
        </button>
      </div>
      {code && (
        <textarea
          className="inp mono"
          rows={4}
          style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical', fontSize: 12 }}
          placeholder="<!-- custom head/script injected on publish -->"
        />
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        {/* TODO: wire onClick to /api/pages/{pageId}/publish (POST) — disabled until backend exists */}
        <button className="btn btn-primary" type="button" disabled>
          <Rocket size={14} />Publish now
        </button>
        {/* TODO: wire onClick to /api/pages/{pageId}/draft (PUT) — disabled until backend exists */}
        <button className="btn btn-secondary" type="button" disabled>
          <Save size={14} />Save draft
        </button>
      </div>
    </div>
  )
}

// ── 12  ENTITY BUILDER ────────────────────────────────────────────────────────

// TODO: bind to /api/studio/field-types (field-type registry from entity kernel)
const FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'select', 'ref', 'status', 'email', 'phone', 'url']

interface EntityField {
  key: string
  label: string
  type: string
  required: boolean
  extra: string
}

interface EntityStatus {
  key: string
  label: string
  is_initial: boolean
}

export function EntityBuilder() {
  const [label, setLabel] = useState('')
  const [labelPlural, setLabelPlural] = useState('')
  const [key, setKey] = useState('')
  const [slug, setSlug] = useState('')
  const [icon, setIcon] = useState('')
  const [fields, setFields] = useState<EntityField[]>([])
  const [statuses, setStatuses] = useState<EntityStatus[]>([])
  const [created, setCreated] = useState(false)

  const upd = (i: number, patch: Partial<EntityField>) =>
    setFields(f => f.map((r, j) => j === i ? { ...r, ...patch } : r))
  const addField = () =>
    setFields(f => [...f, { key: '', label: '', type: 'text', required: false, extra: '' }])
  const rmField = (i: number) => setFields(f => f.filter((_, j) => j !== i))

  const addStatus = () => {
    const k = window.prompt('Status key (UPPER_SNAKE)')
    if (!k) return
    const l = window.prompt('Status label', k) ?? k
    setStatuses(s => [...s, { key: k.toUpperCase(), label: l, is_initial: s.length === 0 }])
  }
  const rmStatus = (k: string) => setStatuses(s => s.filter(x => x.key !== k))

  // Auto-derive key/slug from label
  const handleLabelChange = (v: string) => {
    setLabel(v)
    if (!key) setKey(v.toLowerCase().replace(/\s+/g, '_'))
    if (!slug) setSlug(v.toLowerCase().replace(/\s+/g, '-') + 's')
    if (!labelPlural) setLabelPlural(v + 's')
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--gx-font-sans)', fontSize: 16, fontWeight: 600 }}>New entity</h3>
          <p className="hint" style={{ margin: 0 }}>Define an entity as configuration. No code, no SQL — it appears in the sidebar instantly.</p>
        </div>
      </div>

      {created && (
        <div className="banner" style={{ marginBottom: 16, borderLeftColor: 'var(--gx-success)', background: 'var(--gx-success-soft)' }}>
          <Info size={16} style={{ color: 'var(--gx-success)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="bt">Done</div>
            <div className="bm">Created &ldquo;{labelPlural || label}&rdquo; — it&apos;s now in the sidebar and fully working.</div>
          </div>
        </div>
      )}

      {/* Identity */}
      <Sec icon={<SquarePen size={15} />} title="Identity" />
      <div className="rec-form">
        <label className="field">
          <span>Label *</span>
          <input className="inp inp-sm" value={label} onChange={e => handleLabelChange(e.target.value)} placeholder="e.g. Opportunity" />
        </label>
        <label className="field">
          <span>Key (snake_case) *</span>
          <input className="inp inp-sm mono" value={key} onChange={e => setKey(e.target.value)} placeholder="opportunity" />
        </label>
        <label className="field">
          <span>Label plural</span>
          <input className="inp inp-sm" value={labelPlural} onChange={e => setLabelPlural(e.target.value)} placeholder="Opportunities" />
        </label>
        <label className="field">
          <span>Route slug (kebab) *</span>
          <input className="inp inp-sm mono" value={slug} onChange={e => setSlug(e.target.value)} placeholder="opportunities" />
        </label>
        <label className="field">
          <span>Icon</span>
          <input className="inp inp-sm" value={icon} onChange={e => setIcon(e.target.value)} placeholder="git-branch" />
        </label>
      </div>

      {/* Fields */}
      <Sec
        icon={<SquarePen size={15} />}
        title="Fields"
        right={
          <button className="btn btn-primary btn-sm" type="button" onClick={addField}>
            <Plus size={13} />Add field
          </button>
        }
      />
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Key</th><th>Label</th><th>Type</th><th>Required</th><th>Options / ref</th><th />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td>
                  <input className="inp inp-sm mono" value={f.key} onChange={e => upd(i, { key: e.target.value })} placeholder="field_key" />
                </td>
                <td>
                  <input className="inp inp-sm" value={f.label} onChange={e => upd(i, { label: e.target.value })} placeholder="Label" />
                </td>
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
                  <button className="btn btn-ghost btn-sm btn-icon" type="button" onClick={() => rmField(i)} aria-label="Remove">
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {fields.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--gx-text-3)' }}>
                  No fields yet — click <strong>Add field</strong>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Statuses */}
      <Sec icon={<ArrowRight size={15} />} title="Statuses" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {statuses.map((s, i) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              className="pill"
              style={{ background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border)', height: 26, color: 'var(--gx-text-1)' }}
            >
              {s.is_initial && <span className="d" style={{ background: 'var(--gx-gold)' }} />}
              <span className="mono">{s.key}</span>
            </span>
            {i < statuses.length - 1 && <ArrowRight size={14} style={{ color: 'var(--gx-text-3)' }} />}
            <button
              className="btn btn-ghost btn-xs"
              type="button"
              title="Remove status"
              style={{ color: 'var(--gx-danger)', padding: '2px 4px' }}
              onClick={() => rmStatus(s.key)}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <button className="btn btn-ghost btn-sm" type="button" onClick={addStatus}>
          <Plus size={13} />Status
        </button>
        {statuses.length === 0 && (
          <span className="hint" style={{ fontSize: 12 }}>No statuses — click + Status to add the first.</span>
        )}
      </div>

      {/* Live preview — reactive, not hardcoded */}
      <Sec
        icon={<Eye size={15} />}
        title="Live preview"
        hint="what this config renders"
      />
      {fields.filter(f => f.key).length === 0 && !label ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13, border: '1px dashed var(--gx-border)', borderRadius: 'var(--gx-radius-md)' }}>
          Fill in the identity and add at least one field to see a preview.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Generated form */}
          <div className="card card-pad">
            <div className="lbl" style={{ marginBottom: 12 }}>Generated record form</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {fields.filter(f => f.key).map(f => (
                <label className="field" key={f.key}>
                  <span>{f.label || f.key}{f.required && <span style={{ color: 'var(--gx-danger)' }}> *</span>}</span>
                  {f.type === 'status'
                    ? <select className="inp inp-sm">{statuses.map(s => <option key={s.key}>{s.label}</option>)}</select>
                    : f.type === 'boolean'
                    ? <div className="seg" style={{ alignSelf: 'flex-start' }}><button className="on" type="button">Yes</button><button type="button">No</button></div>
                    : <input
                        className={'inp inp-sm' + (f.type === 'money' || f.type === 'number' ? ' mono' : '')}
                        placeholder={f.type === 'money' ? '$0.00' : f.type === 'ref' ? 'Pick a ' + f.extra : f.type}
                      />
                  }
                </label>
              ))}
            </div>
            {label && (
              /* TODO: wire onClick to /api/entities/{key}/records (POST) — disabled until backend exists */
              <button className="btn btn-primary btn-sm" type="button" style={{ marginTop: 14 }} disabled>
                <Check size={13} />Save {label}
              </button>
            )}
          </div>
          {/* Generated list */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-head" style={{ padding: '10px 14px' }}>
              <h3 style={{ fontSize: 13 }}>{labelPlural || label + 's'}</h3>
              <span style={{ flex: 1 }} />
              <span className="pill pill-neutral">list view</span>
            </div>
            <table className="grid">
              <thead>
                <tr>{fields.filter(f => f.key).slice(0, 4).map(f => <th key={f.key}>{f.label || f.key}</th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={Math.max(1, fields.filter(f => f.key).slice(0, 4).length)} style={{ textAlign: 'center', padding: '18px', color: 'var(--gx-text-3)', fontSize: 12 }}>
                    No records yet
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="banner" style={{ margin: '20px 0 18px' }}>
        <Info size={16} style={{ color: 'var(--gx-primary)', flexShrink: 0, marginTop: 1 }} />
        <div>
          <div className="bt">Schema is config — no code change required</div>
          <div className="bm">
            Changes write to <code className="codez">studio_config</code>. Existing records validate lazily on next read.
          </div>
        </div>
      </div>

      {/* TODO: wire onClick to /api/entities (POST — persist entity schema to studio_config); currently only flips local `created` banner. Disabled until backend exists. */}
      <button className="btn btn-gold btn-md" type="button" onClick={() => setCreated(true)} disabled>
        <Check size={14} />Create entity
      </button>
    </div>
  )
}

// ── 13  APPEARANCE PANE ───────────────────────────────────────────────────────

// TODO: bind to /api/tenant/settings/theme/accents (curated tenant accent palette)
const ACCENTS = [
  { name: 'Azure',   val: '#3B7BE0', hover: '#5293F2', active: '#2C63BC', soft: 'rgba(59,123,224,.16)' },
  { name: 'Cobalt',  val: '#2A5187', hover: '#3A6299', active: '#1C3B68', soft: 'rgba(42,81,135,.20)' },
  { name: 'Gold',    val: '#C5A059', hover: '#D2B06E', active: '#AC8847', soft: 'rgba(197,160,89,.18)' },
  { name: 'Emerald', val: '#1F9D57', hover: '#34C77B', active: '#16804A', soft: 'rgba(31,157,87,.16)' },
  { name: 'Violet',  val: '#8B6FD6', hover: '#A78BE6', active: '#6F52BD', soft: 'rgba(139,111,214,.18)' },
  { name: 'Teal',    val: '#2A9DB5', hover: '#41B4CC', active: '#1F8398', soft: 'rgba(42,157,181,.18)' },
]

// TODO: bind to /api/tenant/settings/theme/radii (radius preset registry)
const RADII: [string, number][] = [['Sharp', 4], ['Soft', 8], ['Rounded', 13], ['Pill', 999]]

interface Accent { name: string; val: string; hover: string; active: string; soft: string }

export function AppearancePane() {
  const [accent, setAccent] = useState<Accent>(ACCENTS[0])
  const [radius, setRadius] = useState(8)
  const [density, setDensity] = useState('Comfortable')
  const [paneTheme, setPaneTheme] = useState('Dark')

  const pad = density === 'Compact' ? '0 12px' : density === 'Spacious' ? '0 22px' : '0 16px'
  const ht = density === 'Compact' ? 28 : density === 'Spacious' ? 42 : 34

  const live: React.CSSProperties & Record<string, string> = {
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
          {/* Accent */}
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

          {/* Radius */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Corner radius</div>
            <div className="seg" style={{ width: '100%' }}>
              {RADII.map(([name, r]) => (
                <button key={name} className={radius === r ? 'on' : ''} type="button" onClick={() => setRadius(r)} style={{ flex: 1 }}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Density */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Density</div>
            <div className="seg" style={{ width: '100%' }}>
              {/* TODO: bind to /api/tenant/settings/theme/density (density preset list) */}
              {['Compact', 'Comfortable', 'Spacious'].map(d => (
                <button key={d} className={density === d ? 'on' : ''} type="button" onClick={() => setDensity(d)} style={{ flex: 1 }}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Default theme</div>
            <div className="seg" style={{ width: '100%' }}>
              {/* TODO: bind to /api/tenant/settings/theme/modes (available theme modes) */}
              {['Dark', 'Light'].map(t => (
                <button key={t} className={paneTheme === t ? 'on' : ''} type="button" onClick={() => setPaneTheme(t)} style={{ flex: 1 }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* live preview */}
        <div
          data-theme={paneTheme.toLowerCase()}
          className="card card-pad"
          style={{ ...live, background: 'var(--gx-surface)', display: 'flex', flexDirection: 'column', gap: 18 } as React.CSSProperties}
        >
          <div className="lbl">Live preview · applies everywhere</div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={{ height: ht, padding: pad, borderRadius: radius, border: 'none', background: 'var(--gx-primary)', color: '#fff', fontFamily: 'var(--gx-font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }} type="button">
              <Plus size={14} />Primary
            </button>
            <button style={{ height: ht, padding: pad, borderRadius: radius, border: '1px solid var(--gx-border-strong)', background: 'var(--gx-surface-2)', color: 'var(--gx-text-1)', fontFamily: 'var(--gx-font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} type="button">
              Secondary
            </button>
            <button style={{ height: ht, padding: pad, borderRadius: radius, border: '1px solid var(--gx-primary)', background: 'transparent', color: 'var(--gx-primary)', fontFamily: 'var(--gx-font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} type="button">
              Outline
            </button>
            <button style={{ height: ht, width: ht, padding: 0, borderRadius: radius, border: 'none', background: 'var(--gx-primary-soft)', color: 'var(--gx-primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} type="button">
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
              placeholder="Sample value"
              style={{ borderRadius: radius, height: ht }}
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: radius, background: 'var(--gx-bg-subtle)', border: '1px solid var(--gx-border)' }}>
            <span style={{ width: 34, height: 34, borderRadius: radius > 20 ? '50%' : radius, background: 'var(--gx-primary-soft)', color: 'var(--gx-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Globe size={17} />
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Active subscribers</div>
              <div className="hint" style={{ fontSize: 11 }}>—</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        {/* TODO: wire onClick to /api/tenant/settings/theme (PUT) — disabled until backend exists */}
        <button className="btn btn-primary btn-md" type="button" style={{ background: accent.val }} disabled>
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

// ── re-export for convenience ─────────────────────────────────────────────────

export const RICH_PANE_MAP: Record<string, React.ComponentType> = {
  'Page Registry':          PageManager,
  'Page Builder':           LayoutBuilder,
  'Dynamic Pages':          PageManager,
  'Page Versioning':        VersionHistory,
  'Component Registry':     ComponentsLibrary,
  'Component Builder':      ComponentsLibrary,
  'Component Marketplace':  ComponentsLibrary,
  'Grid System':            LayoutBuilder,
  'Layout Templates':       LayoutBuilder,
  'Layout Library':         Templates,
  'Custom Templates':       Templates,
  'Brand Identity':         AppearancePane,
  'Colors':                 AppearancePane,
  'Design Tokens':          AppearancePane,
  'Theme Inheritance':      AppearancePane,
  'Entities':               EntityBuilder,
  'Fields':                 EntityBuilder,
  'External APIs':          DataBinding,
  REST:                     DataBinding,
  GraphQL:                  DataBinding,
  Triggers:                 ActionsLogic,
  Conditions:               ActionsLogic,
  Actions:                  ActionsLogic,
  'Business Rules':         ActionsLogic,
  Permissions:              Permissions,
  'Component Permissions':  Permissions,
  'Access Mapping':         Permissions,
  Preview:                  PreviewMode,
  Versioning:               VersionHistory,
  'Workflow Versions':      VersionHistory,
  Deployment:               PublishSettings,
  SEO:                      ContentEditor,
  'Meta Tags':              ContentEditor,
}

export function richPaneFor(leafLabel: string): React.ComponentType | null {
  return RICH_PANE_MAP[leafLabel] ?? null
}
