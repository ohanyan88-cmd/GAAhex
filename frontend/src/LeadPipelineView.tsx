import { useEffect, useState } from 'react'
import { bget, bpost } from './billing'
import { createRecord, transitionRecord } from './api'
import { EmptyState, ErrorBanner, PermissionDenied } from './States'
import { toast } from './Toast'
import { confirmDialog } from './Modal'
import { PlusIcon, SparkleIcon, PhoneIcon, MailIcon, ArrowRightIcon, CloseIcon, UsersIcon } from './icons'
import { useI18n } from './i18n'

// Lead Pipeline — a kanban over the CONFIG-driven `lead` entity, mirroring the Figma model spec but
// in our real stack: live /api/leads data, token theming, SVG icons, the metadata-driven lifecycle
// (columns = the entity's statuses; card moves = its declared transitions), plus the dormant-safe
// AI lead score (/api/ai/score-lead). No mock data, no charting lib. route_slug = "leads".

type Status = { key: string; label: string; order: number; is_initial: boolean }
type Transition = { from: string; to: string }
type Def = { statuses: Status[]; transitions: Transition[] }
type Lead = { id: string; status: string | null; name?: string; phone?: string; email?: string; source?: string; [k: string]: any }
type Score = { score: number; band: 'hot' | 'warm' | 'cold'; reasons: string[] }

const SLUG = 'leads'
const SOURCES = ['Website', 'Referral', 'Cold Call', 'Ad']

// Map a status key → one of our shared .pill variants (generic heuristic; falls back to the default
// cobalt pill). Statuses are configurable, so this only tints common verbs and never breaks.
function pillVariant(key: string): string {
  const k = (key || '').toUpperCase()
  if (['QUALIFIED', 'CONVERTED', 'ACTIVE', 'WON', 'PAID', 'RESOLVED'].includes(k)) return 'pill-success'
  if (['LOST', 'CHURNED', 'CANCELLED', 'VOID', 'SUSPENDED'].includes(k)) return 'pill-danger'
  if (['NEW', 'DRAFT', 'PROSPECT', 'OPEN'].includes(k)) return 'pill-muted'
  return ''
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
  const [convertNA, setConvertNA] = useState(false)   // hide the action once the endpoint 404s
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'Website' })
  const [saving, setSaving] = useState(false)

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

  const open = (leads ?? []).filter((l) => !['CONVERTED', 'LOST'].includes((l.status || '').toUpperCase())).length
  const converted = (leads ?? []).filter((l) => (l.status || '').toUpperCase() === 'CONVERTED').length
  const lost = (leads ?? []).filter((l) => (l.status || '').toUpperCase() === 'LOST').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="eyebrow">{t('nav.crm', 'CRM')}</div>
          <h2 style={{ margin: 0 }}>{t('leads.pipeline', 'Lead Pipeline')}</h2>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          <PlusIcon /> {t('leads.new', 'New Lead')}
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load() }} />}

      {showNew && (
        <form className="kan-newform" onSubmit={createLead}>
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
          <button className="btn btn-sm" type="button" onClick={() => setShowNew(false)} aria-label={t('common.cancel', 'Cancel')}><CloseIcon /></button>
        </form>
      )}

      {leads && leads.length === 0
        ? <EmptyState title={t('leads.emptyTitle', 'No leads yet')} message={t('leads.empty', 'Create the first one to start the pipeline.')} />
        : (
          <div className="kanban">
            {columns.map((col) => {
              const items = (leads ?? []).filter((l) => (l.status ?? (col.is_initial ? col.key : null)) === col.key)
              return (
                <div className="kan-col" key={col.key}>
                  <div className="kan-col-head">
                    <span className={`pill ${pillVariant(col.key)}`}>{col.label}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{items.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map((lead) => {
                      const sc = scores[lead.id]
                      return (
                        <div className="kan-card" key={lead.id}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="kan-avatar">{initials(lead.name || '')}</span>
                            <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {lead.name || t('leads.unnamed', 'Unnamed lead')}
                            </span>
                            {sc && sc !== 'loading' && sc !== 'error' && (
                              <span className={`score-badge score-${sc.band}`} title={sc.reasons?.join(' · ')}>{sc.score}</span>
                            )}
                          </div>
                          <div className="kan-meta" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {lead.source && <span>{lead.source}</span>}
                            {lead.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><PhoneIcon /> {lead.phone}</span>}
                            {lead.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, overflow: 'hidden', textOverflow: 'ellipsis' }}><MailIcon /> {lead.email}</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <button className="btn btn-sm btn-ghost" onClick={() => scoreLead(lead.id)} disabled={sc === 'loading'} title={t('leads.aiScore', 'AI lead score')}>
                              <SparkleIcon /> {sc === 'loading' ? t('common.loading', 'Loading…') : sc === 'error' ? t('leads.scoreNA', 'n/a') : sc ? sc.band : t('leads.score', 'Score')}
                            </button>
                            {nextFrom(lead.status).map((to) => (
                              <button key={to} className="btn btn-sm" onClick={() => move(lead.id, to)} disabled={busy === lead.id}>
                                <ArrowRightIcon /> {labelOf(to)}
                              </button>
                            ))}
                            {!convertNA && ['QUALIFIED', 'CONVERTED'].includes((lead.status || '').toUpperCase()) && (
                              <button className="btn btn-sm btn-primary" onClick={() => convert(lead)} disabled={converting === lead.id}
                                      title={t('leads.convert', 'Convert to customer')}>
                                <UsersIcon /> {converting === lead.id ? t('leads.converting', 'Converting…') : t('leads.convert', 'Convert to customer')}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {items.length === 0 && <div className="kan-empty muted">—</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

      <div className="kan-summary">
        <span className="muted">{t('leads.open', 'Open')}: <b style={{ color: 'var(--text)' }}>{open}</b></span>
        <span className="muted">{t('leads.converted', 'Converted')}: <b style={{ color: 'var(--success)' }}>{converted}</b></span>
        <span className="muted">{t('leads.lost', 'Lost')}: <b style={{ color: 'var(--danger)' }}>{lost}</b></span>
      </div>
    </div>
  )
}
