// GAAhex Studio — Data Binding pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.
// Wired to real entities/fields (GET /meta/entities, GET /meta/entities/{slug}).
// "Save bindings" POSTs each complete binding row to /api/page-bindings.

import { Button } from '../primitives'
import { useState, useEffect, useCallback } from 'react'
import { Check, Database, Plus, X } from 'lucide-react'
import { registerSnapshot, unregisterSnapshot } from './publishRegistry'
import { bpost } from '../lib/billing'
import { getEntities, getEntityDef } from '../lib/api'
import { Sec } from './_shared'

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
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Register snapshot so PublishSettings can capture the current binding state.
  useEffect(() => {
    registerSnapshot('data.binding', () => ({ bindings: binds }))
    return () => unregisterSnapshot('data.binding')
  }, [binds])

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

  const saveBindings = async () => {
    if (!token) return
    const ready = binds.filter(b => b.src && b.field)
    if (ready.length === 0) {
      setSaveState('ok')
      setTimeout(() => setSaveState('idle'), 2000)
      return
    }
    setSaveState('saving')
    setSaveError(null)
    try {
      await Promise.all(
        ready.map(b =>
          bpost(token, '/api/page-bindings', {
            component_key: b.id.toString(),
            entity_slug: b.src,
            field_key: b.field,
          })
        )
      )
      setSaveState('ok')
      setTimeout(() => setSaveState('idle'), 2500)
    } catch (e: any) {
      setSaveState('err')
      setSaveError(e?.message || 'Save failed')
    }
  }

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
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
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
                    <td className="actions-col">
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
      {saveState === 'ok' && (
        <div className="banner" style={{ marginBottom: 10, borderLeftColor: 'var(--gx-success)', background: 'var(--gx-success-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-success-fg)' }}>Bindings saved.</div>
        </div>
      )}
      {saveState === 'err' && saveError && (
        <div className="banner" style={{ marginBottom: 10, borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{saveError}</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm"
            type="button"
          onClick={add}
          disabled={!!error || entities.length === 0}>
          <Plus size={13} />Bind a component
        </Button>
        <Button variant="ghost" size="sm"
            type="button"
          onClick={saveBindings}
          disabled={saveState === 'saving'}>
          <Check size={13} />{saveState === 'saving' ? 'Saving…' : 'Save bindings'}
        </Button>
      </div>
    </div>
  )
}
