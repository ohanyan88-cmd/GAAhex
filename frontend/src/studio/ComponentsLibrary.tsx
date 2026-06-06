// GAAhex Studio — Components Library pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.

import React, { useState } from 'react'
import {
  BarChart3,
  Calendar,
  CreditCard,
  File,
  FileText,
  Globe,
  Image,
  Kanban,
  List,
  ListTree,
  MousePointerClick,
  PanelTop,
  Plus,
  Quote,
  Rows3,
  Search,
  Square,
  SquareStack,
  Table,
  TextCursorInput,
  ToggleLeft,
} from 'lucide-react'
import { Sec } from './_shared'

// Component palette — static until /api/studio/components is built.
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
          <div key={group} style={{ marginBottom: 'var(--gx-space-18)' }}>
            <div className="lbl" style={{ marginBottom: 'var(--gx-space-5)' }}>{group}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(132px,1fr))', gap: 'var(--gx-space-5)' }}>
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
