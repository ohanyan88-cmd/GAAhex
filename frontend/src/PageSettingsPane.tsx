import { useEffect, useState } from 'react'
import { toast } from './Toast'
import { LoadingState, ErrorBanner } from './States'
import { CheckIcon, ArrowUpIcon, ArrowDownIcon } from './icons'
import { bget } from './billing'
import {
  PAGE_SPECS, defaultDescriptor, resolveDescriptor, savePageConfig,
  type PageDescriptor, type ColumnDef,
} from './pageConfig'

// -----------------------------------------------------------------------------
// PageSettingsPane — the page-config editor for a BESPOKE page (Services).
// Edits a PAGE descriptor (title override + per-column visible/label/order), NOT entity fields.
// Lives inside ConfigureDrawer; persists via PUT /api/page-config/{pageKey}.
// -----------------------------------------------------------------------------
export default function PageSettingsPane({
  token, pageKey, onSaved,
}: { token: string; pageKey: string; onSaved?: () => void }) {
  const spec = PAGE_SPECS[pageKey]
  const [descriptor, setDescriptor] = useState<PageDescriptor | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!spec) { setError(`Unknown page "${pageKey}"`); return }
    let alive = true
    setError(''); setDescriptor(null); setDirty(false)
    bget<{ config?: Partial<PageDescriptor> }>(token, `/api/page-config/${pageKey}`)
      .then((res) => {
        if (!alive) return
        if (!res.ok && res.status !== 404) { setError('Failed to load page settings'); setDescriptor(defaultDescriptor(spec)); return }
        setDescriptor(resolveDescriptor(spec, res.ok ? res.data?.config : null))
      })
      .catch(() => { if (alive) setDescriptor(defaultDescriptor(spec)) })
    return () => { alive = false }
  }, [token, pageKey])

  function patchColumn(i: number, patch: Partial<ColumnDef>) {
    if (!descriptor) return
    setDescriptor({ ...descriptor, columns: descriptor.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
    setDirty(true)
  }

  function move(i: number, dir: -1 | 1) {
    if (!descriptor) return
    const j = i + dir
    if (j < 0 || j >= descriptor.columns.length) return
    const cols = descriptor.columns.slice()
    ;[cols[i], cols[j]] = [cols[j], cols[i]]
    setDescriptor({ ...descriptor, columns: cols })
    setDirty(true)
  }

  async function save() {
    if (!descriptor || saving) return
    setSaving(true)
    try {
      // Persist labels trimmed; an empty label falls back to the column's default on resolve.
      const clean: PageDescriptor = {
        title: descriptor.title && descriptor.title.trim() !== '' ? descriptor.title.trim() : null,
        columns: descriptor.columns.map((c) => ({ key: c.key, label: (c.label ?? '').trim(), visible: c.visible })),
      }
      await savePageConfig(token, pageKey, clean)
      toast.success('Page settings saved')
      setDirty(false)
      onSaved?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    if (!spec) return
    setDescriptor(defaultDescriptor(spec))
    setDirty(true)
  }

  if (error) return <ErrorBanner message={error} />
  if (!descriptor || !spec) return <LoadingState />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Title override */}
      <section>
        <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>Page heading</h4>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-3)' }}>
          Override the title shown at the top of the page. Leave blank for the default
          (<span style={{ fontStyle: 'italic' }}>{spec.defaultTitle}</span>).
        </p>
        <input
          className="inp inp-md"
          style={{ width: '100%' }}
          value={descriptor.title ?? ''}
          placeholder={spec.defaultTitle}
          onChange={(e) => { setDescriptor({ ...descriptor, title: e.target.value }); setDirty(true) }}
          aria-label="Page title override"
        />
      </section>

      {/* Column controls — only shown when the page has configurable columns */}
      {spec.defaultColumns.length > 0 && (
      <section>
        <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>Table columns</h4>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-3)' }}>
          Show or hide columns, rename their headers, and reorder them. The page's data and tools are unchanged.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {descriptor.columns.map((col, i) => {
            const def = spec.defaultColumns.find((d) => d.key === col.key)
            return (
              <div
                key={col.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', background: 'var(--surface-2)',
                  opacity: col.visible ? 1 : 0.6,
                }}
              >
                {/* visible toggle */}
                <button
                  type="button"
                  className={'check' + (col.visible ? ' on' : '')}
                  role="checkbox"
                  aria-checked={col.visible}
                  aria-label={`Show column ${col.label}`}
                  onClick={() => patchColumn(i, { visible: !col.visible })}
                  style={{
                    width: 18, height: 18, flexShrink: 0, borderRadius: 4,
                    border: '1px solid var(--border)', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: col.visible ? 'var(--accent)' : 'transparent',
                    color: col.visible ? 'var(--accent-contrast, #fff)' : 'transparent',
                  }}
                >
                  {col.visible && <CheckIcon size={12} />}
                </button>

                {/* label */}
                <input
                  className="inp inp-sm"
                  style={{ flex: 1, minWidth: 0 }}
                  value={col.label}
                  placeholder={def?.label ?? col.key}
                  onChange={(e) => patchColumn(i, { label: e.target.value })}
                  aria-label={`Label for column ${col.key}`}
                />
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{col.key}</span>

                {/* reorder */}
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  <button type="button" className="iconbtn" aria-label={`Move ${col.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUpIcon size={14} />
                  </button>
                  <button type="button" className="iconbtn" aria-label={`Move ${col.label} down`} disabled={i === descriptor.columns.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDownIcon size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4 }}>
        <button type="button" className="btn btn-primary btn-md" disabled={saving || !dirty} onClick={save}>
          {saving ? 'Saving…' : 'Save page settings'}
        </button>
        <button type="button" className="btn btn-ghost btn-md" disabled={saving} onClick={reset}>
          Reset to default
        </button>
      </div>
    </div>
  )
}
