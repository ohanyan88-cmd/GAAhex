import { useEffect, useState } from 'react'
import { bget, bpost } from '../lib/billing'
import { createRecord, transitionRecord } from '../lib/api'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
// StatusPill removed — using inline kit board-card pattern instead
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Modal'
import {
  PlusIcon, SparkleIcon, PhoneIcon, MailIcon, ArrowRightIcon,
  CloseIcon, UsersIcon, SearchIcon, GearIcon, InboxIcon,
} from '../components/icons'
import { useI18n } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import FieldInput, { type Field } from '../components/FieldInput'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { KPITile } from '../primitives'

// Lead Pipeline — a kanban over the CONFIG-driven `lead` entity, mirroring the DESIGN prototype:
// live /api/leads data, token theming, SVG icons, metadata-driven lifecycle
// (columns = the entity's statuses; card moves = its declared transitions), plus the dormant-safe
// AI lead score (/api/ai/score-lead). No mock data, no charting lib. route_slug = "leads".

type Status = { key: string; label: string; order: number; is_initial: boolean }
type Transition = { from: string; to: string }
type Def = { fields: Field[]; statuses: Status[]; transitions: Transition[] }
type Lead = { id: string; status: string | null; name?: string; phone?: string; email?: string; source?: string; [k: string]: any }
type Score = { score: number; band: 'hot' | 'warm' | 'cold'; reasons: string[] }

const SLUG = 'leads'

const initials = (name: string) =>
  (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'

export default function LeadPipelineView({ token, onOpenCustomer, canConfigure = false, onConfigure, capabilities = FULL_ACCESS }: { token: string; onOpenCustomer?: (id: string) => void; canConfigure?: boolean; onConfigure?: () => void; capabilities?: Capabilities }) {
  const canCreate = can(capabilities, 'lead', 'create')
  const canEdit   = can(capabilities, 'lead', 'edit')
  const { t } = useI18n()
  const [def, setDef] = useState<Def | null>(null)
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState('')
  const [scores, setScores] = useState<Record<string, Score | 'loading' | 'error'>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [converting, setConverting] = useState<string | null>(null)
  const [convertNA, setConvertNA] = useState(false)   // hide once the endpoint 404s
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true); setDenied(false); setError('')
    const d = await bget<any>(token, `/meta/entities/${SLUG}`)
    if (d.status === 403) { setDenied(true); setLoading(false); return }
    if (!d.ok || !d.data) { setError(t('leads.loadError', 'Failed to load the lead pipeline')); setLoading(false); return }
    const r = await bget<any>(token, `/api/${SLUG}`)
    if (r.status === 403) { setDenied(true); setLoading(false); return }
    if (!r.ok) { setError(t('leads.loadError', 'Failed to load the lead pipeline')); setLoading(false); return }
    setDef({ fields: d.data.fields ?? [], statuses: d.data.statuses ?? [], transitions: d.data.transitions ?? [] })
    setLeads(Array.isArray(r.data) ? r.data : (r.data?.items ?? []))
    setLoading(false)
  }
  useEffect(() => { load() }, [token])

  const columns = [...(def?.statuses ?? [])].sort((a, b) => a.order - b.order)
  const nextFrom = (status: string | null) => (def?.transitions ?? []).filter((x) => x.from === status).map((x) => x.to)
  // Required-field gate for the config-driven create form (skip the workflow-managed status field).
  const requiredKeys = (def?.fields ?? []).filter((f) => f.required && f.type !== 'status').map((f) => f.key)
  const canSubmit = requiredKeys.every((k) => String(form[k] ?? '').trim() !== '')
  const labelOf = (key: string) => columns.find((c) => c.key === key)?.label ?? key

  async function move(id: string, to: string) {
    setBusy(id)
    try { await transitionRecord(token, SLUG, id, to); await load() }
    catch (e: any) { setError(e?.message || t('leads.moveError', 'Could not move the lead')) }
    finally { setBusy(null) }
  }

  async function scoreLead(id: string) {
    setScores((s) => ({ ...s, [id]: 'loading' }))
    try {
      const data = await bpost<Score>(token, '/api/ai/score-lead', { record_id: id })
      setScores((s) => ({ ...s, [id]: data }))
    } catch {
      setScores((s) => ({ ...s, [id]: 'error' }))
    }
  }

  // Convert a (qualified) lead into a customer. Idempotent-safe: if the API reports already:true we
  // just open the existing customer. On success we toast and offer to open the new workspace.
  async function convert(lead: Lead) {
    setConverting(lead.id)
    try {
      const res = await bpost<{ customer_id?: string; id?: string; already?: boolean; customer?: { id?: string } }>(token, `/api/leads/${lead.id}/convert`)
      const cid = res.customer_id ?? res.customer?.id ?? res.id ?? null
      if (res.already) {
        toast.info(t('leads.alreadyCustomer', 'This lead is already a customer'))
        if (cid && onOpenCustomer) onOpenCustomer(cid)
        return
      }
      toast.success(t('leads.convertOk', 'Lead converted to customer'))
      await load()
      if (cid && onOpenCustomer) {
        const go = await confirmDialog({
          title: t('leads.convertedTitle', 'Customer created'),
          message: t('leads.openCustomerQ', 'Open the new customer workspace?'),
          confirmLabel: t('common.open', 'Open'),
          cancelLabel: t('common.stay', 'Stay'),
        })
        if (go) onOpenCustomer(cid)
      }
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 404) { setConvertNA(true); toast.error(t('leads.convertNA', 'Lead conversion isn’t available yet')) }
      else toast.error(err.message || t('leads.convertError', 'Could not convert the lead'))
    } finally { setConverting(null) }
  }

  async function createLead(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    try {
      await createRecord(token, SLUG, form)
      setShowNew(false); setForm({}); await load()
    } catch (e: any) { setError(e?.message || t('leads.createError', 'Could not create the lead')) }
    finally { setSaving(false) }
  }

  if (denied) return <PermissionDenied message={t('leads.denied', "You don't have permission to view leads.")} />

  const allLeads = leads ?? []
  const open = allLeads.filter((l) => !['CONVERTED', 'LOST'].includes((l.status || '').toUpperCase())).length
  const converted = allLeads.filter((l) => (l.status || '').toUpperCase() === 'CONVERTED').length
  const lost = allLeads.filter((l) => (l.status || '').toUpperCase() === 'LOST').length

  const q = search.trim().toLowerCase()
  const filteredLeads = q
    ? allLeads.filter((l) =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q) ||
        (l.phone || '').toLowerCase().includes(q) ||
        (l.source || '').toLowerCase().includes(q)
      )
    : allLeads

  const COL_TONE: Record<string, string> = {
    NEW: 'var(--gx-info)', OPEN: 'var(--gx-neutral)', QUALIFIED: 'var(--gx-info)',
    NEGOTIATION: 'var(--gx-warning)', WON: 'var(--gx-success)', CONVERTED: 'var(--gx-success)',
    LOST: 'var(--gx-danger)',
  }

  return (
    <div className="view-inner section-page fade">
      <div className="crumbs">
        <span>CRM</span><span className="sep">/</span>
        <span style={{ color: 'var(--gx-text-1)' }}>{t('leads.pipeline', 'Lead Pipeline')}</span>
      </div>

      <ViewHead
        icon={<ArrowRightIcon size={18} />}
        title={t('leads.pipeline', 'Lead Pipeline')}
        sub={loading ? 'Loading…' : `${columns.length} stage${columns.length === 1 ? '' : 's'} · workflow configured in Studio`}
        actions={
          <>
            {canConfigure && onConfigure && (
              <button className="btn btn-ghost btn-sm hide-sm" onClick={onConfigure} title="Configure this page">
                <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
              </button>
            )}
            {canCreate && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowNew((v) => !v)}>
                <PlusIcon size={13} />{t('leads.new', 'New lead')}
              </button>
            )}
          </>
        }
      />

      {/* KPI strip — shared KPITile primitive, identical to every other dashboard. */}
      {!loading && allLeads.length > 0 && (
        <div className="kpi-strip">
          <KPITile
            label={t('leads.open', 'Open')}
            value={open}
            subtitle="in pipeline"
            size="sm"
            onClick={() => setSearch('')}
            ariaLabel={`Open leads — ${open}. Click to clear filter.`}
          />
          <KPITile
            label={t('leads.converted', 'Converted')}
            value={converted}
            subtitle="won"
            size="sm"
            premium
          />
          <KPITile
            label={t('leads.lost', 'Lost')}
            value={lost}
            subtitle="closed-lost"
            size="sm"
            muted
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <div className="tb-search" style={{ width: 280 }}>
          <SearchIcon size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('leads.search', 'Search leads…')}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13, fontFamily: 'var(--gx-font-sans)' }}
          />
          {search && <button onClick={() => setSearch('')} className="tb-icon" style={{ width: 22, height: 22 }}><CloseIcon size={12} /></button>}
        </div>
        <span className="spacer" />
      </div>

      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load() }} />}
      {loading && <div className="hint" style={{ padding: 24 }}>{t('common.loading', 'Loading…')}</div>}

      {/* New lead inline form — config-driven from Studio entity fields */}
      {showNew && def && (
        <form className="rec-form" onSubmit={createLead} style={{ marginBottom: 14 }}>
          {def.fields.filter((f) => f.type !== 'status').map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              token={token}
              mode="creating"
              currentStatus={null}
              errorField={null}
              errorMsg=""
              value={form[f.key]}
              onChange={(v) => setForm({ ...form, [f.key]: v })}
            />
          ))}
          <div className="rec-form-actions">
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowNew(false)}>
              <CloseIcon size={14} />{t('common.cancel', 'Cancel')}
            </button>
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving || !canSubmit}>
              {saving ? t('common.saving', 'Saving…') : t('common.add', 'Add')}
            </button>
          </div>
        </form>
      )}

      {!loading && filteredLeads.length === 0 && !showNew && (
        <EmptyState
          icon={<InboxIcon size={40} />}
          title={t('leads.emptyTitle', 'No leads yet')}
          message={t('leads.empty', 'Create the first one to start the pipeline.')}
          action={canCreate ? (
            <button className="btn btn-primary btn-md" onClick={() => setShowNew(true)}>
              <PlusIcon size={13} aria-hidden /> {t('leads.new', 'New lead')}
            </button>
          ) : undefined}
        />
      )}

      {!loading && (filteredLeads.length > 0 || showNew) && columns.length > 0 && (
        <div className="kanban">
          {columns.map((col) => {
            const items = filteredLeads.filter((l) => (l.status ?? (col.is_initial ? col.key : null)) === col.key)
            const tone = COL_TONE[col.key.toUpperCase()] ?? 'var(--gx-neutral)'
            return (
              <div key={col.key} className="kcol">
                <div className="kcol-head">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{col.label}</span>
                  <span className="kcol-count">{items.length}</span>
                  {canCreate && (
                    <button className="btn btn-ghost btn-sm btn-icon" style={{ width: 22, height: 22 }} onClick={() => setShowNew(true)}>
                      <PlusIcon size={13} />
                    </button>
                  )}
                </div>
                <div className="kcol-body">
                  {items.map((lead) => {
                    const sc = scores[lead.id]
                    return (
                      <div key={lead.id} className="kcard">
                        <div className="mono" style={{ fontSize: 11, color: 'var(--gx-link)', marginBottom: 6 }}>
                          {lead.id?.slice(0, 12)}
                        </div>
                        <div style={{ fontSize: 12.5, lineHeight: 1.45, marginBottom: 10 }}>
                          {lead.name || t('leads.unnamed', 'Unnamed lead')}
                        </div>
                        {(lead.source || lead.phone || lead.email) && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, fontSize: 11, color: 'var(--gx-text-3)' }}>
                            {lead.source && <span>{lead.source}</span>}
                            {lead.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><PhoneIcon size={10} /><span className="mono">{lead.phone}</span></span>}
                            {lead.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MailIcon size={10} /><span className="mono">{lead.email}</span></span>}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{initials(lead.name || '')}</span>
                          {sc && sc !== 'loading' && sc !== 'error' && (
                            <span className={'pill ' + (sc.band === 'hot' ? 'pill-danger' : sc.band === 'warm' ? 'pill-warning' : 'pill-muted')} style={{ height: 18, marginLeft: 'auto' }} title={(sc.reasons ?? []).join(' · ')}>
                              {sc.band}
                            </span>
                          )}
                          <button className="btn btn-ghost btn-sm btn-icon" title={t('leads.aiScore', 'AI score')} onClick={() => scoreLead(lead.id)} disabled={sc === 'loading'} style={{ width: 22, height: 22 }}>
                            <SparkleIcon size={12} />
                          </button>
                          {canEdit && nextFrom(lead.status).map((to) => (
                            <button key={to} className="btn btn-ghost btn-sm" onClick={() => move(lead.id, to)} disabled={busy === lead.id} style={{ fontSize: 11 }}>
                              <ArrowRightIcon size={11} />{labelOf(to)}
                            </button>
                          ))}
                          {canEdit && !convertNA && ['QUALIFIED', 'CONVERTED'].includes((lead.status || '').toUpperCase()) && (
                            <button className="btn btn-primary btn-sm" onClick={() => convert(lead)} disabled={converting === lead.id} style={{ fontSize: 11 }}>
                              <UsersIcon size={11} />{converting === lead.id ? t('leads.converting', 'Converting…') : t('leads.convert', 'Convert')}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {items.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 12, borderRadius: 6, border: '1px dashed var(--gx-border)' }}>
                      No leads in this stage
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
