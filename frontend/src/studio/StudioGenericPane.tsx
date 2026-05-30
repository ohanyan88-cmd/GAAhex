// GAAex Studio — P4 archetype panes.
// Five archetype components cover every leaf not handled by a rich builder:
//   ArchTable   → registries, marketplaces, catalogs, list-type leaves
//   ArchTokens  → design tokens: radius, spacing, shadows, typography, colour
//   ArchMonitor → KPI strip + live log stream for observability leaves
//   ArchCanvas  → visual flow canvas for workflow / rules / builder leaves
//   ArchForm    → 2-col settings form for plain-config leaves
//
// archetypeFor() mirrors the JS keyword routing in studio-tree.jsx line 83-91.
// All archetype components are self-contained (useState/useEffect only; no backend
// fetches). Seed data is derived from leaf.leafLabel so each of the 276 leaves
// looks distinct.

import { useState, useEffect, useRef, type ComponentType } from 'react'
import {
  Check,
  Plus,
  Terminal,
  TriangleAlert,
  X,
} from 'lucide-react'
import { type FlatLeaf } from './tree'
import { iconFor } from './iconMap'
import {
  PageManager,
  LayoutBuilder,
  ComponentsLibrary,
  ContentEditor,
  DataBinding,
  ActionsLogic,
  Permissions,
  PreviewMode,
  VersionHistory,
  Templates,
  PublishSettings,
  EntityBuilder,
  AppearancePane,
} from './StudioRichPanes'

// ── rich-pane router ─────────────────────────────────────────────────────────
// Maps leaf labels to dedicated builder components (ports of kit studio-tree.jsx richPaneFor).
// Returns the component or null — caller renders it; null falls through to archetypeFor().

const RICH_PANE_MAP: Record<string, ComponentType> = {
  'Page Registry': PageManager,
  'Page Builder': LayoutBuilder,
  'Dynamic Pages': PageManager,
  'Page Versioning': VersionHistory,
  'Component Registry': ComponentsLibrary,
  'Component Builder': ComponentsLibrary,
  'Component Marketplace': ComponentsLibrary,
  'Grid System': LayoutBuilder,
  'Layout Templates': LayoutBuilder,
  'Layout Library': Templates,
  'Custom Templates': Templates,
  'Brand Identity': AppearancePane,
  'Colors': AppearancePane,
  'Design Tokens': AppearancePane,
  'Theme Inheritance': AppearancePane,
  'Entities': EntityBuilder,
  'Fields': EntityBuilder,
  'External APIs': DataBinding,
  'REST': DataBinding,
  'GraphQL': DataBinding,
  'Triggers': ActionsLogic,
  'Conditions': ActionsLogic,
  'Actions': ActionsLogic,
  'Business Rules': ActionsLogic,
  'Permissions': Permissions,
  'Component Permissions': Permissions,
  'Access Mapping': Permissions,
  'Preview': PreviewMode,
  'Versioning': VersionHistory,
  'Workflow Versions': VersionHistory,
  'Deployment': PublishSettings,
  'SEO': ContentEditor,
  'Meta Tags': ContentEditor,
}

function richPaneFor(leafLabel: string): ComponentType | null {
  return RICH_PANE_MAP[leafLabel] ?? null
}

// ── archetype router ─────────────────────────────────────────────────────────

type Archetype = 'tokens' | 'monitor' | 'canvas' | 'table' | 'form'

function archetypeFor(leafLabel: string): Archetype {
  const s = leafLabel.toLowerCase()
  if (/typography|shadow|radius|spacing|icons|animation|logos/.test(s)) return 'tokens'
  if (/logs|monitoring|metrics|traces|errors|health|performance|alerts|incidents|usage|tracking|analytics|sla|history|audit|replay/.test(s)) return 'monitor'
  if (/designer|process maps|decision trees|formula|state machines|grid|builder|maps/.test(s)) return 'canvas'
  if (/registry|categories|library|marketplace|sources|providers|connectors|channels|environments|plans|documents|warehouses|pipelines|consumers|producers|certificates|agents|prompts|knowledge|tool registry|reports|dashboards|kpis|funnels|cohorts|templates|variants|slots|properties|events|jobs|queues|schedules|services|infrastructure|integrations|systems|plugins|extensions|connector|store|webhooks|indexes|push|in-app|guides|docs|sdk|cli/.test(s)) return 'table'
  if (/changelog/.test(s)) return 'monitor'
  return 'form'
}

// Colour strip used to tint row accents so rows don't all look identical.
const TONE = [
  'var(--azure-400)',
  'var(--gx-gold)',
  'var(--gx-success)',
  'var(--violet-400)',
  'var(--gx-warning)',
  '#2A9DB5',
]

// ── ArchTable ────────────────────────────────────────────────────────────────

type RowStatus = 'Active' | 'Draft' | 'Disabled'

interface TableRow {
  __id: string
  name: string
  type: string
  status: RowStatus
  updated: string
}

function ArchTable({ leaf }: { leaf: FlatLeaf }) {
  const single = leaf.leafLabel.replace(/s$/, '')
  function buildSeed(): TableRow[] {
    return Array.from({ length: 6 }, (_, i) => ({
      __id: 'a' + i,
      name: single + ' ' + (i + 1),
      type: (['Default', 'Custom', 'System', 'Shared'] as const)[i % 4],
      status: (['Active', 'Active', 'Draft', 'Active', 'Disabled', 'Active'] as RowStatus[])[i],
      updated: ['2h ago', '1d ago', '3d ago', '1w ago', '2w ago', '1mo ago'][i],
    }))
  }

  const [rows, setRows] = useState<TableRow[]>(buildSeed)
  useEffect(() => { setRows(buildSeed()) }, [leaf.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const nRef = useRef(7)

  const add = () => {
    const n = nRef.current++
    setRows(r => [{ __id: 'n' + n, name: single + ' ' + n, type: 'Custom', status: 'Draft', updated: 'now' }, ...r])
  }
  const del = (id: string) => setRows(r => r.filter(x => x.__id !== id))
  const dup = (row: TableRow) => {
    const n = nRef.current++
    setRows(r => [{ ...row, __id: 'n' + n, name: row.name + ' copy', status: 'Draft', updated: 'now' }, ...r])
  }
  const cycle = (id: string) =>
    setRows(r => r.map(x =>
      x.__id === id
        ? { ...x, status: x.status === 'Active' ? 'Draft' : x.status === 'Draft' ? 'Disabled' : 'Active' }
        : x,
    ))

  const statusCls = (s: RowStatus) =>
    s === 'Active' ? 'pill pill-success' : s === 'Draft' ? 'pill pill-neutral' : 'pill pill-danger'

  return (
    <div>
      <div style={{ display: 'flex', marginBottom: 10 }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" type="button" onClick={add}>
          <Plus size={13} />New {single.toLowerCase()}
        </button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Updated</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.__id}>
                <td style={{ fontWeight: 600 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: TONE[i % TONE.length], flexShrink: 0 }} />
                    {r.name}
                  </span>
                </td>
                <td style={{ color: 'var(--gx-text-2)' }}>{r.type}</td>
                <td>
                  <button
                    className={statusCls(r.status)}
                    style={{ border: 'none', cursor: 'pointer' }}
                    type="button"
                    title="Click to cycle status"
                    onClick={() => cycle(r.__id)}
                  >
                    {r.status}
                  </button>
                </td>
                <td className="hint" style={{ fontSize: 11.5 }}>{r.updated}</td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <button
                      className="btn btn-ghost btn-xs"
                      type="button"
                      title="Duplicate"
                      onClick={() => dup(r)}
                    >Dup</button>
                    <button
                      className="btn btn-ghost btn-xs"
                      type="button"
                      title="Delete"
                      style={{ color: 'var(--gx-danger)' }}
                      onClick={() => del(r.__id)}
                    ><X size={11} /></button>
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '34px', color: 'var(--gx-text-3)' }}>
                  No items yet — click &ldquo;New {single.toLowerCase()}&rdquo;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── ArchTokens ───────────────────────────────────────────────────────────────

function ArchTokens({ leaf }: { leaf: FlatLeaf }) {
  const s = leaf.leafLabel.toLowerCase()

  if (/radius/.test(s))
    return (
      <div className="wrap">
        {([['xs', 5], ['sm', 8], ['md', 12], ['lg', 16], ['xl', 22]] as [string, number][]).map(([label, r]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 60, height: 60, background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border-strong)', borderRadius: r }} />
            <span className="mono muted" style={{ fontSize: 10 }}>{label} · {r}</span>
          </div>
        ))}
      </div>
    )

  if (/spacing/.test(s))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[2, 4, 8, 12, 16, 24, 32].map(v => (
          <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="mono muted" style={{ width: 56, fontSize: 11 }}>{v}px</span>
            <div style={{ height: 14, width: v * 3, background: 'var(--gx-primary)', borderRadius: 2 }} />
          </div>
        ))}
      </div>
    )

  if (/shadow/.test(s))
    return (
      <div className="wrap" style={{ gap: 18 }}>
        {(['sm', 'md', 'lg', 'xl'] as const).map(e => (
          <div key={e} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 90, height: 56,
              background: 'var(--gx-surface)',
              borderRadius: 'var(--gx-radius-md)',
              boxShadow: `var(--gx-shadow-${e})`,
            }} />
            <span className="mono muted" style={{ fontSize: 10 }}>{e}</span>
          </div>
        ))}
      </div>
    )

  if (/typography/.test(s))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {([
          ['Display', 30, 'var(--gx-font-display)', 600],
          ['Heading', 20, 'var(--gx-font-sans)', 600],
          ['Body', 14, 'var(--gx-font-sans)', 400],
          ['Mono', 13, 'var(--gx-font-mono)', 400],
        ] as [string, number, string, number][]).map(([label, size, family, weight]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span className="mono muted" style={{ width: 70, fontSize: 11 }}>{label}</span>
            <span style={{ fontFamily: family, fontSize: size, fontWeight: weight }}>The quick brown fox</span>
          </div>
        ))}
      </div>
    )

  // default → color swatches (covers logos, icons, animations, etc.)
  return (
    <div className="wrap">
      {[
        'var(--cobalt-700)', 'var(--azure-500)', 'var(--gx-gold)', 'var(--gx-success)',
        'var(--gx-warning)', 'var(--gx-danger)', 'var(--violet-500)', '#2A9DB5',
      ].map((c, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ width: 70, height: 50, background: c, borderRadius: 'var(--gx-radius-md)', border: '1px solid var(--gx-border)' }} />
        </div>
      ))}
    </div>
  )
}

// ── ArchMonitor ──────────────────────────────────────────────────────────────

const KPI_DATA: [string, string, string][] = [
  ['Status', 'Healthy', 'var(--gx-success)'],
  ['Throughput', '1,284/min', 'var(--gx-text-1)'],
  ['Errors (24h)', '3', 'var(--gx-warning)'],
  ['p95 latency', '142ms', 'var(--gx-text-1)'],
]

const LOG_LINES = [
  'ok   event.processed id=evt_9241',
  'ok   job.completed queue=default 38ms',
  'warn retry attempt=2 svc=billing-adapter',
  'ok   health.check all green',
  'err  timeout upstream=olt-yvn-12 (recovered)',
  'ok   trace span=4821 closed',
]

function logColor(line: string): string {
  if (line.startsWith('err')) return 'var(--gx-danger-fg)'
  if (line.startsWith('warn')) return 'var(--gx-warning-fg)'
  return 'var(--gx-success-fg)'
}

function ArchMonitor(_props: { leaf: FlatLeaf }) {
  return (
    <div>
      <div className="kpi-strip" style={{ marginBottom: 14 }}>
        {KPI_DATA.map(([label, val, color]) => (
          <div className="kpi" key={label}>
            <span className="klbl">{label}</span>
            <div className="kval" style={{ fontSize: 22, color, margin: '6px 0 0' }}>{val}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-head" style={{ padding: '10px 14px' }}>
          <Terminal size={15} style={{ color: 'var(--gx-text-3)' }} />
          <h3 style={{ fontSize: 13 }}>Live stream</h3>
          <span style={{ flex: 1 }} />
          <span className="pill pill-success">
            <span className="d" style={{ background: 'var(--gx-online)' }} />live
          </span>
        </div>
        <div style={{ padding: 12, fontFamily: 'var(--gx-font-mono)', fontSize: 12, lineHeight: 1.9, background: 'var(--gx-code-bg)' }}>
          {LOG_LINES.map((line, i) => (
            <div key={i} style={{ color: logColor(line) }}>
              <span style={{ color: 'var(--gx-text-3)' }}>{String(10 + i).padStart(2, '0')}:4{i} </span>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── ArchCanvas ───────────────────────────────────────────────────────────────

type CanvasNode = [label: string, color: string]

const PALETTE_ITEMS: CanvasNode[] = [
  ['Trigger', 'var(--gx-success)'],
  ['Condition', 'var(--gx-gold)'],
  ['Action', 'var(--violet-400)'],
  ['Branch', 'var(--azure-400)'],
  ['Delay', 'var(--gx-text-2)'],
]

const INITIAL_NODES: CanvasNode[] = [
  ['Start', 'var(--gx-success)'],
  ['Validate', 'var(--azure-400)'],
  ['Decision', 'var(--gx-gold)'],
  ['Action', 'var(--violet-400)'],
  ['End', 'var(--gx-text-3)'],
]

function ArchCanvas({ leaf }: { leaf: FlatLeaf }) {
  const [nodes, setNodes] = useState<CanvasNode[]>(INITIAL_NODES)
  useEffect(() => { setNodes([...INITIAL_NODES]) }, [leaf.id])

  const addNode = (node: CanvasNode) => {
    setNodes(ns => {
      const copy = [...ns]
      copy.splice(Math.max(1, copy.length - 1), 0, node)
      return copy
    })
  }
  const removeNode = (idx: number) => setNodes(ns => ns.filter((_, j) => j !== idx))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 16 }}>
      <div>
        <div className="lbl" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', marginBottom: 8 }}>
          Nodes
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PALETTE_ITEMS.map(node => (
            <button
              key={node[0]}
              className="palette-block"
              type="button"
              style={{ flexDirection: 'row', justifyContent: 'flex-start', gap: 8, padding: '9px 11px' }}
              onClick={() => addNode(node)}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: node[1], flexShrink: 0 }} />
              {node[0]}
            </button>
          ))}
        </div>
      </div>
      <div className="card" style={{ background: 'var(--gx-bg-subtle)', padding: 20, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', justifyContent: 'center' }}>
          {nodes.map((n, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
              <div
                className="flow-node"
                style={{ borderColor: n[1] }}
                onClick={() => removeNode(i)}
                title="Click to remove"
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && removeNode(i)}
              >
                {n[0]}
                <X size={11} className="flow-x" />
              </div>
              {i < nodes.length - 1 && (
                <div style={{ width: 24, height: 2, background: 'var(--gx-border-strong)' }} />
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── ArchForm ─────────────────────────────────────────────────────────────────

function ArchForm({ leaf }: { leaf: FlatLeaf }) {
  const danger = /danger|emergency|disaster|maintenance/i.test(leaf.leafLabel)
  const [saved, setSaved] = useState(false)
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }

  return (
    <div style={{ maxWidth: 620 }}>
      {danger && (
        <div className="banner" style={{ marginBottom: 16, borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <TriangleAlert size={16} style={{ color: 'var(--gx-danger)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="bt">Sensitive controls</div>
            <div className="bm">
              Actions here affect the whole platform. Changes are audited and may require a second approver.
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <label className="field">
          <span>Enabled</span>
          <div className="seg" style={{ width: '100%' }}>
            <button className="on" type="button" style={{ flex: 1 }}>On</button>
            <button type="button" style={{ flex: 1 }}>Off</button>
          </div>
        </label>
        <label className="field">
          <span>Scope</span>
          <select className="inp inp-sm">
            <option>This environment</option>
            <option>All environments</option>
          </select>
        </label>
        <label className="field">
          <span>Mode</span>
          <select className="inp inp-sm">
            <option>Standard</option>
            <option>Strict</option>
            <option>Permissive</option>
          </select>
        </label>
        <label className="field">
          <span>Owner</span>
          <input className="inp inp-sm" defaultValue="Platform Team" />
        </label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Notes</span>
          <textarea
            className="inp"
            rows={3}
            style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }}
            placeholder={`Configuration notes for ${leaf.leafLabel}`}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button
          className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}
          type="button"
          onClick={handleSave}
        >
          <Check size={13} />{saved ? 'Saved!' : 'Save changes'}
        </button>
        <button className="btn btn-ghost btn-sm" type="button">Reset</button>
      </div>
    </div>
  )
}

// ── StudioGenericPane (exported default) ─────────────────────────────────────

const ARCH_DESC: Record<Archetype, string> = {
  tokens: 'Define and preview design tokens. Changes cascade to every rendered surface.',
  monitor: 'Live observability — status, throughput and recent events for this surface.',
  canvas: 'Visual builder canvas. Drag nodes/blocks; connect and configure on the right.',
  table: 'Registry of configured items. Create, edit, version and govern each entry.',
  form: 'Configuration for this capability. Settings are saved to config and audited.',
}

export default function StudioGenericPane({ leaf }: { leaf: FlatLeaf }) {
  // Rich pane takes priority — if the leaf has a dedicated builder, render it directly.
  const RichPane = richPaneFor(leaf.leafLabel)
  if (RichPane) return <RichPane />

  // No rich pane → fall through to the generic archetype.
  const arch = archetypeFor(leaf.leafLabel)
  const desc = ARCH_DESC[arch]
  const IconCmp = iconFor(leaf.moduleIcon ?? leaf.groupIcon)

  return (
    <div>
      <div className="crumbs" style={{ marginTop: 0 }}>
        <span>{leaf.groupLabel}</span>
        {leaf.moduleLabel && (
          <>
            <span className="sep">/</span>
            <span>{leaf.moduleLabel}</span>
          </>
        )}
        <span className="sep">/</span>
        <span style={{ color: 'var(--gx-text-1)' }}>{leaf.leafLabel}</span>
      </div>
      <div className="section-head" style={{ marginTop: 6 }}>
        <IconCmp size={16} className="section-icon" />
        {leaf.leafLabel}
        <span style={{ flex: 1 }} />
        {arch === 'form' && (
          <button className="btn btn-primary btn-sm" type="button">
            <Check size={13} />Save
          </button>
        )}
      </div>
      <p className="hint" style={{ marginTop: -4, marginBottom: 16 }}>{desc}</p>
      {arch === 'table' && <ArchTable leaf={leaf} />}
      {arch === 'tokens' && <ArchTokens leaf={leaf} />}
      {arch === 'monitor' && <ArchMonitor leaf={leaf} />}
      {arch === 'canvas' && <ArchCanvas leaf={leaf} />}
      {arch === 'form' && <ArchForm leaf={leaf} />}
    </div>
  )
}
