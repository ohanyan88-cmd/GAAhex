// GAAhex Studio — Templates pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.

import { Button } from '../primitives'
import React from 'react'
import {
  BarChart3,
  CreditCard,
  FileText,
  IdCard,
  Kanban,
  LayoutDashboard,
  Plus,
  Rocket,
  Rows3,
  Store,
} from 'lucide-react'
import { Sec } from './_shared'

// Template gallery — static until /api/templates is built.
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 'var(--gx-space-7)' }}>
        {TEMPLATE_GALLERY.map(([ic, name, desc]) => (
          <div key={name as string} className="tpl-card">
            <div className="tpl-thumb">{ic}</div>
            <div style={{ padding: 'var(--gx-space-6) var(--gx-space-7)' }}>
              <div style={{ fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-semibold)' }}>{name}</div>
              <div className="hint" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-1)', lineHeight: 1.4 }}>{desc}</div>
              {/* Instantiate wires to POST /api/templates/{id}/instantiate when that endpoint is built */}
              <Button variant="secondary" size="sm"
            style={{ width: '100%', marginTop: 'var(--gx-space-5)' }} type="button" disabled>
                <Plus size={13} />Use template
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
