// Studio Overview — the relational 9-layer architecture landing.
//
// Ports StudioOverview from design-system/ui_kits/portal/studio-tree.jsx (lines 244-303).
// 9 vertical cards in the canonical platform stack (Experience → Data → Logic → Security →
// Intelligence → Quality → Release → Governance → System Control), each separated by an
// italic relationship verb ("uses", "controlled by", "protected by", "enhanced by",
// "verified by", "published by", "tracked by", "managed by"). Below: 6-tile "Platform
// capabilities" grid for the support groups.
//
// Click → onPick({ group, module?, leaf? }) lands on the first leaf of that group, so each
// card is a one-click drill-in. P3 deliberately does NOT show empty mocks — the layer's
// module/leaf counts are computed from tree.ts so they always reflect the real spec.

import { Layers, Puzzle, ArrowRight, ChevronDown } from 'lucide-react'
import {
  firstLeafOfGroup,
  leafCountOfGroup,
  moduleCountOfGroup,
} from './tree'
import { iconFor } from './iconMap'
import type { StudioPick } from './StudioTree'

// One row per layer: [groupId, icon-slug, label, one-liner, relationship-to-next, tone]
// D18: nine layers = distinct-identity data (per D18 chart rules). Use the
// categorical viz palette `--viz-1..--viz-8` (locked, color-blind aware)
// instead of raw Tier-0 scales, inline hex, or overloading `--gx-gold` for
// identity. The viz palette was designed exactly for this scenario.
// system-control keeps slate text-2 as the passive "neutral last category" anchor.
type Layer = [string, string, string, string, string | null, string]
const LAYERS: Layer[] = [
  ['experience',     'monitor',     'Experience',     'What users see',          'uses',          'var(--viz-1)'],
  ['data',           'database',    'Data',           'What users store',        'controlled by', 'var(--viz-3)'],
  ['logic',          'zap',         'Logic',          'What the system does',    'protected by',  'var(--viz-2)'],
  ['security',       'shield',      'Security',       'Who can do it',           'enhanced by',   'var(--viz-7)'],
  ['intelligence',   'sparkles',    'Intelligence',   'How the system thinks',   'verified by',   'var(--viz-4)'],
  ['quality',        'check-check', 'Quality',        'How changes are tested',  'published by',  'var(--viz-6)'],
  ['release',        'rocket',      'Release',        'How changes go live',     'tracked by',    'var(--viz-5)'],
  ['governance',     'gavel',       'Governance',     'How changes are tracked', 'managed by',    'var(--viz-8)'],
  ['system-control', 'settings',    'System Control', 'How the platform runs',   null,            'var(--gx-text-2)'],
]

type Support = [string, string, string, string]
const SUPPORT: Support[] = [
  ['marketplace',     'store',            'Marketplace',     'Plugins, extensions & connectors'],
  ['developer',       'code',             'Developer',       'Code, SDK, CLI & API'],
  ['notifications',   'bell',             'Notifications',   'Email, SMS, push & rules'],
  ['search',          'search',           'Search',          'Indexes, ranking & access'],
  ['import-export',   'arrow-left-right', 'Import / Export', 'Data & migration tools'],
  ['documentation',   'book-open',        'Documentation',   'Docs, guides & changelog'],
]

export default function StudioOverview({ onPick }: { onPick: (p: StudioPick) => void }) {
  function landOnGroup(groupId: string) {
    const first = firstLeafOfGroup(groupId)
    if (!first) {
      onPick({ group: groupId })
      return
    }
    onPick({ group: first.groupId, module: first.moduleId, leaf: first.leafId })
  }

  return (
    <div>
      <div className="section-head" style={{ marginTop: 0 }}>
        <Layers size={16} className="section-icon" />
        Platform architecture
        <span className="hint" style={{ fontWeight: 400, marginLeft: 6 }}>
          · nine layers, one connected system
        </span>
      </div>
      <p className="hint" style={{ marginTop: -4, marginBottom: 18, maxWidth: 620 }}>
        Studio is not a collection of settings pages. Each layer is a visual management system that
        feeds the next — build the experience, store the data, drive the logic, protect it, make it
        intelligent, verify, ship, govern, and run.
      </p>

      <div className="layer-stack">
        {LAYERS.map((L) => {
          const [groupId, iconSlug, name, what, rel, tone] = L
          const Icon = iconFor(iconSlug)
          const mods = moduleCountOfGroup(groupId)
          const leaves = leafCountOfGroup(groupId)
          const stat = mods > 0 ? `${mods} modules` : `${leaves} leaves`
          return (
            <div key={groupId}>
              <button
                className="layer-card"
                onClick={() => landOnGroup(groupId)}
                style={{ ['--lt' as string]: tone } as React.CSSProperties}
                type="button"
              >
                <span className="layer-ic" style={{ background: tone }}>
                  <Icon size={20} />
                </span>
                <span className="layer-meta">
                  <span className="layer-name">{name}</span>
                  <span className="layer-what">{what}</span>
                </span>
                <span className="layer-count">{stat}</span>
                <ArrowRight size={16} className="layer-go" />
              </button>
              {rel && (
                <span className="layer-rel">
                  <span className="layer-rel-line" />
                  <span className="layer-rel-verb">{rel}</span>
                  <ChevronDown size={13} />
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="section-head">
        <Puzzle size={16} className="section-icon" />
        Platform capabilities
        <span className="hint" style={{ fontWeight: 400, marginLeft: 6 }}>
          · extend &amp; operate
        </span>
      </div>
      <div className="support-grid">
        {SUPPORT.map((S) => {
          const [groupId, iconSlug, name, sub] = S
          const Icon = iconFor(iconSlug)
          return (
            <button
              key={groupId}
              className="support-card"
              onClick={() => landOnGroup(groupId)}
              type="button"
            >
              <span className="support-ic">
                <Icon size={18} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 'var(--gx-text-13)', fontWeight: 600 }}>{name}</span>
                <span className="hint" style={{ fontSize: 11.5 }}>{sub}</span>
              </span>
              <ArrowRight size={14} style={{ color: 'var(--gx-text-3)' }} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
