// GAAhex Studio — Actions & Logic pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.
// Wired to the real automation engine: GET /api/events/types feeds the WHEN dropdown so
// every rule subscribes to a generic event the executor actually recognises (create / update
// / transition / delete). GET /api/events/registry adds per-entity status transitions for
// concrete events ("Invoice: DRAFT → SENT"). Action types come from automations.py
// ALLOWED_ACTION_TYPES so the DO picker stays in lockstep with the executor. Save flow is
// Full CRUD lives in AutomationsPane; this pane is the visual rule-builder UI.

import { Button } from '../primitives'
import { useState, useEffect } from 'react'
import { ArrowRight, Check, Plus, X, Zap } from 'lucide-react'
import { registerSnapshot, unregisterSnapshot } from './publishRegistry'
import { bget, bpost } from '../lib/billing'
import { Sec } from './_shared'

interface Rule {
  id: number
  on: string          // event_type or composite transition key (entity.from->to)
  cond: string        // free-text condition expression; structured rule-builder is future scope
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

  // Register snapshot so PublishSettings can capture the current rule state.
  useEffect(() => {
    registerSnapshot('logic.actions', () => ({ rules }))
    return () => unregisterSnapshot('logic.actions')
  }, [rules])

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
          <Button variant="primary" size="sm"
            type="button" onClick={add} disabled={loading || !!error}>
            <Plus size={13} />New rule
          </Button>
        }
      />
      {loading && (
        <div style={{ padding: '20px 0', color: 'var(--gx-text-3)', fontSize: 13 }}>
          Loading event registry…
        </div>
      )}
      {error && (
        <div className="banner" style={{ marginBottom: 'var(--gx-space-4)', borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{error}</div>
        </div>
      )}
      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map(r => (
            <div key={r.id} className="rule-card">
              {/* D18: WHEN/IF/DO are semantic-tagged pills. WHEN = trigger/event =
                  interactive (azure-soft). IF stays warning, DO presumably success. */}
              <span className="rule-pill" style={{ background: 'var(--gx-interactive-soft)', color: 'var(--gx-info-fg)' }}>
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
              {/* Free-text condition — structured field picker is future scope */}
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
              <Button variant="ghost" size="sm" iconOnly
            type="button" onClick={() => del(r.id)}>
                <X size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}
      {!loading && !error && (
        <div style={{ display: 'flex', gap: 'var(--gx-space-3)', marginTop: 14 }}>
          <Button variant="secondary" size="sm"
            type="button"
            disabled={rules.every(r => !r.on || !r.act)}
            title={rules.every(r => !r.on || !r.act) ? 'Fill in WHEN and DO for at least one rule' : 'Save rules to /api/automations'}
            onClick={async () => {
              if (!token) return
              const toSave = rules.filter(r => r.on && r.act)
              for (const r of toSave) {
                try {
                  await bpost(token, '/api/automations', {
                    key: `rule_${Date.now()}_${r.id}`,
                    name: r.cond || `${r.on} → ${r.act}`,
                    event_type: r.on.includes('->') ? 'workflow.transition' : r.on,
                    entity_key: r.on.split('.')[0] || 'record',
                    condition: r.cond || null,
                    action: { type: r.act, config: {} },
                    is_active: r.en,
                  })
                } catch { /* best-effort */ }
              }
            }}
          >
            <Check size={13} />Save rule{rules.filter(r => r.on && r.act).length > 1 ? 's' : ''}
          </Button>
        </div>
      )}
    </div>
  )
}
