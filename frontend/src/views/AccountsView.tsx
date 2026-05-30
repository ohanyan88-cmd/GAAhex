import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, type Subscription, type Invoice, type Party } from '../lib/billing'
import { money } from '../lib/money'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  ChevronLeftIcon, BuildingIcon,
  SearchIcon, GearIcon,
} from '../components/icons'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useI18n } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'

// Accounts UI (A17 /api/accounts) — the money/billing layer on a Party. Stage 1 may be dormant
// (no data) — that's fine; degrades to empty states, and 404 to "not available yet".
type Account = {
  id: string
  type?: string                  // residential | business | wholesale
  holder_party_id?: string | null
  holder_party_name?: string | null
  currency?: string
  billing_cycle?: string
  status?: string | null
  created_at?: string | null
  subscriptions?: Subscription[]
  invoices?: Invoice[]
}

const TYPES = ['residential', 'business', 'wholesale']
const CYCLES = ['monthly', 'yearly']

// Account status → StatusPill primitive variant (configurable statuses tolerated).
type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapAccountStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'ACTIVE') return 'active'
  if (v === 'SUSPENDED') return 'degraded'
  if (v === 'CLOSED' || v === 'INACTIVE') return 'neutral'
  if (v === 'PENDING' || v === 'DRAFT') return 'info'
  return 'info'
}

// Sub/invoice statuses appear in the detail panel — keep the broader mapping for those.
function mapBillingStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (['ACTIVE', 'PAID'].includes(v)) return 'active'
  if (['SUSPENDED', 'OVERDUE'].includes(v)) return 'critical'
  if (['VOID', 'CANCELLED', 'CLOSED'].includes(v)) return 'neutral'
  if (['DRAFT'].includes(v)) return 'neutral'
  return 'info'
}

export default function AccountsView({ token, canConfigure = false, configVersion = 0, onConfigure }: { token: string; canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
  const { t } = useI18n()
  const cfg = usePageConfig(token, 'accounts', configVersion)
  const [list, setList] = useState<Account[] | null>(null)
  const cf = useCustomFields(token, 'accounts', cfg.customFields, (list ?? []).map((a) => a.id))
  const [parties, setParties] = useState<Party[]>([])
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [holder, setHolder] = useState('')
  const [type, setType] = useState('residential')
  const [currency, setCurrency] = useState('AMD')
  const [cycle, setCycle] = useState('monthly')

  // Toolbar / table interaction state.
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<Account[]>(token, '/api/accounts')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError(t('accounts.loadError', 'Failed to load accounts')); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])
  useEffect(() => { bget<Party[]>(token, '/api/parties').then((r) => setParties(r.ok && Array.isArray(r.data) ? r.data : [])) }, [token])
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

  const holderName = (a: Account) => a.holder_party_name ?? (a.holder_party_id ? (parties.find((p) => p.id === a.holder_party_id)?.name ?? a.holder_party_id.slice(0, 8)) : '—')

  async function create() {
    if (!holder) return
    try {
      await bpost(token, '/api/accounts', { holder_party_id: holder, type, currency, billing_cycle: cycle })
      toast.success(t('accounts.created', 'Account created'))
      setCreating(false); setHolder(''); setType('residential'); setCurrency('AMD'); setCycle('monthly')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  if (denied) return <PermissionDenied message={t('accounts.denied', "You don't have permission to view accounts.")} />
  if (detailId) return <AccountDetail token={token} id={detailId} parties={parties} onBack={() => { setDetailId(null); load() }} />

  const all = list ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((a) => {
      const fields = [
        a.id ?? '',
        holderName(a),
        a.type ?? '',
        a.currency ?? '',
        a.billing_cycle ?? '',
        a.status ?? '',
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, parties])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (a: Account): string => {
      switch (k) {
        case 'type': return a.type ?? ''
        case 'holder': return holderName(a)
        case 'currency': return a.currency ?? ''
        case 'cycle': return a.billing_cycle ?? ''
        case 'status': return a.status ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => String(get(a)).localeCompare(String(get(b))) * dir)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, parties])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  function renderCell(colKey: string, a: Account) {
    switch (colKey) {
      case 'type': return a.type ?? '—'
      case 'holder': return holderName(a)
      case 'currency': return <span className="mono">{a.currency ?? '—'}</span>
      case 'cycle': return a.billing_cycle ?? '—'
      case 'status': return a.status
        ? <StatusPill variant={mapAccountStatus(a.status)} label={a.status} size="sm" />
        : <span>—</span>
      default: return '—'
    }
  }

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs">
          <span>Billing</span><span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span>
        </div>

        <ViewHead
          icon={<BuildingIcon size={18} />}
          title={cfg.title}
          sub={`${all.length} record${all.length !== 1 ? 's' : ''} · billing accounts on parties`}
          actions={
            !unavailable && (
              <>
                {canConfigure && onConfigure && (
                  <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
                    <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
                  </button>
                )}
                <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
                  <Plus size={14} /> {creating ? t('common.close', 'Close') : t('accounts.new', 'New account')}
                </button>
              </>
            )
          }
        />

        {all.length > 0 && (() => {
          const activeCount = all.filter(a => (a.status ?? '').toUpperCase() === 'ACTIVE').length
          const suspendedCount = all.filter(a => (a.status ?? '').toUpperCase() === 'SUSPENDED').length
          const typeCount = new Set(all.map(a => a.type).filter(Boolean)).size
          return (
            <div className="kpi-strip">
              <div className="kpi">
                <span className="klbl">Accounts</span>
                <div className="kval tnum" style={{ fontSize: 24 }}>{all.length}</div>
                <span className="hint" style={{ fontSize: 11 }}>{activeCount} active</span>
              </div>
              <div className="kpi kpi--marquee">
                <span className="klbl">Active</span>
                <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-gold)' }}>{activeCount}</div>
                <span className="hint" style={{ fontSize: 11 }}>billable</span>
              </div>
              {suspendedCount > 0 && (
                <div className="kpi">
                  <span className="klbl">Suspended</span>
                  <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-warning-fg)' }}>{suspendedCount}</div>
                  <span className="hint" style={{ fontSize: 11 }}>action required</span>
                </div>
              )}
              {typeCount > 0 && (
                <div className="kpi">
                  <span className="klbl">Types</span>
                  <div className="kval tnum" style={{ fontSize: 24 }}>{typeCount}</div>
                  <span className="hint" style={{ fontSize: 11 }}>residential · business · wholesale</span>
                </div>
              )}
            </div>
          )
        })()}

        {creating && (
          <div className="rec-form">
            <label className="field"><span>{t('accounts.holder', 'Holder party')} *</span>
              <select className="inp inp-md" value={holder} onChange={(e) => setHolder(e.target.value)}>
                <option value="">{t('common.pick', '— pick —')}</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</option>)}
              </select>
            </label>
            <label className="field"><span>{t('accounts.type', 'Type')}</span>
              <select className="inp inp-md" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            </label>
            <label className="field"><span>{t('accounts.currency', 'Currency')}</span><input className="inp inp-md" value={currency} onChange={(e) => setCurrency(e.target.value)} /></label>
            <label className="field"><span>{t('accounts.cycle', 'Billing cycle')}</span>
              <select className="inp inp-md" value={cycle} onChange={(e) => setCycle(e.target.value)}>{CYCLES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            </label>
            <div className="rec-form-actions"><button className="btn btn-accent btn-md" onClick={create} disabled={!holder}>{t('common.create', 'Create')}</button></div>
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}
        {unavailable && <EmptyState icon={<BuildingIcon size={40} />} title={t('accounts.unavailable', "Accounts aren't available yet")} message={t('accounts.unavailableMsg', 'The accounts layer will appear here once enabled.')} />}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<BuildingIcon size={40} />} title={t('accounts.empty', 'No accounts')} message={t('accounts.emptyMsg', 'Create an account against a party to start billing it.')} />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search accounts"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <span className="spacer" />
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {cfg.columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        onClick={() => toggleSort(c.key)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {c.label}
                          {sortKey === c.key
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-primary)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-primary)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => setDetailId(a.id)}
                    >
                      {cfg.columns.map((c) => (
                        <td key={c.key}>{renderCell(c.key, a)}</td>
                      ))}
                      {cf.cells(a.id)}
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + cfg.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching accounts.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span className="hint">
                {sorted.length === 0
                  ? '0 records'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft size={15} />
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map(p => (
                  <button key={p} className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AccountDetail({ token, id, parties, onBack }: { token: string; id: string; parties: Party[]; onBack: () => void }) {
  const { t } = useI18n()
  const [acct, setAcct] = useState<Account | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    const res = await bget<Account>(token, `/api/accounts/${id}`)
    if (!res.ok) { setError(res.status === 404 ? t('accounts.notFound', 'Account not found') : t('accounts.loadError', 'Failed to load account')); return }
    setAcct(res.data)
  }
  useEffect(() => { load() }, [token, id])

  const subs = acct?.subscriptions ?? []
  const invoices = acct?.invoices ?? []
  const holderName = acct?.holder_party_name ?? (acct?.holder_party_id ? (parties.find((p) => p.id === acct.holder_party_id)?.name ?? acct.holder_party_id.slice(0, 8)) : '—')

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs">
          <span>Billing</span><span className="sep">/</span>
          <a onClick={onBack} style={{ cursor: 'pointer' }}>Accounts</a>
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>{holderName}</span>
        </div>

        <ViewHead
          icon={<BuildingIcon size={18} />}
          title={holderName}
          sub={acct?.id ? <span className="mono">{acct.id.slice(0, 8)}</span> : undefined}
          actions={
            <button className="btn btn-ghost btn-sm" onClick={onBack}>
              <ChevronLeftIcon size={13} /> {t('nav.accounts', 'Accounts')}
            </button>
          }
        />

        {error && <ErrorBanner message={error} onRetry={load} />}
        {!acct && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}

        {acct && (
          <>
            <div className="bill-meta">
              <div><span className="muted">{t('accounts.type', 'Type')}</span><div>{acct.type ?? '—'}</div></div>
              <div><span className="muted">{t('accounts.currency', 'Currency')}</span><div className="mono">{acct.currency ?? '—'}</div></div>
              <div><span className="muted">{t('accounts.cycle', 'Cycle')}</span><div>{acct.billing_cycle ?? '—'}</div></div>
              <div><span className="muted">{t('common.status', 'Status')}</span>
                <div>{acct.status ? <StatusPill variant={mapAccountStatus(acct.status)} label={acct.status} size="sm" /> : <span>—</span>}</div>
              </div>
            </div>

            <h3>{t('nav.subscriptions', 'Subscriptions')}</h3>
            {subs.length === 0
              ? <p className="muted">{t('accounts.noSubs', 'No subscriptions on this account yet.')}</p>
              : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="grid-wrap">
                    <table className="grid">
                      <thead><tr>
                        <th scope="col">{t('subs.plan', 'Plan')}</th>
                        <th scope="col" className="num">{t('subs.amount', 'Amount')}</th>
                        <th scope="col">{t('accounts.cycle', 'Cycle')}</th>
                        <th scope="col">{t('common.status', 'Status')}</th>
                      </tr></thead>
                      <tbody>
                        {subs.map((sx) => (
                          <tr key={sx.id}>
                            <td>{sx.plan_name ?? '—'}</td>
                            <td className="num"><span className="mono tnum">{money(sx.amount)}</span></td>
                            <td>{sx.cycle ?? '—'}</td>
                            <td>{sx.status ? <StatusPill variant={mapBillingStatus(sx.status)} label={sx.status} size="sm" /> : <span>—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            <h3 style={{ marginTop: 18 }}>{t('nav.invoices', 'Invoices')}</h3>
            {invoices.length === 0
              ? <p className="muted">{t('accounts.noInvoices', 'No invoices on this account yet.')}</p>
              : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="grid-wrap">
                    <table className="grid">
                      <thead><tr>
                        <th scope="col">{t('invoices.number', 'Invoice')}</th>
                        <th scope="col">{t('common.status', 'Status')}</th>
                        <th scope="col" className="num">{t('invoices.total', 'Total')}</th>
                      </tr></thead>
                      <tbody>
                        {invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td><span className="mono">{inv.number ?? inv.id.slice(0, 8)}</span></td>
                            <td>{inv.status ? <StatusPill variant={mapBillingStatus(inv.status)} label={inv.status} size="sm" /> : <span>—</span>}</td>
                            <td className="num"><span className="mono tnum">{money(inv.total)}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
          </>
        )}
      </div>
    </div>
  )
}
