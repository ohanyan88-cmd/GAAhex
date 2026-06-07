// ProfileView — Workspace → My Profile. A bento HUB of data-rich section cards
// (Profile · My Requests · My Documents · My Benefits · Knowledge Base); clicking a card
// drills into its full section view. Requests / Benefits / Knowledge Base are REAL — backed by
// the canonical config-driven entities via the generic records API. My Documents is local demo
// for now (a per-user document store lands next). Visual: see styles/_profile.css.
import '../styles/_profile.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageShell } from '../page-shell'
import {
  UserIcon, ReceiptIcon, FolderIcon, BookmarkIcon, DownloadIcon, CheckIcon, ClockIcon,
  CalendarIcon, BriefcaseIcon, ArrowRightIcon, ChevronLeftIcon, PlusIcon,
} from '../components/icons'
import { Modal } from '../components/Modal'
import { FileUpload } from '../components/FileUpload'
import { DatePicker } from '../components/DatePicker'
import { Button, Input } from '../primitives'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'
import { listRecordsPaged, createRecord, getEntityDef } from '../lib/api'

function initials(name: string | null | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

type SectionKey = 'profile' | 'documents' | 'requests' | 'benefits' | 'kb'
type View = 'hub' | SectionKey
type ReqRec = { id: string; request_type?: string; subject?: string; details?: string; status: string; created_at?: string }
type BeneRec = { id: string; title: string; value?: string; note?: string; detail?: string }
type ArticleRec = { id: string; title: string; category?: string; body?: string }
type ReqOption = { value: string; label: string }
type ReqGroup = { cat: string; items: ReqOption[] }

const DOCS = [
  { name: 'Աշխատանքային պայմանագիր.pdf', kind: 'Contract', size: '240 KB', date: '2024-03-01' },
  { name: 'Անձնագիր (սկան).pdf', kind: 'Identity', size: '1.2 MB', date: '2024-03-01' },
  { name: 'NDA.pdf', kind: 'Legal', size: '180 KB', date: '2024-03-02' },
]

// Icon per request-type category (the part before " · " in each option).
const CAT_ICON: Record<string, typeof CalendarIcon> = {
  'Time Off': CalendarIcon,
  'Finance': ReceiptIcon,
  'IT & Access': BriefcaseIcon,
  'Administrative': UserIcon,
  'Development': ArrowRightIcon,
}

function reqPill(status: string): string {
  if (status === 'APPROVED') return 'pill-success'
  if (status === 'REJECTED') return 'pill-danger'
  if (status === 'CLOSED') return 'pill'
  return 'pill-info'
}
// status → state key for tinted dots / accent bars (presentational only)
function reqState(status: string): 'approved' | 'rejected' | 'pending' {
  if (status === 'APPROVED') return 'approved'
  if (status === 'REJECTED') return 'rejected'
  return 'pending'
}

export default function ProfileView() {
  const { t } = useI18n()
  const { user, token } = useAuth()
  const [view, setView] = useState<View>('hub')

  const [uploads, setUploads] = useState<File[]>([])

  // Real, persisted collections (canonical config-driven entities via the generic records API).
  const [requests, setRequests] = useState<ReqRec[]>([])
  const [reqOptions, setReqOptions] = useState<string[]>([])
  const [benefits, setBenefits] = useState<BeneRec[]>([])
  const [articles, setArticles] = useState<ArticleRec[]>([])

  // New-request modal: pick a type, then a small form.
  const [reqOpen, setReqOpen] = useState(false)
  const [reqType, setReqType] = useState<ReqOption | null>(null)
  const [reqSubject, setReqSubject] = useState('')
  const [reqFrom, setReqFrom] = useState('')
  const [reqTo, setReqTo] = useState('')
  const [reqReason, setReqReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [reqErr, setReqErr] = useState('')

  const [reqView, setReqView] = useState<ReqRec | null>(null)
  const [bene, setBene] = useState<BeneRec | null>(null)
  const [article, setArticle] = useState<ArticleRec | null>(null)

  const loadRequests = useCallback(async () => {
    if (!token) return
    const { rows } = await listRecordsPaged(token, 'requests', new URLSearchParams({ sort: '-created_at' }))
    setRequests(rows as unknown as ReqRec[])
    if (reqOptions.length === 0) {
      try {
        const def = await getEntityDef(token, 'requests')
        const fld = (def.fields || []).find((f: { key: string }) => f.key === 'request_type')
        setReqOptions((fld?.config?.options as string[]) || [])
      } catch { /* picker falls back to empty — surfaced in the modal */ }
    }
  }, [token, reqOptions.length])

  const loadBenefits = useCallback(async () => {
    if (!token) return
    const { rows } = await listRecordsPaged(token, 'benefits', new URLSearchParams())
    setBenefits(rows as unknown as BeneRec[])
  }, [token])

  const loadArticles = useCallback(async () => {
    if (!token) return
    const { rows } = await listRecordsPaged(token, 'kb-articles', new URLSearchParams())
    setArticles(rows as unknown as ArticleRec[])
  }, [token])

  // Load everything up front so the hub can show live counts + previews.
  useEffect(() => { loadRequests() }, [loadRequests])
  useEffect(() => { loadBenefits() }, [loadBenefits])
  useEffect(() => { loadArticles() }, [loadArticles])

  // Group the request-type options by their "Category · Name" prefix for the picker grid.
  const reqGroups = useMemo<ReqGroup[]>(() => {
    const m = new Map<string, ReqOption[]>()
    for (const o of reqOptions) {
      const idx = o.indexOf(' · ')
      const cat = idx >= 0 ? o.slice(0, idx) : 'Other'
      const label = idx >= 0 ? o.slice(idx + 3) : o
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat)!.push({ value: o, label })
    }
    return [...m.entries()].map(([cat, items]) => ({ cat, items }))
  }, [reqOptions])

  const name = user?.name || t('common.you', 'You')
  const role = user?.can_configure ? t('role.admin', 'Administrator') : t('role.member', 'Member')
  const pending = requests.filter((r) => !['APPROVED', 'REJECTED', 'CLOSED'].includes(r.status || '')).length
  const allDocs = [
    ...uploads.map((f) => ({ name: f.name, kind: 'Upload', size: `${Math.max(1, Math.round(f.size / 1024))} KB`, date: new Date().toISOString().slice(0, 10) })),
    ...DOCS,
  ]

  function openNewReq() {
    setReqType(null); setReqSubject(''); setReqFrom(''); setReqTo(''); setReqReason(''); setReqErr(''); setReqOpen(true)
  }
  function pickType(o: ReqOption) { setReqType(o); setReqSubject(o.label) }

  async function submitReq() {
    if (!reqType || !token) return
    setSaving(true); setReqErr('')
    try {
      const dateLine = reqFrom && reqTo ? `${reqFrom} → ${reqTo}` : reqFrom || reqTo || ''
      const details = [dateLine, reqReason].filter(Boolean).join('\n\n')
      await createRecord(token, 'requests', {
        request_type: reqType.value,
        subject: reqSubject.trim() || reqType.label,
        details: details || null,
        priority: 'Normal',
      })
      setReqOpen(false)
      await loadRequests()
    } catch (e) {
      setReqErr(e instanceof Error ? e.message : t('common.error', 'Something went wrong'))
    } finally {
      setSaving(false)
    }
  }

  // ── HUB (bento) ───────────────────────────────────────────────────────────
  function hub() {
    return (
      <div className="hub-bento">
        {/* Profile */}
        <button type="button" className="hub-tile b-profile" onClick={() => setView('profile')}>
          <div className="hub-tile-top">
            <span className="hub-ic"><UserIcon size={20} /></span>
            <span className="hub-stat"><span className="hub-stat-v">{role}</span><span className="hub-stat-l">{t('profile.access', 'access')}</span></span>
          </div>
          <div><div className="hub-tile-title">{t('profile.tab.profile', 'Profile')}</div><div className="hub-tile-blurb">Operations · Yerevan</div></div>
        </button>

        {/* My Requests (wide, with preview) */}
        <button type="button" className="hub-tile b-requests" onClick={() => setView('requests')}>
          <div className="hub-tile-top">
            <span className="hub-ic"><ReceiptIcon size={20} /></span>
            <span className="hub-stat"><span className="hub-stat-v">{pending}</span><span className="hub-stat-l">{t('profile.pending', 'pending')}</span></span>
          </div>
          <div>
            <div className="hub-tile-title">{t('profile.tab.requests', 'My Requests')}</div>
            <div className="hub-tile-blurb">{requests.length} {t('profile.total', 'total')} · {pending} {t('profile.awaiting', 'awaiting review')}</div>
          </div>
          {requests.length > 0 && (
            <div className="hub-tile-foot"><div className="hub-prev">
              {requests.slice(0, 3).map((r) => {
                const st = r.status || 'DRAFT'
                return (
                  <div key={r.id} className="hub-prev-row">
                    <span className={'hub-dot is-' + reqState(st)} />
                    <span className="hub-prev-main">{r.subject || r.request_type}</span>
                    <span className={'pill ' + reqPill(st)}>{st}</span>
                  </div>
                )
              })}
            </div></div>
          )}
        </button>

        {/* My Documents */}
        <button type="button" className="hub-tile b-documents" onClick={() => setView('documents')}>
          <div className="hub-tile-top">
            <span className="hub-ic"><FolderIcon size={20} /></span>
            <span className="hub-stat"><span className="hub-stat-v">{allDocs.length}</span><span className="hub-stat-l">{t('profile.files', 'files')}</span></span>
          </div>
          <div><div className="hub-tile-title">{t('profile.tab.documents', 'My Documents')}</div><div className="hub-tile-blurb">Contracts, ID, tax &amp; HR records</div></div>
        </button>

        {/* My Benefits */}
        <button type="button" className="hub-tile b-benefits" onClick={() => setView('benefits')}>
          <div className="hub-tile-top">
            <span className="hub-ic"><BriefcaseIcon size={20} /></span>
            <span className="hub-stat"><span className="hub-stat-v">{benefits.length}</span><span className="hub-stat-l">{t('profile.enrolled', 'enrolled')}</span></span>
          </div>
          <div><div className="hub-tile-title">{t('profile.tab.benefits', 'My Benefits')}</div><div className="hub-tile-blurb">Health, leave, learning &amp; more</div></div>
        </button>

        {/* Knowledge Base (wide, with preview) */}
        <button type="button" className="hub-tile b-kb" onClick={() => setView('kb')}>
          <div className="hub-tile-top">
            <span className="hub-ic"><BookmarkIcon size={20} /></span>
            <span className="hub-stat"><span className="hub-stat-v">{articles.length}</span><span className="hub-stat-l">{t('profile.articles', 'articles')}</span></span>
          </div>
          <div><div className="hub-tile-title">{t('profile.tab.kb', 'Knowledge Base')}</div><div className="hub-tile-blurb">{t('profile.guides', 'Guides & how-tos')}</div></div>
          {articles.length > 0 && (
            <div className="hub-tile-foot"><div className="hub-prev">
              {articles.slice(0, 3).map((a) => (
                <div key={a.id} className="hub-prev-row">
                  <span className="hub-prev-ic"><BookmarkIcon size={15} /></span>
                  <span className="hub-prev-main">{a.title}</span>
                  <span className="hub-prev-ic"><ArrowRightIcon size={14} /></span>
                </div>
              ))}
            </div></div>
          )}
        </button>
      </div>
    )
  }

  // ── section back bar ───────────────────────────────────────────────────────
  function backBar(title: string, sub: string, action?: React.ReactNode) {
    return (
      <div className="pv-backbar">
        <Button variant="secondary" size="sm" onClick={() => setView('hub')}>
          <ChevronLeftIcon size={16} /> {t('common.back', 'Back')}
        </Button>
        <div className="pv-backbar-titles">
          <div className="pv-backbar-title">{title}</div>
          <div className="pv-backbar-sub">{sub}</div>
        </div>
        {action}
      </div>
    )
  }

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'My Profile']}
      icon={<UserIcon size={18} />}
      title={t('profile.title', 'My profile')}
      subtitle={t('profile.subtitle2', 'Everything about your account, in one place')}
    >
      {view === 'hub' && hub()}

      {/* ════════════ PROFILE ════════════ */}
      {view === 'profile' && (
        <>
          {backBar(t('profile.tab.profile', 'Profile'), t('profile.accountDetails', 'Your account details'))}
          <div className="pv-surface pv-mb">
            <div className="pv-hero">
              <span className="pv-avatar-lg">{initials(user?.name)}</span>
              <div className="pv-hero-info">
                <div className="pv-hero-name">{name}</div>
                <div className="pv-hero-email mono">{user?.email}</div>
                <span className="pill pill-gold pv-hero-role">{role}</span>
              </div>
            </div>
          </div>
          <div className="pv-info-grid">
            <div className="pv-info-cell"><span className="pv-info-label">{t('auth.email', 'Email')}</span><span className="pv-info-value mono">{user?.email}</span></div>
            <div className="pv-info-cell"><span className="pv-info-label">{t('profile.phone', 'Phone')}</span><span className="pv-info-value">+374 10 100000</span></div>
            <div className="pv-info-cell"><span className="pv-info-label">{t('profile.jobTitle', 'Job title')}</span><span className="pv-info-value">{role}</span></div>
            <div className="pv-info-cell"><span className="pv-info-label">{t('profile.team', 'Team')}</span><span className="pv-info-value">Operations</span></div>
            <div className="pv-info-cell"><span className="pv-info-label">{t('profile.joined', 'Joined')}</span><span className="pv-info-value">2024-03-01</span></div>
          </div>
        </>
      )}

      {/* ════════════ DOCUMENTS ════════════ */}
      {view === 'documents' && (
        <>
          {backBar(t('profile.tab.documents', 'My Documents'), `${allDocs.length} ${t('profile.files', 'files')}`)}
          <div className="pv-surface pv-block">
            <div className="pv-block-title">{t('profile.upload', 'Upload a document')}</div>
            <FileUpload value={uploads} onChange={setUploads} hint={t('profile.uploadHint', 'ID, passport, agreement — PDF / image / doc')} />
          </div>
          <div className="pv-surface pv-card-flush">
            {allDocs.map((d, i) => (
              <div key={d.name + i} className="pv-doc-row">
                <span className="pv-doc-icon"><FolderIcon size={16} /></span>
                <span className="pv-doc-main">
                  <span className="pv-doc-name">{d.name}</span>
                  <span className="pv-doc-meta">{d.kind} · {d.size} · {d.date}</span>
                </span>
                <span className="pv-doc-dl"><DownloadIcon size={15} /></span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ════════════ REQUESTS ════════════ */}
      {view === 'requests' && (
        <>
          {backBar(
            t('profile.tab.requests', 'My Requests'),
            `${requests.length} ${t('profile.total', 'total')}`,
            <Button variant="primary" size="sm" onClick={openNewReq}><PlusIcon size={13} /> {t('profile.newRequest', 'New request')}</Button>,
          )}
          <div className="pv-surface pv-card-flush">
            {requests.length === 0 && <div className="pv-empty">{t('profile.noRequests', 'No requests yet — create your first one.')}</div>}
            {requests.map((r) => {
              const st = r.status || 'DRAFT'
              return (
                <button key={r.id} type="button" className="pv-req-row" onClick={() => setReqView(r)}>
                  <span className={'pv-req-accent is-' + reqState(st)} />
                  <span className="pv-req-icon">{st === 'APPROVED' ? <CheckIcon size={15} /> : <ClockIcon size={15} />}</span>
                  <span className="pv-req-main">
                    <span className="pv-req-title">{r.subject || r.request_type}</span>
                    <span className="pv-req-sub">{r.request_type}{r.created_at ? ' · ' + r.created_at.slice(0, 10) : ''}</span>
                  </span>
                  <span className={'pill ' + reqPill(st)}>{st}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ════════════ BENEFITS ════════════ */}
      {view === 'benefits' && (
        <>
          {backBar(t('profile.tab.benefits', 'My Benefits'), `${benefits.length} ${t('profile.enrolled', 'enrolled')}`)}
          {benefits.length === 0 ? (
            <div className="pv-surface pv-empty">{t('profile.noBenefits', 'No benefits to show.')}</div>
          ) : (
            <div className="pv-benefits-grid">
              {benefits.map((bn) => (
                <button key={bn.id} type="button" className="pv-benefit-card" onClick={() => setBene(bn)}>
                  <span className="pv-benefit-icon-wrap"><BriefcaseIcon size={16} /></span>
                  <span className="pv-benefit-label">{bn.title}</span>
                  <span className="pv-benefit-val">{bn.value}</span>
                  {bn.note && <span className="pv-benefit-note">{bn.note}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ════════════ KNOWLEDGE BASE ════════════ */}
      {view === 'kb' && (
        <>
          {backBar(t('profile.tab.kb', 'Knowledge Base'), `${articles.length} ${t('profile.articles', 'articles')}`)}
          <div className="pv-surface pv-card-flush">
            {articles.length === 0 && <div className="pv-empty">{t('profile.noArticles', 'No articles yet.')}</div>}
            {articles.map((a) => (
              <button key={a.id} type="button" className="pv-kb-row" onClick={() => setArticle(a)}>
                <span className="pv-kb-icon"><BookmarkIcon size={15} /></span>
                <span className="pv-kb-main">
                  <span className="pv-kb-title">{a.title}</span>
                  <span className="pv-kb-cat">{a.category}</span>
                </span>
                <span className="pv-kb-arrow"><ArrowRightIcon size={15} /></span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── New request modal ──────────────────────────────────────────────── */}
      {reqOpen && (
        <Modal
          open
          onClose={() => setReqOpen(false)}
          size={reqType ? 'md' : 'lg'}
          title={t('profile.newRequest', 'New request')}
          subtitle={reqType ? reqType.label : t('profile.pickRequest', 'Choose a request type')}
          footer={reqType ? (
            <>
              <Button variant="ghost" size="md" onClick={() => setReqType(null)} disabled={saving}>{t('common.back', 'Back')}</Button>
              <Button variant="primary" size="md" onClick={submitReq} disabled={saving}>
                {saving ? t('common.saving', 'Saving…') : t('profile.submitRequest', 'Submit request')}
              </Button>
            </>
          ) : undefined}
        >
          {!reqType ? (
            <div className="pv-req-pick">
              {reqGroups.length === 0 && <div className="pv-empty">{t('profile.noReqTypes', 'No request types configured.')}</div>}
              {reqGroups.map((g) => {
                const Icon = CAT_ICON[g.cat] || ReceiptIcon
                return (
                  <div key={g.cat} className="pv-req-group">
                    <div className="pv-req-group-head">{g.cat}</div>
                    <div className="rec-pick-cards pv-req-grid">
                      {g.items.map((it) => (
                        <button key={it.value} type="button" className="rec-pick-card" onClick={() => pickType(it)}>
                          <span className="rec-pick-card-icon"><Icon size={20} aria-hidden /></span>
                          <span className="rec-pick-card-title">{it.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="pv-req-form">
              <label className="field pv-req-wide"><span>{t('profile.subject', 'Subject')}</span>
                <Input value={reqSubject} onChange={(e) => setReqSubject(e.target.value)} />
              </label>
              <label className="field"><span>{t('profile.from', 'From')}</span><DatePicker value={reqFrom} onChange={setReqFrom} /></label>
              <label className="field"><span>{t('profile.to', 'To')}</span><DatePicker value={reqTo} onChange={setReqTo} /></label>
              <label className="field pv-req-wide"><span>{t('profile.reason', 'Reason / details')}</span>
                <textarea className="inp inp-area" rows={4} value={reqReason} onChange={(e) => setReqReason(e.target.value)} />
              </label>
              {reqErr && <div className="pv-req-err">{reqErr}</div>}
            </div>
          )}
        </Modal>
      )}

      {/* ── Request detail modal ───────────────────────────────────────────── */}
      {reqView && (
        <Modal open onClose={() => setReqView(null)} size="md" title={reqView.subject || reqView.request_type || ''} subtitle={reqView.request_type}>
          <div className="pv-detail">
            <span className={'pill ' + reqPill(reqView.status || 'DRAFT')}>{reqView.status || 'DRAFT'}</span>
            {reqView.details && <p className="pv-pre">{reqView.details}</p>}
          </div>
        </Modal>
      )}

      {/* ── Benefit detail modal ───────────────────────────────────────────── */}
      {bene && (
        <Modal open onClose={() => setBene(null)} size="md" title={bene.title} subtitle={bene.value}>
          <div className="pv-detail">
            {bene.note && <span className="pill pill-gold">{bene.note}</span>}
            <p>{bene.detail}</p>
          </div>
        </Modal>
      )}

      {/* ── Knowledge base article modal ───────────────────────────────────── */}
      {article && (
        <Modal open onClose={() => setArticle(null)} size="md" title={article.title} subtitle={article.category}>
          <div className="pv-detail">
            <p>{article.body}</p>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
