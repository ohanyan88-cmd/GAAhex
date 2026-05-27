import { useEffect, useState } from 'react'
import { bget, bpost } from './billing'
import { createRecord, transitionRecord } from './api'
import { EmptyState, ErrorBanner, PermissionDenied } from './States'
import { toast } from './Toast'
import { confirmDialog } from './Modal'
import {
  PlusIcon, SparkleIcon, PhoneIcon, MailIcon, ArrowRightIcon,
  CloseIcon, UsersIcon, GearIcon, SearchIcon,
} from './icons'
import { useI18n } from './i18n'
import ViewHead from './ViewHead'

// Lead Pipeline — a kanban over the CONFIG-driven `lead` entity, mirroring the DESIGN prototype:
// live /api/leads data, token theming, SVG icons, metadata-driven lifecycle
// (columns = the entity's statuses; card moves = its declared transitions), plus the dormant-safe
// AI lead score (/api/ai/score-lead). No mock data, no charting lib. route_slug = "leads".

type Status = { key: string; label: string; order: number; is_initial: boolean }
type Transition = { from: string; to: string }
type Def = { statuses: Status[]; transitions: Transition[] }
type Lead = { id: string; status: string | null; name?: string; phone?: string; email?: string; source?: string; [k: string]: any }
type Score = { score: number; band: 'hot' | 'warm' | 'cold'; reasons: string[] }

const SLUG = 'leads'
const SOURCES = ['Website', 'Referral', 'Cold Call', 'Ad']

// Map a status key to one of the shared .pill variants. Statuses are configurable so this
// only tints common verbs and never breaks — falls back to the default cobalt pill.
function pillVariant(key: string): string {
  const k = (key || '').toUpperCase()
  if (['QUALIFIED', 'CONVERTED', 'ACTIVE', 'WON', 'PAID', 'RESOLVED'].includes(k)) return 'pill-success'
  if (['LOST', 'CHURNED', 'CANCELLED', 'VOID', 'SUSPENDED'].includes(k)) return 'pill-danger'
  if (['NEW', 'DRAFT', 'PROSPECT', 'OPEN'].includes(k)) return 'pill-muted'
  return ''
}

// Derive a Pill `kind` string (for dot coloring via CSS currentColor) from a status key
function pillKind(key: string): string {
  const k = (key || '').toUpperCase()
  if (['QUALIFIED', 'CONVERTED', 'ACTIVE', 'WON', 'PAID', 'RESOLVED'].includes(k)) return 'success'
  if (['LOST', 'CHURNED', 'CANCELLED', 'VOID', 'SUSPENDED'].includes(k)) return 'danger'
  if (['NEW', 'DRAFT', 'PROSPECT', 'OPEN'].includes(k)) return 'muted'
  return 'primary'
}

const initials = (name: string) =>
  (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'

export default function LeadPipelineView({ token, onOpenCustomer }: { token: string; onOpenCustomer?: (id: string) => void }) {
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
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'Website' })
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
    setDef({ statuses: d.data.statuses ?? [], transitions: d.data.transitions ?? [] })
    setLeads(Array.isArray(r.data) ? r.data : (r.data?.items ?? []))
    setLoading(false)
  }
  useEffect(() => { load() }, [token])

  const columns = [...(def?.statuses ?? [])].sort((a, b) => a.order - b.order)
  const nextFrom = (status: string | null) => (def?.transitions ?? []).filter((x) => x.from === status).map((x) => x.to)
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
    if (!form.name.trim()) return
    setSaving(true)
    try {
      await createRecord(token, SLUG, { name: form.name.trim(), phone: form.phone, email: form.email, source: form.source })
      setShowNew(false); setForm({ name: '', phone: '', email: '', source: 'Website' }); await load()
    } catch (e: any) { setError(e?.message || t('leads.createError', 'Could not create the lead')) }
    finally { setSaving(false) }
  }

  if (denied) return <PermissionDenied message={t('leads.denied', "You don't have permission to view leads.")} />
  if (loading) return <div className="muted" style={{ padding: 24 }}>{t('common.loading', 'Loading…')}</div>

  const allLeads = leads ?? []
  const open = allLeads.filter((l) => !['CONVERTED', 'LOST'].includes((l.status || '').toUpperCase())).length
  const converted = allLeads.filter((l) => (l.status || '').toUpperCase() === 'CONVERTED').length
  const lost = allLeads.filter((l) => (l.status || '').toUpperCase() === 'LOST').length

  // Client-side search filter
  const q = search.trim().toLowerCase()
  const filteredLeads = q
    ? allLeads.filter((l) =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q) ||
        (l.phone || '').toLowerCase().includes(q) ||
        (l.source || '').toLowerCase().includes(q)
      )
    : allLeads

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ViewHead — matches DESIGN: icon, title, sub, actions */}
      <ViewHead
        icon={<ArrowRightIcon size={20} />}
        title={t('leads.pipeline', 'Lead Pipeline')}
        sub={t('leads.pipelineSub', `Workflow configured in Studio › Statuses › lead · ${columns.length} stages`)}
        actions={
          <>
            <button className="btn btn-ghost btn-sm">
              <GearIcon size={13} /> {t('leads.configureStages', 'Configure stages')}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNew((v) => !v)}>
              <PlusIcon size={13} /> {t('leads.new', 'New lead')}
            </button>
          </>
        }
      />

      {/* Search + filter bar — mirrors DESIGN search row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="search search-md" style={{ flex: '1 1 240px', maxWidth: 380 }}>
          <SearchIcon size={14} className="search-icon" />
          <input
            className="inp search-input"
            placeholder={t('leads.search', 'Search leads…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('leads.search', 'Search leads')}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')} aria-label={t('common.clear', 'Clear search')}>
              <CloseIcon size={12} />
            </button>
          )}
        </div>
        <span className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('leads.open', 'Open')}: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{open}</strong>
          <span style={{ opacity: 0.4 }}>|</span>
          {t('leads.converted', 'Converted')}: <strong style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{converted}</strong>
          <span style={{ opacity: 0.4 }}>|</span>
          {t('leads.lost', 'Lost')}: <strong style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>{lost}</strong>
        </span>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load() }} />}

      {/* New lead inline form */}
      {showNew && (
        <form className="kan-newform" onSubmit={createLead} style={{ marginBottom: 14 }}>
          <input className="inp inp-sm" placeholder={t('leads.name', 'Name')} value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus required aria-label={t('leads.name', 'Name')} />
          <input className="inp inp-sm" placeholder={t('leads.phone', 'Phone')} value={form.phone}
                 onChange={(e) => setForm({ ...form, phone: e.target.value })} aria-label={t('leads.phone', 'Phone')} />
          <input className="inp inp-sm" placeholder={t('leads.email', 'Email')} value={form.email}
                 onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label={t('leads.email', 'Email')} />
          <select className="inp inp-sm" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} aria-label={t('leads.source', 'Source')}>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving || !form.name.trim()}>
            {saving ? t('common.saving', 'Saving…') : t('common.add', 'Add')}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowNew(false)} aria-label={t('common.cancel', 'Cancel')}>
            <CloseIcon size={14} />
          </button>
        </form>
      )}

      {filteredLeads.length === 0 && !showNew
        ? (
          <EmptyState
            title={t('leads.emptyTitle', 'No leads yet')}
            message={t('leads.empty', 'Create the first one to start the pipeline.')}
          />
        )
        : (
          /* DESIGN kanban: .kanban grid > .kcol columns > .kcard cards */
          <div className="kanban">
            {columns.map((col) => {
              const items = filteredLeads.filter((l) => (l.status ?? (col.is_initial ? col.key : null)) === col.key)
              const variant = pillVariant(col.key)
              const kind = pillKind(col.key)
              return (
                <div className="kcol" key={col.key}>
                  {/* Column header: pill with dot + count badge */}
                  <div className="kcol-head">
                    <span className={`pill ${variant}`}>
                      <span className="pill-dot" />
                      {col.label}
                    </span>
                    <span className="kcol-count">{items.length}</span>
                  </div>

                  <div className="kcol-body">
                    {items.map((lead) => {
                      const sc = scores[lead.id]
                      return (
                        <div className="kcard" key={lead.id}>
                          {/* Card title row: avatar + name + AI score badge */}
                          <div className="kcard-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                              className="kcard-avatar"
                              style={{ width: 26, height: 26, fontSize: 10, fontWeight: 700, flexShrink: 0 }}
                            >
                              {initials(lead.name || '')}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {lead.name || t('leads.unnamed', 'Unnamed lead')}
                            </span>
                            {sc && sc !== 'loading' && sc !== 'error' && (
                              <span
                                className={`score-badge score-${sc.band}`}
                                title={(sc.reasons ?? []).join(' · ')}
                                style={{ flexShrink: 0 }}
                              >
                                {sc.score}
                              </span>
                            )}
                          </div>

                          {/* Contact meta row */}
                          <div className="kcard-meta">
                            {lead.source && <span>{lead.source}</span>}
                            {lead.phone && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <PhoneIcon size={11} /> {lead.phone}
                              </span>
                            )}
                            {lead.email && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <MailIcon size={11} /> {lead.email}
                              </span>
                            )}
                          </div>

                          {/* Card footer: actions */}
                          <div className="kcard-foot" style={{ flexWrap: 'wrap', gap: 6 }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => scoreLead(lead.id)}
                              disabled={sc === 'loading'}
                              title={t('leads.aiScore', 'AI lead score')}
                              style={{ fontSize: 11 }}
                            >
                              <SparkleIcon size={12} />
                              {sc === 'loading'
                                ? t('common.loading', 'Loading…')
                                : sc === 'error'
                                ? t('leads.scoreNA', 'n/a')
                                : sc
                                ? sc.band
                                : t('leads.score', 'Score')}
                            </button>
                            {nextFrom(lead.status).map((to) => (
                              <button
                                key={to}
                                className="btn btn-ghost btn-sm"
                                onClick={() => move(lead.id, to)}
                                disabled={busy === lead.id}
                                style={{ fontSize: 11 }}
                              >
                                <ArrowRightIcon size={12} /> {labelOf(to)}
                              </button>
                            ))}
                            {!convertNA && ['QUALIFIED', 'CONVERTED'].includes((lead.status || '').toUpperCase()) && (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => convert(lead)}
                                disabled={converting === lead.id}
                                title={t('leads.convert', 'Convert to customer')}
                                style={{ fontSize: 11 }}
                              >
                                <UsersIcon size={12} />
                                {converting === lead.id
                                  ? t('leads.converting', 'Converting…')
                                  : t('leads.convert', 'Convert')}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {items.length === 0 && (
                      <div style={{
                        padding: 16,
                        textAlign: 'center',
                        color: 'var(--text-3)',
                        fontSize: 12,
                        borderRadius: 6,
                        border: '1px dashed var(--border)',
                      }}>
                        {t('leads.dropHere', 'No leads in this stage')}
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
