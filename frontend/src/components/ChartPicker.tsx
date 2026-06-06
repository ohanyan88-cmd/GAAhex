// ChartPicker — modal for choosing which dashboard charts to show.
// MO-4 — wrapped in canonical `<Modal>` (was hand-rolled position:fixed,
// inset:0 chrome). Modal provides focus trap + Esc + body-scroll-lock +
// kit chrome consistently.
import { useState } from 'react'
import { Check } from 'lucide-react'
import { CHART_CATALOG, CATEGORIES, type ChartDef } from '../lib/dashboard-catalog'
import { Modal } from './Modal'
import { Button } from '../primitives'  // T-P3-7

export default function ChartPicker({
  initialSelected, onClose, onSave,
}: {
  initialSelected: Set<string>
  onClose: () => void
  onSave: (next: Set<string>) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected))
  const [query, setQuery] = useState('')

  const toggle = (id: string, implemented: boolean) => {
    if (!implemented) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  const selectAllImplemented = () => {
    setSelected(new Set(CHART_CATALOG.filter(c => c.implemented).map(c => c.id)))
  }

  const clearAll = () => setSelected(new Set())

  const matchesQuery = (c: ChartDef) =>
    !query ||
    c.title.toLowerCase().includes(query.toLowerCase()) ||
    c.description.toLowerCase().includes(query.toLowerCase()) ||
    c.category.toLowerCase().includes(query.toLowerCase())

  const implementedCount = CHART_CATALOG.filter(c => c.implemented).length

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Customize Dashboard"
      subtitle={`${selected.size} selected · ${implementedCount} available`}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={() => { onSave(selected); onClose() }}>
            Save layout
          </Button>
        </>
      }
    >
      <>
        {/* Search + bulk actions */}
        <div style={{ display: 'flex', gap: 'var(--gx-space-5)', marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Search charts…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="inp inp-sm"
            style={{ flex: 1 }}
          />
          <Button variant="secondary" size="sm" onClick={selectAllImplemented}>Select all available</Button>
          <Button variant="ghost" size="sm" onClick={clearAll}>Clear all</Button>
        </div>

        {/* Category list */}
        <div>
          {CATEGORIES.map(cat => {
            const items = CHART_CATALOG.filter(c => c.category === cat && matchesQuery(c))
            if (items.length === 0) return null
            return (
              <div key={cat} style={{ marginBottom: 18 }}>
                <div style={{
                  fontSize: 'var(--gx-text-11)', fontWeight: 700, color: 'var(--gx-text-2)',
                  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--gx-space-3)',
                  padding: '0 4px',
                }}>{cat}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                  {items.map(c => {
                    const on = selected.has(c.id)
                    return (
                      <div
                        key={c.id}
                        onClick={() => toggle(c.id, c.implemented)}
                        style={{
                          display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'flex-start',
                          padding: 'var(--gx-space-5) var(--gx-space-6)',
                          borderRadius: 6,
                          border: '1px solid var(--gx-border)',
                          background: on ? 'var(--gx-primary-soft, rgba(59,130,246,0.08))' : 'var(--gx-surface-2)',
                          cursor: c.implemented ? 'pointer' : 'not-allowed',
                          opacity: c.implemented ? 1 : 0.45,
                          transition: 'background .12s',
                        }}
                      >
                        {/* D18: checkbox "on" state = interactive selection
                            → --gx-interactive (azure family alias, theme-aware).
                            Border + fill both swap to the same token so the
                            check mark stays legible on the filled square. */}
                        <div style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          border: `1.5px solid ${on ? 'var(--gx-interactive)' : 'var(--gx-border-strong, var(--gx-border))'}`,
                          background: on ? 'var(--gx-interactive)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {on && <Check size={12} color="#fff" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--gx-text-13)', fontWeight: 600, color: 'var(--gx-text-1)' }}>
                            {c.title}
                            {!c.implemented && (
                              <span style={{ fontSize: 'var(--gx-text-10)', marginLeft: 'var(--gx-space-3)', color: 'var(--gx-text-3)' }}>(coming soon)</span>
                            )}
                          </div>
                          <div className="muted" style={{ fontSize: 'var(--gx-text-11)', lineHeight: 1.35, marginTop: 2 }}>
                            {c.description}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </>
    </Modal>
  )
}
