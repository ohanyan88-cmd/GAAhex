import { useState } from 'react'
import { createEntity } from './api'
import {
  CloseIcon, GearIcon, RowsIcon, EditIcon, ArrowRightIcon, ChartIcon,
  DownloadIcon, SparkleIcon, BuildingIcon, LockIcon, PlusIcon,
  InfoIcon, CheckIcon,
} from './icons'
import ViewHead from './ViewHead'
import FieldsPane from './studio/FieldsPane'
import WorkflowsPane from './studio/WorkflowsPane'
import DashboardsPane from './studio/DashboardsPane'
import ViewsPane from './studio/ViewsPane'
import ReportsPane from './studio/ReportsPane'
import AutomationsPane from './studio/AutomationsPane'
import AppearancePane from './studio/AppearancePane'
import RolesPane from './studio/RolesPane'

const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'boolean', 'date', 'datetime', 'email', 'phone', 'select', 'ref', 'status']

type FieldRow = { key: string; label: string; type: string; required: boolean; extra: string }
type StatusRow = { key: string; label: string; is_initial: boolean }
type TransitionRow = { from: string; to: string; guard: string }

type Section =
  | 'entities' | 'fields' | 'workflows'
  | 'dashboards' | 'views' | 'reports'
  | 'auto'
  | 'appear' | 'perms'

// The SuperAdmin Studio: build a whole entity AS CONFIG from the browser — no SQL, no code.
export default function StudioView({ token, onCreated, focusSlug }: { token: string; onCreated: () => void; focusSlug?: string }) {
  // When opened via a page's "Configure page" button, jump straight to Fields for that entity.
  const [section, setSection] = useState<Section>(focusSlug ? 'fields' : 'entities')

  // Entity builder state
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [labelPlural, setLabelPlural] = useState('')
  const [slug, setSlug] = useState('')
  const [icon, setIcon] = useState('')
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
      setKey(''); setLabel(''); setLabelPlural(''); setSlug(''); setIcon('')
      setFields([{ key: 'name', label: 'Name', type: 'text', required: true, extra: '' }]); setStatuses([]); setTransitions([])
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const navSchema: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'entities',   label: 'Entities',              Icon: RowsIcon       },
    { id: 'fields',     label: 'Fields',                Icon: EditIcon       },
    { id: 'workflows',  label: 'Statuses / Workflows',  Icon: ArrowRightIcon },
  ]
  const navUi: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'dashboards', label: 'Dashboards',            Icon: ChartIcon      },
    { id: 'views',      label: 'Views',                 Icon: RowsIcon       },
    { id: 'reports',    label: 'Reports',               Icon: DownloadIcon   },
  ]
  const navTenant: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'appear',     label: 'Appearance',            Icon: BuildingIcon   },
    { id: 'perms',      label: 'Roles & Permissions',   Icon: LockIcon       },
  ]

  return (
    <>
      <ViewHead
        icon={<GearIcon size={20} />}
        title="Studio"
        sub="Configuration engine · zero-code entity, workflow & UI builder"
        actions={
          <button className="btn btn-ghost btn-sm">
            <DownloadIcon size={13} /> Export config
          </button>
        }
      />

      <div className="studio">
        <aside className="studio-nav">
          <div className="studio-nav-section">Schema</div>
          {navSchema.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={'studio-nav-item' + (section === id ? ' on' : '')}
              onClick={() => setSection(id)}
            >
              <Icon size={14} />{label}
            </button>
          ))}

          <div className="studio-nav-section">UI</div>
          {navUi.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={'studio-nav-item' + (section === id ? ' on' : '')}
              onClick={() => setSection(id)}
            >
              <Icon size={14} />{label}
            </button>
          ))}

          <div className="studio-nav-section">Logic</div>
          <button
            className={'studio-nav-item' + (section === 'auto' ? ' on' : '')}
            onClick={() => setSection('auto')}
          >
            <SparkleIcon size={14} />Automations
          </button>

          <div className="studio-nav-section">Tenant</div>
          {navTenant.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={'studio-nav-item' + (section === id ? ' on' : '')}
              onClick={() => setSection(id)}
            >
              <Icon size={14} />{label}
            </button>
          ))}
        </aside>

        <section className="studio-pane">
          {section === 'entities' && (
            <EntityBuilder
              formProps={{
                entityKey: key, setKey, label, setLabel, labelPlural, setLabelPlural,
                slug, setSlug, icon, setIcon,
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
          {section === 'appear'    && <AppearancePane token={token} />}
          {section === 'perms'     && <RolesPane token={token} />}
        </section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Entity builder — all original create-entity logic, reskinned layout
// ---------------------------------------------------------------------------

interface BuilderFormProps {
  entityKey: string; setKey: (v: string) => void
  label: string; setLabel: (v: string) => void
  labelPlural: string; setLabelPlural: (v: string) => void
  slug: string; setSlug: (v: string) => void
  icon: string; setIcon: (v: string) => void
  fields: FieldRow[]; setFields: (v: FieldRow[]) => void
  statuses: StatusRow[]; setStatuses: (v: StatusRow[]) => void
  transitions: TransitionRow[]; setTransitions: (v: TransitionRow[]) => void
  statusKeys: string[]
  fieldConfig: (f: FieldRow) => any
  submit: (e: React.FormEvent) => void
  error: string; ok: string
}

function EntityBuilder({ formProps: fp }: { formProps: BuilderFormProps }) {
  return (
    <div>
      {/* pane header */}
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>New entity</h3>
          <p className="hint" style={{ margin: 0 }}>
            Define an entity as configuration. No code, no SQL — it appears in the sidebar instantly.
          </p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-primary btn-sm">
          <PlusIcon size={13} /> New entity
        </button>
      </div>

      {fp.error && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          <div className="error-banner-icon"><InfoIcon size={16} /></div>
          <div>
            <div className="error-banner-title">Error</div>
            <div className="error-banner-msg">{fp.error}</div>
          </div>
        </div>
      )}
      {fp.ok && (
        <div className="error-banner" style={{ marginBottom: 16, borderLeftColor: 'var(--success)', background: 'var(--success-soft)' }}>
          <div style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }}><CheckIcon size={16} /></div>
          <div>
            <div className="error-banner-title" style={{ color: 'var(--text)' }}>Done</div>
            <div className="error-banner-msg">{fp.ok}</div>
          </div>
        </div>
      )}

      <form onSubmit={fp.submit}>
        {/* Identity fields */}
        <div className="section-head" style={{ marginTop: 0 }}>
          <EditIcon size={15} className="section-icon" /> Identity
        </div>
        <div className="rec-form">
          <label className="field">
            <span>Key (snake_case) *</span>
            <input className="inp inp-md" value={fp.entityKey} onChange={(e) => fp.setKey(e.target.value)} placeholder="opportunity" />
          </label>
          <label className="field">
            <span>Label *</span>
            <input className="inp inp-md" value={fp.label} onChange={(e) => fp.setLabel(e.target.value)} placeholder="Opportunity" />
          </label>
          <label className="field">
            <span>Label plural</span>
            <input className="inp inp-md" value={fp.labelPlural} onChange={(e) => fp.setLabelPlural(e.target.value)} placeholder="Opportunities" />
          </label>
          <label className="field">
            <span>Route slug (kebab-case) *</span>
            <input className="inp inp-md" value={fp.slug} onChange={(e) => fp.setSlug(e.target.value)} placeholder="opportunities" />
          </label>
          <label className="field">
            <span>Icon</span>
            <input className="inp inp-md" value={fp.icon} onChange={(e) => fp.setIcon(e.target.value)} placeholder="pipeline" />
          </label>
        </div>

        {/* Fields section */}
        <div className="section-head">
          <EditIcon size={15} className="section-icon" /> Fields
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
                      className="inp inp-sm"
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
                      className="inp inp-sm"
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

        {/* Statuses section */}
        <div className="section-head">
          <ArrowRightIcon size={15} className="section-icon" /> Statuses
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
                        className="inp inp-sm"
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
        )}

        {/* Transitions section */}
        <div className="section-head">
          <ChartIcon size={15} className="section-icon" /> Transitions
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
                        className="inp inp-sm"
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

        {/* info banner */}
        <div className="error-banner" style={{ margin: '20px 0 18px', borderLeftColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
          <div style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}><InfoIcon size={16} /></div>
          <div>
            <div className="error-banner-title" style={{ color: 'var(--text)' }}>Schema is config — no code change required</div>
            <div className="error-banner-msg">
              Changes write to <code className="mono">studio_config</code>. Existing records are validated lazily on next read. Destructive changes require confirmation with impact summary.
            </div>
          </div>
        </div>

        <div>
          <button type="submit" className="btn btn-accent btn-md">
            <CheckIcon size={14} /> Create entity
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generic immutable-row updater
// ---------------------------------------------------------------------------
function upd<T>(setter: (v: T[]) => void, arr: T[], i: number, patch: Partial<T>) {
  setter(arr.map((row, j) => (j === i ? { ...row, ...patch } : row)))
}
