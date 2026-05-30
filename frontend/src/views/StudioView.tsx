import { useState } from 'react'
import {
  Database, ListPlus, Workflow, LayoutDashboard, Table2, BarChart3,
  Zap, Shield, Wand2,
} from 'lucide-react'
import { createEntity } from '../lib/api'
import {
  CloseIcon, GearIcon, EditIcon, ArrowRightIcon, ChartIcon,
  DownloadIcon, PlusIcon, InfoIcon, CheckIcon, ChevronLeftIcon,
} from '../components/icons'
import ViewHead from '../components/ViewHead'
import FieldsPane from '../studio/FieldsPane'
import WorkflowsPane from '../studio/WorkflowsPane'
import DashboardsPane from '../studio/DashboardsPane'
import ViewsPane from '../studio/ViewsPane'
import ReportsPane from '../studio/ReportsPane'
import AutomationsPane from '../studio/AutomationsPane'
import RolesPane from '../studio/RolesPane'

// All 12 kit field types. Order matches Studio.jsx FIELD_TYPES.
const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'boolean', 'date', 'datetime', 'email', 'phone', 'select', 'ref', 'status']

type FieldRow = { key: string; label: string; type: string; required: boolean; extra: string }
type StatusRow = { key: string; label: string; is_initial: boolean }
type TransitionRow = { from: string; to: string; guard: string }

type Section =
  | 'entities' | 'fields' | 'workflows'
  | 'dashboards' | 'views' | 'reports'
  | 'auto' | 'perms'

// The SuperAdmin Studio: build a whole entity AS CONFIG from the browser — no SQL, no code.
// PROMPT 8 reskin: adopt kit structural patterns (grouped rail, kit `.banner`, kit `.rec-form`,
// inline live preview, gold initial-status dot). Mutations + data wiring unchanged.
export default function StudioView({ token, onCreated, focusSlug, entities, onBack, onSwitchEntity }: { token: string; onCreated: () => void; focusSlug?: string; entities?: { key: string; label: string; label_plural: string; route_slug: string }[]; onBack?: () => void; onSwitchEntity?: (slug: string) => void }) {
  // When opened via a page's "Configure page" button, jump straight to Fields for that entity.
  const [section, setSection] = useState<Section>(focusSlug ? 'fields' : 'entities')

  // Entity builder state — unchanged from the live build.
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [labelPlural, setLabelPlural] = useState('')
  const [slug, setSlug] = useState('')
  const [icon, setIcon] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<FieldRow[]>([{ key: 'name', label: 'Name', type: 'text', required: true, extra: '' }])
  const [statuses, setStatuses] = useState<StatusRow[]>([])
  const [transitions, setTransitions] = useState<TransitionRow[]>([])
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const statusKeys = statuses.map((s) => s.key).filter(Boolean)

  function fieldConfig(f: FieldRow): any {
    if (f.type === 'select' && f.extra.trim()) return { options: f.extra.split(',').map((o) => o.trim()).filter(Boolean) }
    if (f.type === 'ref' && f.extra.trim()) return { target: f.extra.trim() }
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setOk('')
    try {
      const def = {
        key: key.trim(), label: label.trim(), label_plural: labelPlural.trim() || undefined,
        route_slug: slug.trim(), icon: icon.trim() || undefined,
        fields: fields.filter((f) => f.key.trim()).map((f) => ({
          key: f.key.trim(), label: f.label.trim() || f.key.trim(), type: f.type, required: f.required, config: fieldConfig(f),
        })),
        statuses: statuses.filter((s) => s.key.trim()).map((s) => ({ key: s.key.trim(), label: s.label.trim() || s.key.trim(), is_initial: s.is_initial })),
        transitions: transitions.filter((t) => t.from && t.to).map((t) => ({ from: t.from, to: t.to, guard: t.guard.trim() || null })),
      }
      const res = await createEntity(token, def)
      setOk(`Created "${res.label_plural}" — it's now in the sidebar and fully working.`)
      // reset
      setKey(''); setLabel(''); setLabelPlural(''); setSlug(''); setIcon(''); setDescription('')
      setFields([{ key: 'name', label: 'Name', type: 'text', required: true, extra: '' }]); setStatuses([]); setTransitions([])
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Grouped left rail — Schema · UI · Logic — matches kit STUDIO_NAV.
  const navSchema: { id: Section; label: string; Icon: typeof Database }[] = [
    { id: 'entities',   label: 'Entities',              Icon: Database },
    { id: 'fields',     label: 'Fields',                Icon: ListPlus },
    { id: 'workflows',  label: 'Statuses / Workflows',  Icon: Workflow },
  ]
  const navUi: { id: Section; label: string; Icon: typeof Database }[] = [
    { id: 'dashboards', label: 'Dashboards',            Icon: LayoutDashboard },
    { id: 'views',      label: 'Views',                 Icon: Table2 },
    { id: 'reports',    label: 'Reports',               Icon: BarChart3 },
  ]

  // Focused "Configure page" mode — scoped to one entity (fields + workflow), with a searchable
  // page switcher and a Back-to-page button. Opened via a page's Configure-page button.
  if (focusSlug) {
    const cur = entities?.find((e) => e.route_slug === focusSlug)
    const focusedNav: { id: Section; label: string; Icon: typeof Database }[] = [
      { id: 'fields',    label: 'Fields',               Icon: ListPlus },
      { id: 'workflows', label: 'Statuses / Workflows', Icon: Workflow },
    ]
    const fsec: Section = section === 'workflows' ? 'workflows' : 'fields'
    return (
      <>
        <ViewHead
          icon={<GearIcon size={20} />}
          title={`Configure · ${cur?.label_plural ?? focusSlug}`}
          sub="This page's settings — fields & workflow"
          actions={onBack ? (
            <button className="btn btn-ghost btn-sm" onClick={onBack}>
              <ChevronLeftIcon size={13} /> Back to page
            </button>
          ) : undefined}
        />
        <div className="studio">
          <aside className="studio-nav">
            <div className="studio-nav-sec">Page</div>
            <div style={{ padding: '0 4px 10px' }}>
              <input
                className="inp inp-sm"
                list="studio-page-switch"
                key={focusSlug}
                defaultValue={cur?.label_plural ?? focusSlug}
                placeholder="Switch page…"
                aria-label="Switch page"
                onChange={(e) => {
                  const m = (entities ?? []).find((en) => en.label_plural === e.target.value || en.route_slug === e.target.value)
                  if (m && m.route_slug !== focusSlug) onSwitchEntity?.(m.route_slug)
                }}
              />
              <datalist id="studio-page-switch">
                {(entities ?? []).map((en) => <option key={en.route_slug} value={en.label_plural} />)}
              </datalist>
            </div>
            <div className="studio-nav-sec">Settings</div>
            {focusedNav.map(({ id, label, Icon }) => (
              <button key={id} className={'studio-nav-item' + (fsec === id ? ' on' : '')} onClick={() => setSection(id)}>
                <Icon size={14} />{label}
              </button>
            ))}
          </aside>
          <section className="studio-pane">
            {fsec === 'fields'    && <FieldsPane key={focusSlug} token={token} initialSlug={focusSlug} lockEntity />}
            {fsec === 'workflows' && <WorkflowsPane key={focusSlug} token={token} initialSlug={focusSlug} lockEntity />}
          </section>
        </div>
      </>
    )
  }

  return (
    <div className="view-inner fade" style={{ maxWidth: 1240 }}>
      <ViewHead
        icon={<GearIcon size={20} />}
        title="Studio"
        sub="Configuration engine · zero-code entity, workflow & UI builder"
        actions={
          <button className="btn btn-secondary btn-sm">
            <DownloadIcon size={13} /> Export config
          </button>
        }
      />

      <div className="studio">
        <aside className="studio-nav">
          <div className="studio-nav-sec">Schema</div>
          {navSchema.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={'studio-nav-item' + (section === id ? ' on' : '')}
              onClick={() => setSection(id)}
            >
              <Icon size={14} />{label}
            </button>
          ))}

          <div className="studio-nav-sec">UI</div>
          {navUi.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={'studio-nav-item' + (section === id ? ' on' : '')}
              onClick={() => setSection(id)}
            >
              <Icon size={14} />{label}
            </button>
          ))}

          <div className="studio-nav-sec">Logic</div>
          <button
            className={'studio-nav-item' + (section === 'auto' ? ' on' : '')}
            onClick={() => setSection('auto')}
          >
            <Zap size={14} />Automations
          </button>
          <button
            className={'studio-nav-item' + (section === 'perms' ? ' on' : '')}
            onClick={() => setSection('perms')}
          >
            <Shield size={14} />Roles & Permissions
          </button>
        </aside>

        <section className="studio-pane">
          {section === 'entities' && (
            <EntityBuilder
              formProps={{
                entityKey: key, setKey, label, setLabel, labelPlural, setLabelPlural,
                slug, setSlug, icon, setIcon, description, setDescription,
                fields, setFields, statuses, setStatuses, transitions, setTransitions,
                statusKeys, fieldConfig, submit, error, ok,
              }}
            />
          )}
          {section === 'fields'    && <FieldsPane token={token} initialSlug={focusSlug} />}
          {section === 'workflows' && <WorkflowsPane token={token} initialSlug={focusSlug} />}
          {section === 'dashboards'&& <DashboardsPane token={token} />}
          {section === 'views'     && <ViewsPane token={token} />}
          {section === 'reports'   && <ReportsPane token={token} />}
          {section === 'auto'      && <AutomationsPane token={token} />}
          {section === 'perms'     && <RolesPane token={token} />}
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entity builder — all original create-entity logic, kit-structured layout
// ---------------------------------------------------------------------------

interface BuilderFormProps {
  entityKey: string; setKey: (v: string) => void
  label: string; setLabel: (v: string) => void
  labelPlural: string; setLabelPlural: (v: string) => void
  slug: string; setSlug: (v: string) => void
  icon: string; setIcon: (v: string) => void
  description: string; setDescription: (v: string) => void
  fields: FieldRow[]; setFields: (v: FieldRow[]) => void
  statuses: StatusRow[]; setStatuses: (v: StatusRow[]) => void
  transitions: TransitionRow[]; setTransitions: (v: TransitionRow[]) => void
  statusKeys: string[]
  fieldConfig: (f: FieldRow) => any
  submit: (e: React.FormEvent) => void
  error: string; ok: string
}

function EntityBuilder({ formProps: fp }: { formProps: BuilderFormProps }) {
  // The gold dot on the first status (or any explicitly is_initial status) — kit's signal
  // that "this is where the workflow begins". Uses the design-system accent (gold) per spec.
  const goldDot = (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginRight: 6, flexShrink: 0 }} />
  )

  // Only render preview rows for fields with a key set — same filter as submit().
  const previewFields = fp.fields.filter((f) => f.key.trim())

  return (
    <div>
      {/* pane header */}
      <div className="row" style={{ marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>New entity</h3>
          <p className="hint" style={{ margin: 0 }}>
            Define an entity as configuration. No code, no SQL — it appears in the sidebar instantly.
          </p>
        </div>
        <span className="spacer" />
      </div>

      {/* System callout: changes here reshape every screen that uses this entity. Kit banner. */}
      <div className="banner" style={{ marginBottom: 18 }}>
        <InfoIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div className="bt">This is your configuration source-of-truth</div>
          <div className="bm">Changes here will reshape every screen that uses this entity — list views, drawers, forms and dashboards re-render from the same config.</div>
        </div>
      </div>

      {fp.error && (
        <div className="banner" style={{ marginBottom: 16, borderLeftColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
          <InfoIcon size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger)' }} />
          <div>
            <div className="bt">Error</div>
            <div className="bm">{fp.error}</div>
          </div>
        </div>
      )}
      {fp.ok && (
        <div className="banner" style={{ marginBottom: 16, borderLeftColor: 'var(--success)', background: 'var(--success-soft)' }}>
          <CheckIcon size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--success)' }} />
          <div>
            <div className="bt">Done</div>
            <div className="bm">{fp.ok}</div>
          </div>
        </div>
      )}

      <form onSubmit={fp.submit}>
        {/* ── Identity ────────────────────────────────────────────────────── */}
        <div className="section-head" style={{ marginTop: 0 }}>
          <span className="section-icon"><Database size={14} /></span> Identity
        </div>
        <div className="rec-form">
          <label className="field">
            <span>Key (snake_case) *</span>
            <input className="inp inp-sm mono" value={fp.entityKey} onChange={(e) => fp.setKey(e.target.value)} placeholder="opportunity" />
          </label>
          <label className="field">
            <span>Label *</span>
            <input className="inp inp-sm" value={fp.label} onChange={(e) => fp.setLabel(e.target.value)} placeholder="Opportunity" />
          </label>
          <label className="field">
            <span>Label plural</span>
            <input className="inp inp-sm" value={fp.labelPlural} onChange={(e) => fp.setLabelPlural(e.target.value)} placeholder="Opportunities" />
          </label>
          <label className="field">
            <span>Route slug (kebab) *</span>
            <input className="inp inp-sm mono" value={fp.slug} onChange={(e) => fp.setSlug(e.target.value)} placeholder="opportunities" />
          </label>
          <label className="field">
            <span>Icon</span>
            <input className="inp inp-sm" value={fp.icon} onChange={(e) => fp.setIcon(e.target.value)} placeholder="pipeline" />
          </label>
          <label className="field">
            <span>Description</span>
            <input className="inp inp-sm" value={fp.description} onChange={(e) => fp.setDescription(e.target.value)} placeholder="optional" />
          </label>
        </div>

        {/* ── Fields ──────────────────────────────────────────────────────── */}
        <div className="section-head">
          <span className="section-icon"><ListPlus size={14} /></span> Fields
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => fp.setFields([...fp.fields, { key: '', label: '', type: 'text', required: false, extra: '' }])}
          >
            <PlusIcon size={13} /> Add field
          </button>
        </div>
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Label</th>
                <th scope="col">Type</th>
                <th scope="col">Required</th>
                <th scope="col">Options / ref target</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {fp.fields.map((f, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="inp inp-sm mono"
                      value={f.key}
                      onChange={(e) => upd(fp.setFields, fp.fields, i, { key: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="inp inp-sm"
                      value={f.label}
                      onChange={(e) => upd(fp.setFields, fp.fields, i, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="inp inp-sm"
                      value={f.type}
                      onChange={(e) => upd(fp.setFields, fp.fields, i, { type: e.target.value })}
                    >
                      {/* All 12 kit types: text, textarea, number, money, boolean, date, datetime,
                          email, phone, select, ref, status. */}
                      {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => upd(fp.setFields, fp.fields, i, { required: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      className="inp inp-sm mono"
                      value={f.extra}
                      placeholder={f.type === 'select' ? 'a, b, c' : f.type === 'ref' ? 'customer' : ''}
                      onChange={(e) => upd(fp.setFields, fp.fields, i, { extra: e.target.value })}
                    />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label="Remove field"
                        onClick={() => fp.setFields(fp.fields.filter((_, j) => j !== i))}
                      >
                        <CloseIcon size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Status flow ─────────────────────────────────────────────────── */}
        <div className="section-head">
          <span className="section-icon"><Workflow size={14} /></span> Status flow
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fp.setStatuses([...fp.statuses, { key: '', label: '', is_initial: fp.statuses.length === 0 }])}
          >
            <PlusIcon size={13} /> Add status
          </button>
        </div>
        {fp.statuses.length === 0 ? (
          <p className="hint" style={{ marginBottom: 8 }}>Optional. Add statuses to enable a workflow for this entity.</p>
        ) : (
          <>
            {/* Visual flow: chips with arrows; first/initial status gets a gold dot. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {fp.statuses.map((sx, i) => {
                const isInitial = sx.is_initial || (i === 0 && !fp.statuses.some((s) => s.is_initial))
                const k = sx.key.trim() || sx.label.trim() || `S${i + 1}`
                return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <span className="pill pill-muted" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {isInitial && goldDot}
                      <span className="mono" style={{ fontSize: 11 }}>{k}</span>
                    </span>
                    {i < fp.statuses.length - 1 && (
                      <ArrowRightIcon size={14} style={{ color: 'var(--text-3)', margin: '0 4px' }} />
                    )}
                  </span>
                )
              })}
            </div>
            <div className="grid-wrap">
              <table className="grid studio">
                <thead>
                  <tr>
                    <th scope="col">Key (UPPER)</th>
                    <th scope="col">Label</th>
                    <th scope="col">Initial</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {fp.statuses.map((sx, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="inp inp-sm mono"
                          value={sx.key}
                          onChange={(e) => upd(fp.setStatuses, fp.statuses, i, { key: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="inp inp-sm"
                          value={sx.label}
                          onChange={(e) => upd(fp.setStatuses, fp.statuses, i, { label: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={sx.is_initial}
                          onChange={(e) => upd(fp.setStatuses, fp.statuses, i, { is_initial: e.target.checked })}
                        />
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label="Remove status"
                            onClick={() => fp.setStatuses(fp.statuses.filter((_, j) => j !== i))}
                          >
                            <CloseIcon size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Transitions ─────────────────────────────────────────────────── */}
        <div className="section-head">
          <span className="section-icon"><ChartIcon size={14} /></span> Transitions
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fp.setTransitions([...fp.transitions, { from: '', to: '', guard: '' }])}
          >
            <PlusIcon size={13} /> Add transition
          </button>
        </div>
        {fp.transitions.length === 0 ? (
          <p className="hint" style={{ marginBottom: 8 }}>Optional. Defines allowed status moves and optional guard expressions (GXL).</p>
        ) : (
          <div className="grid-wrap">
            <table className="grid studio">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Guard (GXL, optional)</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {fp.transitions.map((t, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        className="inp inp-sm"
                        value={t.from}
                        onChange={(e) => upd(fp.setTransitions, fp.transitions, i, { from: e.target.value })}
                      >
                        <option value=""></option>
                        {fp.statusKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        className="inp inp-sm"
                        value={t.to}
                        onChange={(e) => upd(fp.setTransitions, fp.transitions, i, { to: e.target.value })}
                      >
                        <option value=""></option>
                        {fp.statusKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        className="inp inp-sm mono"
                        value={t.guard}
                        placeholder="phone != None"
                        onChange={(e) => upd(fp.setTransitions, fp.transitions, i, { guard: e.target.value })}
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label="Remove transition"
                          onClick={() => fp.setTransitions(fp.transitions.filter((_, j) => j !== i))}
                        >
                          <CloseIcon size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Live preview ─────────────────────────────────────────────────
           Non-mutating renderer: shows what the generated record form + list
           view will look like once this config is saved. Drives home the
           thesis: every screen comes from the same config. */}
        <div className="section-head">
          <span className="section-icon"><Wand2 size={14} /></span> Live preview
          <span className="hint" style={{ fontWeight: 400, marginLeft: 6 }}>· what this config renders</span>
        </div>
        <LivePreview
          label={fp.label || 'Entity'}
          labelPlural={fp.labelPlural || fp.label || 'Records'}
          fields={previewFields}
          statuses={fp.statuses}
        />

        {/* ── Info banner ─────────────────────────────────────────────────── */}
        <div className="banner" style={{ margin: '20px 0 18px' }}>
          <InfoIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="bt">Schema is config — no code change required</div>
            <div className="bm">
              Changes write to <code className="codez">studio_config</code>. Existing records validate lazily on next read. Destructive changes require confirmation with an impact summary.
            </div>
          </div>
        </div>

        <div>
          <button type="submit" className="btn btn-gold btn-md">
            <CheckIcon size={14} /> Create entity
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Live preview — generated record form + list view from the current config.
// Read-only renderer. No mutations, no fetches.
// ---------------------------------------------------------------------------
function LivePreview({ label, labelPlural, fields, statuses }: { label: string; labelPlural: string; fields: FieldRow[]; statuses: StatusRow[] }) {
  if (fields.length === 0) {
    return (
      <p className="hint" style={{ margin: '0 0 8px' }}>Add a field above to see the generated form.</p>
    )
  }
  // Two columns side-by-side, collapsing to one on narrow viewports.
  return (
    <div className="cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {/* Generated record form — driven by `fields`. */}
      <div className="card" style={{ padding: 14 }}>
        <div className="uppercase-label" style={{ marginBottom: 12 }}>Generated record form</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((f) => (
            <label className="field" key={f.key}>
              <span>
                {f.label || f.key}
                {f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
              </span>
              {f.type === 'status' ? (
                <select className="inp inp-sm" disabled>
                  {statuses.length > 0
                    ? statuses.map((s) => <option key={s.key || s.label}>{s.label || s.key}</option>)
                    : <option>—</option>}
                </select>
              ) : f.type === 'boolean' ? (
                <select className="inp inp-sm" disabled><option>No</option><option>Yes</option></select>
              ) : f.type === 'textarea' ? (
                <textarea className="inp inp-sm" rows={2} disabled placeholder="textarea" />
              ) : (
                <input
                  className={'inp inp-sm' + (f.type === 'money' || f.type === 'number' ? ' mono' : '')}
                  disabled
                  placeholder={
                    f.type === 'money' ? '$0.00'
                    : f.type === 'ref' ? `Pick a ${f.extra || 'record'}`
                    : f.type === 'email' ? 'name@example.com'
                    : f.type === 'phone' ? '+1 555 0100'
                    : f.type === 'date' ? 'YYYY-MM-DD'
                    : f.type === 'datetime' ? 'YYYY-MM-DD HH:MM'
                    : f.type === 'select' ? (f.extra || 'pick…')
                    : f.type
                  }
                />
              )}
            </label>
          ))}
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled style={{ marginTop: 12 }}>
          <CheckIcon size={13} /> Save {label}
        </button>
      </div>

      {/* Generated list view — uses the first ~4 fields as columns. */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border-soft)' }}>
          <h3 style={{ fontSize: 13, margin: 0 }}>{labelPlural}</h3>
          <span className="spacer" />
          <span className="pill pill-muted">list view</span>
        </div>
        <table className="grid">
          <thead>
            <tr>{fields.slice(0, 4).map((f) => <th key={f.key}>{f.label || f.key}</th>)}</tr>
          </thead>
          <tbody>
            {/* Two illustrative sample rows so the list shape is visible without backend. */}
            {[['Acme rollout', 'Acme Corp', '$48,000', 'NEW'], ['City mesh', 'Metro Gov', '$120,000', 'QUALIFIED']].map((row, ri) => (
              <tr key={ri} style={{ cursor: 'default' }}>
                {fields.slice(0, 4).map((f, ci) => (
                  <td key={f.key} className={f.type === 'money' || f.type === 'number' ? 'mono' : ''}>
                    {f.type === 'status'
                      ? <span className="pill pill-info">{statuses[0]?.label || row[ci]}</span>
                      : row[ci]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generic immutable-row updater
// ---------------------------------------------------------------------------
function upd<T>(setter: (v: T[]) => void, arr: T[], i: number, patch: Partial<T>) {
  setter(arr.map((row, j) => (j === i ? { ...row, ...patch } : row)))
}
