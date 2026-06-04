// ChartPicker — modal for choosing which dashboard charts to show.
// Categorized list with checkboxes. Disabled (greyed) for not-yet-implemented charts.
import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { CHART_CATALOG, CATEGORIES, type ChartDef } from '../lib/dashboard-catalog'

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
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--gx-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: '100%', maxWidth: 900, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--gx-surface)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--gx-border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, flex: 1 }}>
            Customize Dashboard
          </h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {selected.size} selected · {implementedCount} available
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {/* Search + bulk actions */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--gx-border)', display: 'flex', gap: 10 }}>
          <input
            type="text"
            placeholder="Search charts…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="inp inp-sm"
            style={{ flex: 1 }}
          />
          <button className="btn btn-secondary btn-sm" onClick={selectAllImplemented}>Select all available</button>
          <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear all</button>
        </div>

        {/* Category list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {CATEGORIES.map(cat => {
            const items = CHART_CATALOG.filter(c => c.category === cat && matchesQuery(c))
            if (items.length === 0) return null
            return (
              <div key={cat} style={{ marginBottom: 18 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--gx-text-2)',
                  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
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
                          display: 'flex', gap: 10, alignItems: 'flex-start',
                          padding: '10px 12px',
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
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gx-text-1)' }}>
                            {c.title}
                            {!c.implemented && (
                              <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--gx-text-3)' }}>(coming soon)</span>
                            )}
                          </div>
                          <div className="muted" style={{ fontSize: 11, lineHeight: 1.35, marginTop: 2 }}>
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

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--gx-border)',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onSave(selected); onClose() }}>
            Save layout
          </button>
        </div>
      </div>
    </div>
  )
}
