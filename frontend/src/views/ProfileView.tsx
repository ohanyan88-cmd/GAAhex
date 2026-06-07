// ProfileView — Workspace → My Profile. Employee self-service hub:
// Profile (real user) + My Documents / My Requests / My Benefits (demo content for now).
import { useState } from 'react'
import { PageShell } from '../page-shell'
import { UserIcon, ReceiptIcon, DownloadIcon, InboxIcon, CheckIcon, ClockIcon } from '../components/icons'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'

function initials(name: string | null | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

type TabKey = 'profile' | 'documents' | 'requests' | 'benefits'

// ---- demo content (no backend yet) ----
const DOCS = [
  { name: 'Աշխատանքային պայմանագիր.pdf', size: '240 KB', date: '2024-03-01' },
  { name: 'Անձնագիր (սկան).pdf', size: '1.2 MB', date: '2024-03-01' },
  { name: 'NDA.pdf', size: '180 KB', date: '2024-03-02' },
]
const REQUESTS = [
  { title: 'Արձակուրդ — 5 օր', when: '2026-05-20', status: 'APPROVED' },
  { title: 'Նոր նոութբուք', when: '2026-06-02', status: 'PENDING' },
  { title: 'Շենքի մուտքի քարտ', when: '2026-06-05', status: 'APPROVED' },
]
const BENEFITS = [
  { title: 'Բժշկական ապահովագրություն', value: 'Ակտիվ', note: 'Ընտանեկան փաթեթ' },
  { title: 'Արձակուրդ', value: '18 / 25 օր', note: '7 օր օգտագործված' },
  { title: 'Ուսման բյուջե', value: '֏200,000', note: 'Տարեկան' },
  { title: 'Սննդի փոխհատուցում', value: '֏45,000', note: 'Ամսական' },
]

export default function ProfileView() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [tab, setTab] = useState<TabKey>('profile')

  const name = user?.name || t('common.you', 'You')
  const role = user?.can_configure ? t('role.admin', 'Administrator') : t('role.member', 'Member')

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'profile', label: t('profile.tab.profile', 'Profile') },
    { key: 'documents', label: t('profile.tab.documents', 'My Documents') },
    { key: 'requests', label: t('profile.tab.requests', 'My Requests') },
    { key: 'benefits', label: t('profile.tab.benefits', 'My Benefits') },
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
        <div className="card np-card">
          <div className="np-head">{t('profile.tab.documents', 'My Documents')}</div>
          <div className="np-list">
            {DOCS.map((d) => (
              <div key={d.name} className="pv-row">
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
      )}

      {tab === 'requests' && (
        <div className="card np-card">
          <div className="np-head">{t('profile.tab.requests', 'My Requests')}</div>
          <div className="np-list">
            {REQUESTS.map((r) => (
              <div key={r.title} className="pv-row">
                <span className="pv-row-ic">{r.status === 'APPROVED' ? <CheckIcon size={16} /> : <ClockIcon size={16} />}</span>
                <span className="pv-row-main">
                  <span className="pv-row-title">{r.title}</span>
                  <span className="pv-row-sub">{r.when}</span>
                </span>
                <span className={'pill ' + (r.status === 'APPROVED' ? 'pill-success' : 'pill-info')}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'benefits' && (
        <div className="pv-benefits">
          {BENEFITS.map((bn) => (
            <div key={bn.title} className="card pv-benefit">
              <span className="pv-benefit-ic"><InboxIcon size={16} /></span>
              <span className="pv-benefit-title">{bn.title}</span>
              <span className="pv-benefit-value">{bn.value}</span>
              <span className="pv-benefit-note">{bn.note}</span>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  )
}
