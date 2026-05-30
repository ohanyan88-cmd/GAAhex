// GAAex Studio — P5 rich panes.
// Ported from kit studio-panes.jsx + Studio.jsx.
// All panes start in EMPTY / MINIMAL state — no hardcoded mock content.
// Icons: lucide-react only. State: internal useState only. No backend calls.

import { useState, useEffect, useCallback, useRef } from 'react'
import { bget, bpatch, bput } from '../lib/billing'
import { getEntities, getEntityDef } from '../lib/api'
import { timeAgo } from '../lib/time'
import { PermissionDenied, ErrorBanner, EmptyState, SkeletonRows } from '../components/States'
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
// Wired to real entities/fields (GET /meta/entities, GET /meta/entities/{slug}).
// Persistence layer for the bindings list itself does not exist yet — "Save bindings"
// stays disabled until a /api/page-bindings endpoint lands.

type EntityRef = { key: string; label: string; label_plural?: string; route_slug: string }
type FieldRef  = { key: string; label: string; type: string }

interface Binding {
  id: number
  comp: string
  src: string   // route_slug of an entity (empty until picked)
  field: string // field key (empty until picked)
}

export function DataBinding({ token }: { token?: string } = {}) {
  const [entities, setEntities] = useState<EntityRef[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cache of entity slug → fields list (lazy-fetched on src selection)
  const [fieldsBySrc, setFieldsBySrc] = useState<Record<string, FieldRef[]>>({})
  const [binds, setBinds] = useState<Binding[]>([])
  const [nextId, setNextId] = useState(1)

  // Load entities once a token is available.
  useEffect(() => {
    if (!token) return
    let alive = true
    setLoading(true); setError(null)
    getEntities(token)
      .then((data: unknown) => {
        if (!alive) return
        setEntities(Array.isArray(data) ? (data as EntityRef[]) : [])
      })
      .catch((e: Error) => { if (alive) setError(e.message || 'Failed to load entities') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  // Lazy-load fields for a slug, cache them.
  const ensureFields = useCallback(async (slug: string) => {
    if (!token || !slug || fieldsBySrc[slug]) return
    try {
      const def = await getEntityDef(token, slug)
      const fields: FieldRef[] = Array.isArray(def?.fields) ? def.fields : []
      setFieldsBySrc(prev => ({ ...prev, [slug]: fields }))
    } catch {
      setFieldsBySrc(prev => ({ ...prev, [slug]: [] }))
    }
  }, [token, fieldsBySrc])

  const add = () => {
    setBinds(b => [...b, { id: nextId, comp: '', src: '', field: '' }])
    setNextId(n => n + 1)
  }
  const upd = (id: number, patch: Partial<Binding>) =>
    setBinds(b => b.map(x => x.id === id ? { ...x, ...patch } : x))
  const del = (id: number) => setBinds(b => b.filter(x => x.id !== id))

  // If no token yet (e.g. logged-out), keep the empty mock-free shell.
  if (!token) {
    return (
      <div>
        <Sec icon={<Database size={15} />} title="Data Binding" hint="connect components to database / API fields" />
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13 }}>
          Sign in to bind components to real entities.
        </div>
      </div>
    )
  }

  return (
    <div>
      <Sec
        icon={<Database size={15} />}
        title="Data Binding"
        hint="connect components to database / API fields"
      />
      {loading && (
        <div style={{ padding: '20px 0', color: 'var(--gx-text-3)', fontSize: 13 }}>
          Loading entities…
        </div>
      )}
      {error && (
        <div className="banner" style={{ marginBottom: 12, borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{error}</div>
        </div>
      )}
      {!loading && !error && binds.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Component</th><th>Data source</th><th>Field</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {binds.map(b => {
                const fields = fieldsBySrc[b.src] ?? []
                return (
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
                        style={{ width: 160 }}
                        value={b.src}
                        onChange={e => {
                          const src = e.target.value
                          upd(b.id, { src, field: '' })
                          if (src) ensureFields(src)
                        }}
                      >
                        <option value="">— pick entity —</option>
                        {entities.map(e => (
                          <option key={e.route_slug} value={e.route_slug}>
                            {e.label_plural || e.label || e.key}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="inp inp-sm mono"
                        style={{ width: 200 }}
                        value={b.field}
                        disabled={!b.src}
                        onChange={e => upd(b.id, { field: e.target.value })}
                      >
                        <option value="">{b.src ? '— pick field —' : '(pick entity first)'}</option>
                        {fields.map(f => (
                          <option key={f.key} value={f.key}>
                            {f.label || f.key} ({f.type})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm btn-icon" type="button" onClick={() => del(b.id)}>
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && binds.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13 }}>
          {entities.length === 0
            ? 'No entities found. Define an entity first under Data → Models.'
            : <>No bindings yet — click <strong>Bind a component</strong> to connect data.</>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={add}
          disabled={!!error || entities.length === 0}
        >
          <Plus size={13} />Bind a component
        </button>
        {/* TODO: wire to /api/page-bindings (POST/PATCH) — no backend persist layer yet. */}
        <button className="btn btn-ghost btn-sm" type="button" disabled title="Persistence layer pending">
          <Check size={13} />Save bindings
        </button>
      </div>
    </div>
  )
}

// ── 6  ACTIONS & LOGIC ────────────────────────────────────────────────────────
// Wired to the real automation engine: GET /api/events/types feeds the WHEN dropdown so
// every rule subscribes to a generic event the executor actually recognises (create / update
// / transition / delete). GET /api/events/registry adds per-entity status transitions for
// concrete events ("Invoice: DRAFT → SENT"). Action types come from automations.py
// ALLOWED_ACTION_TYPES so the DO picker stays in lockstep with the executor. Save flow is
// still a TODO — full CRUD lives in AutomationsPane; this pane is the rule-builder UI.

interface Rule {
  id: number
  on: string          // event_type or composite transition key (entity.from->to)
  cond: string        // free-text condition for now; rule-builder UI is TODO
  act: string         // action.type — one of notify | set_field | webhook | emit_event
  en: boolean
}

// Matches GET /api/events/types row shape.
type EventTypeRow = { type: string; label: string; description: string }

// Matches GET /api/events/registry row shape.
type EventEntityRow = {
  entity_key: string
  label: string
  transitions: { key: string; event_type: string; from: string | null; to: string; label: string }[]
}
type EventRegistry = { generic: EventTypeRow[]; entities: EventEntityRow[] }

// Mirrors automations.ALLOWED_ACTION_TYPES — friendly labels for the DO picker. Wire is
// read-only (Save rule is still disabled) but at least the verbs match what the executor
// would accept on POST /api/automations.
const ACTION_TYPES: { value: string; label: string }[] = [
  { value: 'notify',      label: 'Send notification' },
  { value: 'set_field',   label: 'Set field value' },
  { value: 'webhook',     label: 'Call webhook' },
  { value: 'emit_event',  label: 'Emit custom event' },
]

export function ActionsLogic({ token }: { token?: string } = {}) {
  const [rules, setRules] = useState<Rule[]>([
    { id: 1, on: '', cond: '', act: '', en: true },
  ])
  const [nextId, setNextId] = useState(2)
  const [eventTypes, setEventTypes] = useState<EventTypeRow[]>([])
  const [registry, setRegistry] = useState<EventRegistry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch the real event catalog on mount. /types is the always-available source of truth;
  // /registry is best-effort and only enriches the WHEN dropdown with entity transitions —
  // a failure there must not block rule editing.
  useEffect(() => {
    if (!token) return
    let alive = true
    setLoading(true); setError(null)
    Promise.all([
      bget<EventTypeRow[]>(token, '/api/events/types'),
      bget<EventRegistry>(token, '/api/events/registry'),
    ])
      .then(([typesRes, regRes]) => {
        if (!alive) return
        if (!typesRes.ok) {
          setError(typesRes.status === 403
            ? 'You do not have permission to view event types.'
            : `Failed to load events (${typesRes.status})`)
          return
        }
        setEventTypes(Array.isArray(typesRes.data) ? typesRes.data : [])
        if (regRes.ok && regRes.data) setRegistry(regRes.data)
      })
      .catch((e: Error) => { if (alive) setError(e.message || 'Failed to load events') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  const toggle = (id: number) => setRules(r => r.map(x => x.id === id ? { ...x, en: !x.en } : x))
  const upd = (id: number, patch: Partial<Rule>) => setRules(r => r.map(x => x.id === id ? { ...x, ...patch } : x))
  const add = () => {
    setRules(r => [...r, { id: nextId, on: '', cond: '', act: '', en: true }])
    setNextId(n => n + 1)
  }
  const del = (id: number) => setRules(r => r.filter(x => x.id !== id))

  if (!token) {
    return (
      <div>
        <Sec icon={<Zap size={15} />} title="Actions & Logic" hint="button actions, submit behavior, navigation, conditions, visibility" />
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13 }}>
          Sign in to define automation rules.
        </div>
      </div>
    )
  }

  return (
    <div>
      <Sec
        icon={<Zap size={15} />}
        title="Actions & Logic"
        hint="button actions, submit behavior, navigation, conditions, visibility"
        right={
          <button className="btn btn-primary btn-sm" type="button" onClick={add} disabled={loading || !!error}>
            <Plus size={13} />New rule
          </button>
        }
      />
      {loading && (
        <div style={{ padding: '20px 0', color: 'var(--gx-text-3)', fontSize: 13 }}>
          Loading event registry…
        </div>
      )}
      {error && (
        <div className="banner" style={{ marginBottom: 12, borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{error}</div>
        </div>
      )}
      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map(r => (
            <div key={r.id} className="rule-card">
              <span className="rule-pill" style={{ background: 'var(--gx-primary-soft)', color: 'var(--gx-info-fg)' }}>
                WHEN
              </span>
              <select
                className="inp inp-sm"
                value={r.on}
                onChange={e => upd(r.id, { on: e.target.value })}
                style={{ flex: 1, minWidth: 160 }}
                title={eventTypes.find(t => t.type === r.on)?.description || ''}
              >
                <option value="">— pick an event —</option>
                {eventTypes.length > 0 && (
                  <optgroup label="Generic events">
                    {eventTypes.map(t => (
                      <option key={t.type} value={t.type}>{t.label}</option>
                    ))}
                  </optgroup>
                )}
                {registry?.entities.some(e => e.transitions.length > 0) && (
                  <optgroup label="Status transitions">
                    {registry.entities.flatMap(ent =>
                      ent.transitions.map(t => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      )),
                    )}
                  </optgroup>
                )}
              </select>
              <span className="rule-pill" style={{ background: 'var(--gx-warning-soft)', color: 'var(--gx-warning-fg)' }}>IF</span>
              {/* TODO: rule-builder UI — replace this free-text condition with an entity-field
                  picker once /api/events/registry is extended with field metadata. */}
              <input
                className="inp inp-sm mono"
                placeholder="Condition (e.g. status == 'PAID')…"
                value={r.cond}
                onChange={e => upd(r.id, { cond: e.target.value })}
                style={{ flex: 1, minWidth: 120 }}
              />
              <ArrowRight size={14} style={{ color: 'var(--gx-text-3)', flexShrink: 0 }} />
              <span className="rule-pill" style={{ background: 'var(--gx-success-soft)', color: 'var(--gx-success-fg)' }}>DO</span>
              <select
                className="inp inp-sm"
                value={r.act}
                onChange={e => upd(r.id, { act: e.target.value })}
                style={{ flex: 1, minWidth: 140 }}
              >
                <option value="">— pick an action —</option>
                {ACTION_TYPES.map(a => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
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
      )}
      {/* TODO: persist rules to /api/automations (POST). AutomationsPane already owns the
          full CRUD; this pane is the visual rule-builder shell. Save stays disabled until
          we wire action.config editors per action.type. */}
      {!loading && !error && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn btn-secondary btn-sm" type="button" disabled title="Persistence wires through /api/automations (TODO)">
            <Check size={13} />Save rule
          </button>
        </div>
      )}
    </div>
  )
}

// ── 7  PERMISSIONS ────────────────────────────────────────────────────────────
// Wired to the RBAC kernel: GET /api/roles, GET /api/permissions, PATCH /api/roles/{id}.
// Rows = "scopes" derived from permission registry (entity prefix from `entity.action`
// keys, falling back to the permission's `group` field). Cells show None/View/Edit
// based on whether the role's permission list contains any read-type or write-type
// permission for that scope. Cell click cycles + PATCHes the full new permission list
// optimistically; failures revert + raise a toast.

type PermLevel = 'none' | 'view' | 'edit'
type PermDef   = { key: string; label: string; group: string }
type RoleRow   = { id: string; key: string; label: string; permissions: string[] }

const READ_VERBS  = new Set(['view', 'read', 'list', 'get'])
const WRITE_VERBS = new Set(['edit', 'create', 'update', 'delete', 'manage', 'write', 'admin', 'configure'])

// A "scope" is one row of the matrix — derived from the permission registry.
type Scope = {
  key:  string         // canonical scope key (e.g. "customer" or group name)
  label: string        // human label
  read:  string[]      // permission keys classified as read for this scope
  write: string[]      // permission keys classified as write for this scope
  all:   string[]      // union — used when clearing a cell back to None
}

function humanize(s: string): string {
  if (!s) return s
  return s.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function buildScopes(perms: PermDef[]): Scope[] {
  const byKey = new Map<string, Scope>()
  for (const p of perms) {
    // Prefer `entity.action` shape — split on the first dot.
    const dot = p.key.indexOf('.')
    let scopeKey: string
    let action: string
    if (dot > 0) {
      scopeKey = p.key.slice(0, dot)
      action = p.key.slice(dot + 1).toLowerCase()
    } else {
      scopeKey = p.group || p.key
      action = p.key.toLowerCase()
    }
    let s = byKey.get(scopeKey)
    if (!s) {
      s = { key: scopeKey, label: humanize(scopeKey), read: [], write: [], all: [] }
      byKey.set(scopeKey, s)
    }
    s.all.push(p.key)
    if (WRITE_VERBS.has(action)) s.write.push(p.key)
    else if (READ_VERBS.has(action)) s.read.push(p.key)
    else s.read.push(p.key)   // unknown action ⇒ treat as read-tier
  }
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label))
}

function cellLevel(role: RoleRow, scope: Scope): PermLevel {
  const set = new Set(role.permissions)
  const hasWrite = scope.write.some(k => set.has(k))
  if (hasWrite) return 'edit'
  const hasRead = scope.read.some(k => set.has(k))
  if (hasRead) return 'view'
  return 'none'
}

function nextPerms(role: RoleRow, scope: Scope, level: PermLevel): string[] {
  // Strip every permission belonging to this scope, then re-add per target level.
  const stripped = role.permissions.filter(k => !scope.all.includes(k))
  if (level === 'none') return stripped
  if (level === 'view') return [...stripped, ...scope.read]
  return [...stripped, ...scope.read, ...scope.write]   // 'edit'
}

const LEVEL_CYCLE: Record<PermLevel, PermLevel> = { none: 'view', view: 'edit', edit: 'none' }

export function Permissions({ token }: { token?: string } = {}) {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [perms, setPerms] = useState<PermDef[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Initial load.
  useEffect(() => {
    if (!token) return
    let alive = true
    setLoading(true); setError(null)
    Promise.all([
      bget<RoleRow[]>(token, '/api/roles'),
      bget<PermDef[]>(token, '/api/permissions'),
    ])
      .then(([rRes, pRes]) => {
        if (!alive) return
        if (!rRes.ok || !pRes.ok) {
          setError(rRes.status === 403 || pRes.status === 403
            ? 'You do not have permission to view roles.'
            : `Failed to load (roles ${rRes.status}, permissions ${pRes.status})`)
          return
        }
        setRoles(Array.isArray(rRes.data) ? rRes.data : [])
        setPerms(Array.isArray(pRes.data) ? pRes.data : [])
      })
      .catch((e: Error) => { if (alive) setError(e.message || 'Failed to load') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  // Cell click: cycle level + optimistic PATCH; revert on failure.
  const cycle = async (role: RoleRow, scope: Scope) => {
    if (!token) return
    const current = cellLevel(role, scope)
    const target  = LEVEL_CYCLE[current]
    const next    = nextPerms(role, scope, target)
    const prev    = role.permissions
    // optimistic
    setRoles(rs => rs.map(r => r.id === role.id ? { ...r, permissions: next } : r))
    try {
      await bpatch(token, `/api/roles/${role.id}`, { permissions: next })
    } catch (e) {
      // revert
      setRoles(rs => rs.map(r => r.id === role.id ? { ...r, permissions: prev } : r))
      const msg = (e as Error).message || 'Save failed'
      setToast(msg)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const dot = (v: PermLevel): [string, string] =>
    v === 'edit'
      ? ['Edit', 'var(--gx-success)']
      : v === 'view'
      ? ['View', 'var(--gx-warning)']
      : ['—', 'var(--gx-text-3)']

  if (!token) {
    return (
      <div>
        <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13 }}>
          Sign in to manage role permissions.
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div>
        <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ height: 22, background: 'var(--gx-surface-2)', borderRadius: 4, opacity: 0.6 }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
        <div className="banner" style={{ borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{error}</div>
        </div>
      </div>
    )
  }

  const scopes = buildScopes(perms)

  if (roles.length === 0 || scopes.length === 0) {
    return (
      <div>
        <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13 }}>
          {roles.length === 0
            ? 'No roles defined yet. Create roles under Security → Roles.'
            : 'No permissions registered yet — they are created automatically when entities are added.'}
        </div>
      </div>
    )
  }

  return (
    <div>
      <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
      {toast && (
        <div className="banner" style={{ marginBottom: 12, borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{toast}</div>
        </div>
      )}
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Scope</th>
              {roles.map(r => <th key={r.id} style={{ textAlign: 'center' }}>{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {scopes.map(sc => (
              <tr key={sc.key} style={{ cursor: 'default' }}>
                <td style={{ fontWeight: 600 }}>{sc.label}</td>
                {roles.map(role => {
                  const level = cellLevel(role, sc)
                  const [label, color] = dot(level)
                  return (
                    <td key={role.id} style={{ textAlign: 'center' }}>
                      <button
                        className="perm-cell"
                        type="button"
                        onClick={() => cycle(role, sc)}
                        style={{ color }}
                        title="Click to cycle None → View → Edit"
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
        Click a cell to cycle None → View → Edit. Saved per-click; enforced server-side by the auth kernel.
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

// ── 9  AUDIT LOG (Governance) ─────────────────────────────────────────────────
// Wired to GET /api/audit-log (admin-scoped, gated on audit.view permission).
// Surfaces the real Event trail of who/what/when for every config + record change.
// The component name stays VersionHistory because RICH_PANE_MAP still routes
// "Versioning" / "Workflow Versions" / "Page Versioning" through it — visually
// it is the Governance audit trail.

type AuditEvent = {
  id: string
  type: string
  entity_key: string | null
  record_id: string | null
  actor_user_id: string | null
  actor_name: string | null
  data: any
  created_at: string | null
}

type AuditResp = { items: AuditEvent[]; total: number }

// Fallback event-type catalog used if /api/events/types is unavailable or returns 403.
const FALLBACK_EVENT_TYPES: { type: string; label: string }[] = [
  { type: 'create',     label: 'Create' },
  { type: 'update',     label: 'Update' },
  { type: 'transition', label: 'Transition' },
  { type: 'delete',     label: 'Delete' },
]

// Map an event type → StatusPill variant for consistent colour coding.
function eventVariant(type: string): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  if (type === 'delete' || type === 'action_failed' || type === 'approval_rejected') return 'critical'
  if (type === 'create' || type === 'approval_approved') return 'active'
  if (type === 'transition' || type === 'approval_requested') return 'degraded'
  if (type === 'update') return 'info'
  return 'neutral'
}

function actorLabel(ev: AuditEvent): string {
  if (ev.actor_name) return ev.actor_name
  if (ev.actor_user_id) return ev.actor_user_id.slice(0, 8)
  return 'system'
}

// Render an event's `data` payload as a compact key:value list. Nested objects
// are JSON-stringified so the row stays scannable.
function DataDetail({ data }: { data: any }) {
  if (data === null || data === undefined) {
    return <div className="hint" style={{ fontSize: 12 }}>No payload</div>
  }
  if (typeof data !== 'object') {
    return <div className="mono" style={{ fontSize: 12 }}>{String(data)}</div>
  }
  const entries = Object.entries(data)
  if (entries.length === 0) {
    return <div className="hint" style={{ fontSize: 12 }}>Empty payload</div>
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12 }}>
      {entries.flatMap(([k, v]) => [
        <span key={`${k}-k`} className="mono" style={{ color: 'var(--gx-text-3)' }}>{k}</span>,
        <span key={`${k}-v`} className="mono" style={{ color: 'var(--gx-text-1)', wordBreak: 'break-word' }}>
          {v === null || v === undefined
            ? 'null'
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v)}
        </span>,
      ])}
    </div>
  )
}

const PAGE_SIZE = 50

export function VersionHistory({ token }: { token?: string } = {}) {
  const [items, setItems] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Filter inputs — applied via a small "Apply" button so we don't refetch on every keystroke.
  const [filterEventType, setFilterEventType] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterSince, setFilterSince] = useState('')
  // The applied (latched) filter values that actually drive the query.
  const [appliedType, setAppliedType] = useState('')
  const [appliedEntity, setAppliedEntity] = useState('')
  const [appliedSince, setAppliedSince] = useState('')

  // Event-type catalog for the filter dropdown (best-effort; falls back if 403/404).
  const [eventTypes, setEventTypes] = useState<{ type: string; label: string }[]>(FALLBACK_EVENT_TYPES)

  useEffect(() => {
    if (!token) return
    let alive = true
    bget<{ type: string; label: string }[]>(token, '/api/events/types').then(res => {
      if (!alive) return
      if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
        setEventTypes(res.data.map(t => ({ type: t.type, label: t.label })))
      }
    })
    return () => { alive = false }
  }, [token])

  // Build the audit-log query string from the latched filter state.
  const buildQuery = useCallback((offset: number): string => {
    const p = new URLSearchParams()
    p.set('limit', String(PAGE_SIZE))
    p.set('offset', String(offset))
    if (appliedType)   p.set('event_type', appliedType)
    if (appliedEntity) p.set('entity', appliedEntity)
    if (appliedSince) {
      // <input type="date"> gives YYYY-MM-DD; backend expects ISO + Z.
      p.set('since', `${appliedSince}T00:00:00Z`)
    }
    return p.toString()
  }, [appliedType, appliedEntity, appliedSince])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError(null); setDenied(false); setExpanded(new Set())
    const res = await bget<AuditResp>(token, `/api/audit-log?${buildQuery(0)}`)
    if (res.status === 403) {
      setDenied(true)
      setItems([]); setTotal(0)
      setLoading(false)
      return
    }
    if (!res.ok || !res.data) {
      setError(`Failed to load audit log (${res.status})`)
      setItems([]); setTotal(0)
      setLoading(false)
      return
    }
    setItems(Array.isArray(res.data.items) ? res.data.items : [])
    setTotal(typeof res.data.total === 'number' ? res.data.total : 0)
    setLoading(false)
  }, [token, buildQuery])

  useEffect(() => { load() }, [load])

  const loadMore = async () => {
    if (!token) return
    setLoadingMore(true)
    const res = await bget<AuditResp>(token, `/api/audit-log?${buildQuery(items.length)}`)
    if (res.ok && res.data && Array.isArray(res.data.items)) {
      setItems(prev => [...prev, ...res.data!.items])
      if (typeof res.data.total === 'number') setTotal(res.data.total)
    }
    setLoadingMore(false)
  }

  const applyFilters = () => {
    setAppliedType(filterEventType)
    setAppliedEntity(filterEntity.trim())
    setAppliedSince(filterSince)
  }

  const clearFilters = () => {
    setFilterEventType(''); setFilterEntity(''); setFilterSince('')
    setAppliedType('');    setAppliedEntity('');   setAppliedSince('')
  }

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ── header (always rendered) ────────────────────────────────────────────────
  const filtersActive = appliedType || appliedEntity || appliedSince
  const header = (
    <Sec
      icon={<GitCommitHorizontal size={15} />}
      title="Audit Log"
      hint="who changed what, and when"
      right={
        <span className="hint" style={{ fontSize: 11.5 }}>
          {loading ? '' : `${items.length} of ${total}`}
        </span>
      }
    />
  )

  const filterBar = (
    <div
      className="card"
      style={{ padding: 10, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
    >
      <label className="field" style={{ flex: '1 1 160px', minWidth: 140, margin: 0 }}>
        <span style={{ fontSize: 11 }}>Event type</span>
        <select
          className="inp inp-sm"
          value={filterEventType}
          onChange={e => setFilterEventType(e.target.value)}
        >
          <option value="">All types</option>
          {eventTypes.map(t => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </select>
      </label>
      <label className="field" style={{ flex: '1 1 160px', minWidth: 140, margin: 0 }}>
        <span style={{ fontSize: 11 }}>Entity</span>
        <input
          className="inp inp-sm mono"
          placeholder="e.g. customer"
          value={filterEntity}
          onChange={e => setFilterEntity(e.target.value)}
        />
      </label>
      <label className="field" style={{ flex: '1 1 140px', minWidth: 120, margin: 0 }}>
        <span style={{ fontSize: 11 }}>Since</span>
        <input
          className="inp inp-sm"
          type="date"
          value={filterSince}
          onChange={e => setFilterSince(e.target.value)}
        />
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-primary btn-sm" type="button" onClick={applyFilters} disabled={loading}>
          Apply
        </button>
        {filtersActive ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={clearFilters} disabled={loading}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  )

  // ── state branches ──────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div>
        {header}
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13 }}>
          Sign in to view the audit log.
        </div>
      </div>
    )
  }

  if (denied) {
    return (
      <div>
        {header}
        <PermissionDenied message="You do not have audit.view — required to read the governance audit trail." />
      </div>
    )
  }

  if (loading && items.length === 0) {
    return (
      <div>
        {header}
        {filterBar}
        <SkeletonRows rows={6} />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {header}
        {filterBar}
        <ErrorBanner message={error} onRetry={load} />
      </div>
    )
  }

  return (
    <div>
      {header}
      {filterBar}
      {items.length === 0 ? (
        <EmptyState
          title="No audit events"
          message={
            filtersActive
              ? 'No audit events match these filters.'
              : 'Audit events will appear here as users create, update, or transition records.'
          }
        />
      ) : (
        <>
          <div className="timeline" style={{ minHeight: 160 }}>
            {items.map(ev => {
              const isOpen = expanded.has(ev.id)
              const entitySuffix = ev.entity_key
                ? ev.record_id
                  ? `${ev.entity_key} · ${ev.record_id.slice(0, 8)}`
                  : ev.entity_key
                : null
              return (
                <div key={ev.id} className="tl-item" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '10px 0' }}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(ev.id)}
                    aria-expanded={isOpen}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'inherit',
                    }}
                  >
                    <StatusPillLite variant={eventVariant(ev.type)} label={ev.type} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gx-text-1)' }}>
                      {actorLabel(ev)}
                    </span>
                    {entitySuffix && (
                      <span className="mono" style={{ fontSize: 12, color: 'var(--gx-text-3)' }}>
                        {entitySuffix}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span className="hint" style={{ fontSize: 11.5 }}>{timeAgo(ev.created_at)}</span>
                    {isOpen
                      ? <ChevronUp size={14} style={{ color: 'var(--gx-text-3)' }} />
                      : <ChevronDown size={14} style={{ color: 'var(--gx-text-3)' }} />}
                  </button>
                  {isOpen && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 10,
                        background: 'var(--gx-surface-2)',
                        border: '1px solid var(--gx-border-subtle)',
                        borderRadius: 'var(--gx-radius-md)',
                      }}
                    >
                      <DataDetail data={ev.data} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {items.length < total && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : `Load more (${total - items.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Small inline pill used by the audit timeline so we don't have to pull StatusPill
// into StudioRichPanes (keeps the import surface flat). Uses kit pill classes.
function StatusPillLite({ variant, label }: {
  variant: 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
  label: string
}) {
  const kit =
    variant === 'active'   ? 'pill-success' :
    variant === 'degraded' ? 'pill-warning' :
    variant === 'critical' ? 'pill-danger'  :
    variant === 'info'     ? 'pill-info'    : 'pill-neutral'
  return (
    <span className={`pill ${kit} pill-sm`} style={{ textTransform: 'lowercase' }}>
      <span className="d" style={{ background: 'currentColor' }} />
      {label}
    </span>
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

// Bound to GET/PUT /api/tenant/settings/theme. Names match the backend allow-list:
// accent ∈ {Azure, Cobalt, Gold, Emerald, Violet, Teal}.
const ACCENTS: Accent[] = [
  { name: 'Azure',   val: '#3B7BE0', hover: '#5293F2', active: '#2C63BC', soft: 'rgba(59,123,224,.16)' },
  { name: 'Cobalt',  val: '#2A5187', hover: '#3A6299', active: '#1C3B68', soft: 'rgba(42,81,135,.20)' },
  { name: 'Gold',    val: '#C5A059', hover: '#D2B06E', active: '#AC8847', soft: 'rgba(197,160,89,.18)' },
  { name: 'Emerald', val: '#1F9D57', hover: '#34C77B', active: '#16804A', soft: 'rgba(31,157,87,.16)' },
  { name: 'Violet',  val: '#8B6FD6', hover: '#A78BE6', active: '#6F52BD', soft: 'rgba(139,111,214,.18)' },
  { name: 'Teal',    val: '#2A9DB5', hover: '#41B4CC', active: '#1F8398', soft: 'rgba(42,157,181,.18)' },
]

// radius ∈ {Sharp, Soft, Rounded, Pill}; value drives preview shapes + maps to --gx-radius-* cluster.
const RADII: [string, number][] = [['Sharp', 4], ['Soft', 8], ['Rounded', 13], ['Pill', 999]]

// density ∈ {Compact, Comfortable, Spacious}; maps to --gx-space-* cluster.
const DENSITY_NAMES = ['Compact', 'Comfortable', 'Spacious'] as const
type DensityName = (typeof DENSITY_NAMES)[number]

// mode ∈ {Dark, Light, Auto}; sets <html data-theme="…">.
const MODE_NAMES = ['Dark', 'Light', 'Auto'] as const
type ModeName = (typeof MODE_NAMES)[number]

interface Accent { name: string; val: string; hover: string; active: string; soft: string }

// Named-token → CSS-variable bundles. Applying these to documentElement live-previews the
// theme across the whole app (every screen uses --gx-* tokens).
const RADIUS_VARS: Record<number, Record<string, string>> = {
  4:   { '--gx-radius-sm': '2px', '--gx-radius-md': '4px',  '--gx-radius-lg': '6px',  '--gx-radius-xl': '8px'  },
  8:   { '--gx-radius-sm': '5px', '--gx-radius-md': '8px',  '--gx-radius-lg': '12px', '--gx-radius-xl': '16px' },
  13:  { '--gx-radius-sm': '8px', '--gx-radius-md': '13px', '--gx-radius-lg': '18px', '--gx-radius-xl': '24px' },
  999: { '--gx-radius-sm': '999px', '--gx-radius-md': '999px', '--gx-radius-lg': '999px', '--gx-radius-xl': '999px' },
}

const DENSITY_VARS: Record<DensityName, Record<string, string>> = {
  Compact:     { '--gx-space-4': '6px',  '--gx-space-5': '8px',  '--gx-space-6': '10px', '--gx-space-7': '12px', '--gx-space-8': '14px', '--gx-input-height-md': '26px', '--gx-btn-height-md': '26px' },
  Comfortable: { '--gx-space-4': '8px',  '--gx-space-5': '10px', '--gx-space-6': '12px', '--gx-space-7': '14px', '--gx-space-8': '16px', '--gx-input-height-md': '28px', '--gx-btn-height-md': '28px' },
  Spacious:    { '--gx-space-4': '12px', '--gx-space-5': '14px', '--gx-space-6': '18px', '--gx-space-7': '22px', '--gx-space-8': '28px', '--gx-input-height-md': '34px', '--gx-btn-height-md': '34px' },
}

const accentVars = (a: Accent): Record<string, string> => ({
  '--gx-primary': a.val,
  '--gx-primary-hover': a.hover,
  '--gx-primary-active': a.active,
  '--gx-primary-soft': a.soft,
})

// Resolve Auto → user system preference; otherwise lowercase the name.
const themeAttr = (mode: ModeName): 'dark' | 'light' => {
  if (mode === 'Auto') {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark'
  }
  return mode.toLowerCase() as 'dark' | 'light'
}

// Apply a full theme (accent+radius+density+mode) to <html>. Returns the keys it touched so the
// unmount path can restore them.
function applyTheme(accent: Accent, radius: number, density: DensityName, mode: ModeName): string[] {
  const root = document.documentElement
  const bundle: Record<string, string> = {
    ...accentVars(accent),
    ...(RADIUS_VARS[radius] ?? RADIUS_VARS[8]),
    ...DENSITY_VARS[density],
  }
  for (const [k, v] of Object.entries(bundle)) root.style.setProperty(k, v)
  root.setAttribute('data-theme', themeAttr(mode))
  return Object.keys(bundle)
}

// Server payload (all keys nullable until first save).
type ThemeDoc = {
  accent: string | null
  radius: string | null
  density: string | null
  mode: string | null
}
type ThemeWorking = { accent: Accent; radius: number; density: DensityName; mode: ModeName }

const radiusByName = (name: string | null): number =>
  RADII.find(([n]) => n === name)?.[1] ?? RADII[0][1]
const radiusNameByVal = (v: number): string =>
  RADII.find(([, r]) => r === v)?.[0] ?? RADII[0][0]

const seedFromDoc = (doc: ThemeDoc | null): ThemeWorking => ({
  accent:  ACCENTS.find(a => a.name === doc?.accent) ?? ACCENTS[0],
  radius:  doc?.radius ? radiusByName(doc.radius) : RADII[0][1],
  density: (DENSITY_NAMES.find(d => d === doc?.density) ?? DENSITY_NAMES[0]) as DensityName,
  mode:    (MODE_NAMES.find(m => m === doc?.mode) ?? MODE_NAMES[0]) as ModeName,
})

const isDirty = (a: ThemeWorking, b: ThemeWorking) =>
  a.accent.name !== b.accent.name || a.radius !== b.radius || a.density !== b.density || a.mode !== b.mode

export function AppearancePane({ token }: { token?: string } = {}) {
  // Saved baseline (last server-confirmed state) + working state (what the user is editing).
  const [baseline, setBaseline] = useState<ThemeWorking>(() => seedFromDoc(null))
  const [accent, setAccent] = useState<Accent>(baseline.accent)
  const [radius, setRadius] = useState<number>(baseline.radius)
  const [density, setDensity] = useState<DensityName>(baseline.density)
  const [mode, setMode] = useState<ModeName>(baseline.mode)

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // We track the original <html> theme attribute so unmount can restore it cleanly.
  const initialHtmlTheme = useRef<string | null>(null)
  // Latest baseline kept in a ref so the unmount cleanup sees the freshest one.
  const baselineRef = useRef(baseline)
  useEffect(() => { baselineRef.current = baseline }, [baseline])

  // Mount: seed from /api/tenant/settings/theme.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      initialHtmlTheme.current = document.documentElement.getAttribute('data-theme')
    }
    if (!token) { setLoaded(true); return }
    let alive = true
    bget<ThemeDoc>(token, '/api/tenant/settings/theme')
      .then(res => {
        if (!alive) return
        const seeded = res.ok && res.data ? seedFromDoc(res.data) : seedFromDoc(null)
        setBaseline(seeded)
        setAccent(seeded.accent); setRadius(seeded.radius); setDensity(seeded.density); setMode(seeded.mode)
        if (!res.ok && res.status !== 404) {
          setError(res.status === 403
            ? 'Requires tenant.settings permission to load theme.'
            : `Failed to load theme (${res.status})`)
        }
      })
      .catch((e: Error) => { if (alive) setError(e.message || 'Failed to load theme') })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [token])

  // Live-preview side effect: any change to working state pushes new CSS vars to :root + sets
  // data-theme on <html>, so the WHOLE APP previews the new theme immediately.
  useEffect(() => {
    if (!loaded) return
    applyTheme(accent, radius, density, mode)
  }, [accent, radius, density, mode, loaded])

  // Unmount: if dirty, revert the live CSS vars back to the saved baseline so an accidental
  // nav-away doesn't strand the user with an unsaved theme. If the user saved, baseline ≡ working
  // and this is a no-op (correct).
  useEffect(() => {
    return () => {
      const b = baselineRef.current
      applyTheme(b.accent, b.radius, b.density, b.mode)
      if (initialHtmlTheme.current === null) document.documentElement.removeAttribute('data-theme')
    }
  }, [])

  const working: ThemeWorking = { accent, radius, density, mode }
  const dirty = isDirty(working, baseline)

  // Save flow — PUT the full 4-key payload. 422 (allow-list miss) → inline error w/ backend
  // detail; 403 → "Requires tenant.settings permission" toast; success → adopt as new baseline.
  const save = async () => {
    if (!token || !dirty || saving) return
    setSaving(true); setError(null)
    try {
      await bput(token, '/api/tenant/settings/theme', {
        accent: accent.name,
        radius: radiusNameByVal(radius),
        density,
        mode,
      })
      setBaseline(working)
      setToast('Appearance saved.')
      setTimeout(() => setToast(null), 3000)
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 403) {
        setToast('Requires tenant.settings permission')
        setTimeout(() => setToast(null), 4000)
      } else if (err.status === 422) {
        setError(err.message || 'Invalid theme value')
      } else {
        setError(err.message || 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setAccent(baseline.accent); setRadius(baseline.radius); setDensity(baseline.density); setMode(baseline.mode)
    setError(null)
  }

  const pad = density === 'Compact' ? '0 12px' : density === 'Spacious' ? '0 22px' : '0 16px'
  const ht = density === 'Compact' ? 28 : density === 'Spacious' ? 42 : 34

  const live: React.CSSProperties & Record<string, string> = accentVars(accent)

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--gx-font-sans)', fontSize: 16, fontWeight: 600 }}>Appearance</h3>
        <p className="hint" style={{ margin: 0 }}>
          Tenant branding. Set it once here — every rendered screen across all 18 modules updates. No code.
        </p>
      </div>

      {error && (
        <div className="banner" style={{ marginBottom: 14, borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{error}</div>
        </div>
      )}

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
              {DENSITY_NAMES.map(d => (
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
              {MODE_NAMES.map(t => (
                <button key={t} className={mode === t ? 'on' : ''} type="button" onClick={() => setMode(t)} style={{ flex: 1 }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* live preview */}
        <div
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

      <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
        <button
          className="btn btn-primary btn-md"
          type="button"
          style={{ background: accent.val }}
          onClick={save}
          disabled={!token || !dirty || saving}
        >
          <Check size={14} />{saving ? 'Saving…' : 'Save appearance'}
        </button>
        <button
          className="btn btn-ghost btn-md"
          type="button"
          onClick={reset}
          disabled={!dirty || saving}
        >
          Reset
        </button>
        {dirty && (
          <span className="hint" style={{ fontSize: 12, color: 'var(--gx-warning)' }}>Unsaved changes</span>
        )}
        {toast && (
          <span className="hint" style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>{toast}</span>
        )}
      </div>
    </div>
  )
}

// ── re-export for convenience ─────────────────────────────────────────────────

// Pane components may optionally accept a `token` — Permissions + DataBinding use it for
// backend wiring; the rest ignore the prop. StudioGenericPane passes the bearer for both.
export const RICH_PANE_MAP: Record<string, React.ComponentType<{ token?: string }>> = {
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

export function richPaneFor(leafLabel: string): React.ComponentType<{ token?: string }> | null {
  return RICH_PANE_MAP[leafLabel] ?? null
}
