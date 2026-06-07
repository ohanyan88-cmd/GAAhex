// ProfileView — Workspace → My Profile. Employee self-service hub:
// Profile · My Documents (with upload) · My Requests (create + board) · My Benefits (clickable).
// Documents/Requests/Benefits use local demo state for now — backends wire in later.
import { useState } from 'react'
import { PageShell } from '../page-shell'
import {
  UserIcon, ReceiptIcon, DownloadIcon, CheckIcon, ClockIcon,
  CalendarIcon, HomeIcon, UsersIcon, ArrowRightIcon, PlusIcon, BriefcaseIcon,
} from '../components/icons'
import { Modal } from '../components/Modal'
import { FileUpload } from '../components/FileUpload'
import { DatePicker } from '../components/DatePicker'
import { Button } from '../primitives'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'

function initials(name: string | null | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

type TabKey = 'profile' | 'documents' | 'requests' | 'benefits' | 'kb'
type Req = { title: string; when: string; status: 'APPROVED' | 'PENDING' | 'REJECTED' }
type Bene = { title: string; value: string; note: string; detail: string }
type Article = { title: string; category: string; body: string }

const DOCS = [
  { name: 'Աշխատանքային պայմանագիր.pdf', size: '240 KB', date: '2024-03-01' },
  { name: 'Անձնագիր (սկան).pdf', size: '1.2 MB', date: '2024-03-01' },
  { name: 'NDA.pdf', size: '180 KB', date: '2024-03-02' },
]
const SEED_REQUESTS: Req[] = [
  { title: 'Արձակուրդ — 5 օր', when: '2026-05-20', status: 'APPROVED' },
  { title: 'Նոր նոութբուք', when: '2026-06-02', status: 'PENDING' },
  { title: 'Շենքի մուտքի քարտ', when: '2026-06-05', status: 'APPROVED' },
]
const REQ_TYPES = [
  { key: 'vacation', label: 'Day Off / Vacation', desc: 'Արձակուրդ կամ ազատ օր', Icon: CalendarIcon },
  { key: 'maternity', label: 'Maternity Leave', desc: 'Մայրության արձակուրդ', Icon: UsersIcon },
  { key: 'wfh', label: 'Work From Home', desc: 'Հեռավար աշխատանք', Icon: HomeIcon },
  { key: 'late', label: 'Late Arrival', desc: 'Ուշ ներկայանալ', Icon: ClockIcon },
  { key: 'early', label: 'Early Departure', desc: 'Շուտ հեռանալ', Icon: ClockIcon },
  { key: 'shift', label: 'Shift Change', desc: 'Հերթափոխի փոփոխություն', Icon: ArrowRightIcon },
  { key: 'overtime', label: 'Overtime', desc: 'Արտաժամյա աշխատանք', Icon: BriefcaseIcon },
]
const BENEFITS: Bene[] = [
  { title: 'Բժշկական ապահովագրություն', value: 'Ակտիվ', note: 'Ընտանեկան փաթեթ', detail: 'Ընտանեկան փաթեթ՝ ամբուլատոր, ստացիոնար և շտապ օգնություն։ Դեղորայք՝ 80% փոխհատուցում։ Ստոմատոլոգիա՝ տարեկան մինչև ֏150,000։ Գործընկեր՝ Ռեսո Ապահովագրություն։' },
  { title: 'Արձակուրդ', value: '18 / 25 օր', note: '7 օր օգտագործված', detail: 'Տարեկան 25 աշխատանքային օր վճարովի արձակուրդ։ Օգտագործված՝ 7 օր։ Մնացած՝ 18 օր։ Չօգտագործված օրերը փոխանցվում են հաջորդ տարի (առավելագույնը 5 օր)։' },
  { title: 'Ուսման բյուջե', value: '֏200,000', note: 'Տարեկան', detail: 'Տարեկան ֏200,000 մասնագիտական զարգացման համար՝ դասընթացներ, գրքեր, կոնֆերանսներ, սերտիֆիկացիաներ։ Հաստատումը՝ թիմի ղեկավարի մոտ։' },
  { title: 'Սննդի փոխհատուցում', value: '֏45,000', note: 'Ամսական', detail: 'Ամսական ֏45,000 սննդի փոխհատուցում՝ կորպորատիվ քարտով։ Կիրառելի գործընկեր ռեստորաններում և սուպերմարկետներում։' },
]

const ARTICLES: Article[] = [
  { title: 'Ինչպես հայտել արձակուրդ', category: 'HR', body: 'Անցեք My Profile → My Requests → New request → Day Off / Vacation։ Նշեք ամսաթվերը և պատճառը։ Հաստատումը կատարում է թիմի ղեկավարը 1-2 աշխատանքային օրում։' },
  { title: 'Հեռավար աշխատանքի քաղաքականություն', category: 'HR', body: 'Շաբաթական մինչև 2 օր հեռավար աշխատանք՝ ղեկավարի համաձայնությամբ։ Անհրաժեշտ է կայուն ինտերնետ և հասանելիություն աշխատանքային ժամերին (10:00–18:00)։' },
  { title: 'VPN-ի կարգավորում', category: 'IT', body: 'Ներբեռնեք GAAhex VPN client-ը ներքին պորտալից։ Մուտքագրեք ձեր կորպորատիվ հաշիվը։ Խնդիրների դեպքում՝ դիմեք IT բաժին (My Requests → IT)։' },
  { title: 'Ծախսերի փոխհատուցման ընթացակարգ', category: 'Finance', body: 'Կցեք անդորրագրերը (My Documents → Upload)։ Լրացրեք փոխհատուցման հայտը։ Վճարումը կատարվում է հաջորդ աշխատավարձի հետ։' },
  { title: 'Բժշկական ապահովագրության օգտագործում', category: 'Benefits', body: 'Ներկայացրեք ապահովագրական քարտը գործընկեր կլինիկայում։ Դեղորայք՝ 80% փոխհատուցում անդորրագրով։ Մանրամասները՝ My Benefits բաժնում։' },
  { title: 'Տեղեկատվական անվտանգության հիմունքներ', category: 'Security', body: 'Միացրեք 2FA-ն։ Մի կիսվեք գաղտնաբառերով։ Կասկածելի նամակները զեկուցեք security@gaahex.am հասցեին։' },
]

export default function ProfileView() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [tab, setTab] = useState<TabKey>('profile')

  const [uploads, setUploads] = useState<File[]>([])
  const [requests, setRequests] = useState<Req[]>(SEED_REQUESTS)

  // New-request modal: pick a type, then a small form.
  const [reqOpen, setReqOpen] = useState(false)
  const [reqType, setReqType] = useState<typeof REQ_TYPES[number] | null>(null)
  const [reqFrom, setReqFrom] = useState('')
  const [reqTo, setReqTo] = useState('')
  const [reqReason, setReqReason] = useState('')

  const [bene, setBene] = useState<Bene | null>(null)
  const [article, setArticle] = useState<Article | null>(null)

  const name = user?.name || t('common.you', 'You')
  const role = user?.can_configure ? t('role.admin', 'Administrator') : t('role.member', 'Member')

  function openNewReq() { setReqType(null); setReqFrom(''); setReqTo(''); setReqReason(''); setReqOpen(true) }
  function submitReq() {
    if (!reqType) return
    const range = reqFrom && reqTo ? ` (${reqFrom} → ${reqTo})` : reqFrom ? ` (${reqFrom})` : ''
    setRequests((r) => [{ title: reqType.label + range, when: new Date().toISOString().slice(0, 10), status: 'PENDING' }, ...r])
    setReqOpen(false)
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
            {requests.map((r, i) => (
              <div key={r.title + i} className="pv-row">
                <span className="pv-row-ic">{r.status === 'APPROVED' ? <CheckIcon size={16} /> : <ClockIcon size={16} />}</span>
                <span className="pv-row-main">
                  <span className="pv-row-title">{r.title}</span>
                  <span className="pv-row-sub">{r.when}</span>
                </span>
                <span className={'pill ' + (r.status === 'APPROVED' ? 'pill-success' : r.status === 'REJECTED' ? 'pill-danger' : 'pill-info')}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'benefits' && (
        <div className="pv-benefits">
          {BENEFITS.map((bn) => (
            <button key={bn.title} type="button" className="card pv-benefit" onClick={() => setBene(bn)}>
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
            {ARTICLES.map((a) => (
              <button key={a.title} type="button" className="pv-row pv-row-btn" onClick={() => setArticle(a)}>
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
              <Button variant="ghost" size="md" onClick={() => setReqType(null)}>{t('common.back', 'Back')}</Button>
              <Button variant="primary" size="md" onClick={submitReq}>{t('profile.submitRequest', 'Submit request')}</Button>
            </>
          ) : undefined}
        >
          {!reqType ? (
            <div className="rec-pick-cards pv-req-grid">
              {REQ_TYPES.map((rt) => (
                <button key={rt.key} type="button" className="rec-pick-card" onClick={() => setReqType(rt)}>
                  <span className="rec-pick-card-icon"><rt.Icon size={20} aria-hidden /></span>
                  <span className="rec-pick-card-title">{rt.label}</span>
                  <span className="rec-pick-card-desc">{rt.desc}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="pv-req-form">
              <label className="field"><span>{t('profile.from', 'From')}</span><DatePicker value={reqFrom} onChange={setReqFrom} /></label>
              <label className="field"><span>{t('profile.to', 'To')}</span><DatePicker value={reqTo} onChange={setReqTo} /></label>
              <label className="field pv-req-reason"><span>{t('profile.reason', 'Reason')}</span>
                <textarea className="inp inp-area" rows={4} value={reqReason} onChange={(e) => setReqReason(e.target.value)} />
              </label>
            </div>
          )}
        </Modal>
      )}

      {/* Benefit detail modal */}
      {bene && (
        <Modal open onClose={() => setBene(null)} size="md" title={bene.title} subtitle={bene.value}>
          <div className="pv-bene-detail">
            <span className="pill pill-gold">{bene.note}</span>
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
