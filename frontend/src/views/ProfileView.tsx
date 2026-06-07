// ProfileView — Workspace → My Profile. Employee self-service hub:
// Profile · My Documents · My Requests · My Benefits · Knowledge Base.
// Requests / Benefits / Knowledge Base are REAL — backed by the canonical config-driven entities
// (request / benefit / kb_article) via the generic records API. The request-type picker is built
// from the entity's own `request_type` options (config over code). My Documents stays local demo
// for now (a per-user document store lands next).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageShell } from '../page-shell'
import {
  UserIcon, ReceiptIcon, DownloadIcon, CheckIcon, ClockIcon,
  CalendarIcon, ArrowRightIcon, PlusIcon, BriefcaseIcon,
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

type TabKey = 'profile' | 'documents' | 'requests' | 'benefits' | 'kb'
type ReqRec = { id: string; request_type?: string; subject?: string; details?: string; status: string; created_at?: string }
type BeneRec = { id: string; title: string; value?: string; note?: string; detail?: string }
type ArticleRec = { id: string; title: string; category?: string; body?: string }
type ReqOption = { value: string; label: string }
type ReqGroup = { cat: string; items: ReqOption[] }

const DOCS = [
  { name: 'Աշխատանքային պայմանագիր.pdf', size: '240 KB', date: '2024-03-01' },
  { name: 'Անձնագիր (սկան).pdf', size: '1.2 MB', date: '2024-03-01' },
  { name: 'NDA.pdf', size: '180 KB', date: '2024-03-02' },
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

export default function ProfileView() {
  const { t } = useI18n()
  const { user, token } = useAuth()
  const [tab, setTab] = useState<TabKey>('profile')

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

  useEffect(() => { if (tab === 'requests') loadRequests() }, [tab, loadRequests])
  useEffect(() => { if (tab === 'benefits') loadBenefits() }, [tab, loadBenefits])
  useEffect(() => { if (tab === 'kb') loadArticles() }, [tab, loadArticles])

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

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'profile', label: t('profile.tab.profile', 'Profile') },
    { key: 'documents', label: t('profile.tab.documents', 'My Documents') },
    { key: 'requests', label: t('profile.tab.requests', 'My Requests') },
    { key: 'benefits', label: t('profile.tab.benefits', 'My Benefits') },
    { key: 'kb', label: t('profile.tab.kb', 'Knowledge Base') },
  ]

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'My Profile']}
      icon={<UserIcon size={18} />}
      title={t('profile.title', 'My profile')}
      subtitle={t('profile.subtitle', 'Your account')}
    >
      <div className="tabs">
        {tabs.map((tb) => (
          <button key={tb.key} className={'tab' + (tab === tb.key ? ' on' : '')} onClick={() => setTab(tb.key)}>
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <>
          <div className="card pv-card">
            <div className="pv-id">
              <span className="pv-avatar">{initials(user?.name)}</span>
              <div>
                <div className="pv-name">{name}</div>
                <div className="pv-email mono">{user?.email}</div>
                <span className="pill pill-gold pv-role">{role}</span>
              </div>
            </div>
          </div>
          <div className="card pv-info">
            <div className="pv-kv"><span className="pv-k">{t('auth.email', 'Email')}</span><span className="pv-v mono">{user?.email}</span></div>
            <div className="pv-kv"><span className="pv-k">{t('profile.phone', 'Phone')}</span><span className="pv-v">+374 10 100000</span></div>
            <div className="pv-kv"><span className="pv-k">{t('profile.jobTitle', 'Job title')}</span><span className="pv-v">{role}</span></div>
            <div className="pv-kv"><span className="pv-k">{t('profile.team', 'Team')}</span><span className="pv-v">Operations</span></div>
            <div className="pv-kv"><span className="pv-k">{t('profile.joined', 'Joined')}</span><span className="pv-v">2024-03-01</span></div>
          </div>
        </>
      )}

      {tab === 'documents' && (
        <>
          <div className="card pv-pad">
            <div className="pv-sec-title">{t('profile.upload', 'Upload a document')}</div>
            <FileUpload value={uploads} onChange={setUploads} hint={t('profile.uploadHint', 'ID, passport, agreement — PDF / image / doc')} />
          </div>
          <div className="card np-card">
            <div className="np-head">{t('profile.tab.documents', 'My Documents')}</div>
            <div className="np-list">
              {[...uploads.map((f) => ({ name: f.name, size: `${Math.max(1, Math.round(f.size / 1024))} KB`, date: new Date().toISOString().slice(0, 10) })), ...DOCS].map((d, i) => (
                <div key={d.name + i} className="pv-row">
                  <span className="pv-row-ic"><ReceiptIcon size={16} /></span>
                  <span className="pv-row-main">
                    <span className="pv-row-title">{d.name}</span>
                    <span className="pv-row-sub">{d.size} · {d.date}</span>
                  </span>
                  <span className="pv-row-act"><DownloadIcon size={15} /></span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'requests' && (
        <div className="card np-card">
          <div className="np-head pv-reqhead">
            <span>{t('profile.tab.requests', 'My Requests')}</span>
            <span className="spacer" />
            <Button variant="secondary" size="sm" onClick={openNewReq}>
              <PlusIcon size={13} /> {t('profile.newRequest', 'New request')}
            </Button>
          </div>
          <div className="np-list">
            {requests.length === 0 && (
              <div className="pv-empty">{t('profile.noRequests', 'No requests yet — create your first one.')}</div>
            )}
            {requests.map((r) => {
              const st = r.status || 'DRAFT'
              return (
                <button key={r.id} type="button" className="pv-row pv-row-btn" onClick={() => setReqView(r)}>
                  <span className="pv-row-ic">{st === 'APPROVED' ? <CheckIcon size={16} /> : <ClockIcon size={16} />}</span>
                  <span className="pv-row-main">
                    <span className="pv-row-title">{r.subject || r.request_type}</span>
                    <span className="pv-row-sub">{r.request_type}</span>
                  </span>
                  <span className={'pill ' + reqPill(st)}>{st}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'benefits' && (
        <div className="pv-benefits">
          {benefits.length === 0 && (
            <div className="card pv-pad pv-empty">{t('profile.noBenefits', 'No benefits to show.')}</div>
          )}
          {benefits.map((bn) => (
            <button key={bn.id} type="button" className="card pv-benefit" onClick={() => setBene(bn)}>
              <span className="pv-benefit-ic"><BriefcaseIcon size={16} /></span>
              <span className="pv-benefit-title">{bn.title}</span>
              <span className="pv-benefit-value">{bn.value}</span>
              <span className="pv-benefit-note">{bn.note}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'kb' && (
        <div className="card np-card">
          <div className="np-head">{t('profile.tab.kb', 'Knowledge Base')}</div>
          <div className="np-list">
            {articles.length === 0 && (
              <div className="pv-empty">{t('profile.noArticles', 'No articles yet.')}</div>
            )}
            {articles.map((a) => (
              <button key={a.id} type="button" className="pv-row pv-row-btn" onClick={() => setArticle(a)}>
                <span className="pv-row-ic"><ReceiptIcon size={16} /></span>
                <span className="pv-row-main">
                  <span className="pv-row-title">{a.title}</span>
                  <span className="pv-row-sub">{a.category}</span>
                </span>
                <span className="pv-row-act"><ArrowRightIcon size={15} /></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* New request modal */}
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
              <label className="field pv-req-reason"><span>{t('profile.subject', 'Subject')}</span>
                <Input value={reqSubject} onChange={(e) => setReqSubject(e.target.value)} />
              </label>
              <label className="field"><span>{t('profile.from', 'From')}</span><DatePicker value={reqFrom} onChange={setReqFrom} /></label>
              <label className="field"><span>{t('profile.to', 'To')}</span><DatePicker value={reqTo} onChange={setReqTo} /></label>
              <label className="field pv-req-reason"><span>{t('profile.reason', 'Reason / details')}</span>
                <textarea className="inp inp-area" rows={4} value={reqReason} onChange={(e) => setReqReason(e.target.value)} />
              </label>
              {reqErr && <div className="pv-req-err">{reqErr}</div>}
            </div>
          )}
        </Modal>
      )}

      {/* Request detail modal */}
      {reqView && (
        <Modal open onClose={() => setReqView(null)} size="md" title={reqView.subject || reqView.request_type || ''} subtitle={reqView.request_type}>
          <div className="pv-bene-detail">
            <span className={'pill ' + reqPill(reqView.status || 'DRAFT')}>{reqView.status || 'DRAFT'}</span>
            {reqView.details && <p className="pv-pre">{reqView.details}</p>}
          </div>
        </Modal>
      )}

      {/* Benefit detail modal */}
      {bene && (
        <Modal open onClose={() => setBene(null)} size="md" title={bene.title} subtitle={bene.value}>
          <div className="pv-bene-detail">
            {bene.note && <span className="pill pill-gold">{bene.note}</span>}
            <p>{bene.detail}</p>
          </div>
        </Modal>
      )}

      {/* Knowledge base article modal */}
      {article && (
        <Modal open onClose={() => setArticle(null)} size="md" title={article.title} subtitle={article.category}>
          <div className="pv-bene-detail">
            <p>{article.body}</p>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
