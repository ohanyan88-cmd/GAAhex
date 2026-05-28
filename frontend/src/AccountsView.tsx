import { useEffect, useState } from 'react'
import { bget, bpost, type Subscription, type Invoice, type Party } from './billing'
import { money } from './money'
import { toast } from './Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from './States'
import { ArrowRightIcon, ChevronLeftIcon, BuildingIcon } from './icons'
import { useI18n } from './i18n'
import ViewHead from './ViewHead'
import { usePageConfig } from './pageConfig'

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

function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase()
  const cls = s === 'ACTIVE' ? 'pill pill-success' : s === 'SUSPENDED' || s === 'CLOSED' ? 'pill pill-muted' : 'pill'
  return status ? <span className={cls}>{status}</span> : <span>—</span>
}

export default function AccountsView({ token, configVersion = 0 }: { token: string; configVersion?: number }) {
  const { t } = useI18n()
  const cfg = usePageConfig(token, 'accounts', configVersion)
  const [list, setList] = useState<Account[] | null>(null)
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

  return (
    <div>
      <ViewHead icon={<BuildingIcon size={20} />} title={cfg.title} actions={!unavailable && <button className="btn btn-primary btn-md" onClick={() => setCreating((c) => !c)}>{creating ? t('common.close', 'Close') : t('accounts.new', '+ New Account')}</button>} />

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
        <div className="grid-wrap"><table className="grid">
          <thead><tr>
            {cfg.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
            <th scope="col"></th>
          </tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                {cfg.columns.map((c) => {
                  if (c.key === 'type') return <td key={c.key}><span className="pill">{a.type ?? '—'}</span></td>
                  if (c.key === 'holder') return <td key={c.key}>{holderName(a)}</td>
                  if (c.key === 'currency') return <td key={c.key}>{a.currency ?? '—'}</td>
                  if (c.key === 'cycle') return <td key={c.key}>{a.billing_cycle ?? '—'}</td>
                  if (c.key === 'status') return <td key={c.key}>{statusPill(a.status)}</td>
                  return <td key={c.key}>—</td>
                })}
                <td className="row-actions"><button className="btn btn-ghost btn-sm" onClick={() => setDetailId(a.id)}>{t('common.open', 'Open')} <ArrowRightIcon size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
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
    <div>
      <div className="view-head">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ChevronLeftIcon size={14} /> {t('nav.accounts', 'Accounts')}</button>
        <h2 style={{ marginLeft: 8 }}>{holderName}</h2>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!acct && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}

      {acct && (
        <>
          <div className="bill-meta">
            <div><span className="muted">{t('accounts.type', 'Type')}</span><div><span className="pill">{acct.type ?? '—'}</span></div></div>
            <div><span className="muted">{t('accounts.currency', 'Currency')}</span><div>{acct.currency ?? '—'}</div></div>
            <div><span className="muted">{t('accounts.cycle', 'Cycle')}</span><div>{acct.billing_cycle ?? '—'}</div></div>
            <div><span className="muted">{t('common.status', 'Status')}</span><div>{statusPill(acct.status)}</div></div>
          </div>

          <h3>{t('nav.subscriptions', 'Subscriptions')}</h3>
          {subs.length === 0
            ? <p className="muted">{t('accounts.noSubs', 'No subscriptions on this account yet.')}</p>
            : (
              <div className="grid-wrap"><table className="grid">
                <thead><tr><th scope="col">{t('subs.plan', 'Plan')}</th><th scope="col">{t('subs.amount', 'Amount')}</th><th scope="col">{t('accounts.cycle', 'Cycle')}</th><th scope="col">{t('common.status', 'Status')}</th></tr></thead>
                <tbody>
                  {subs.map((sx) => (
                    <tr key={sx.id}><td>{sx.plan_name ?? '—'}</td><td>{money(sx.amount)}</td><td>{sx.cycle ?? '—'}</td><td>{statusPill(sx.status)}</td></tr>
                  ))}
                </tbody>
              </table></div>
            )}

          <h3 style={{ marginTop: 18 }}>{t('nav.invoices', 'Invoices')}</h3>
          {invoices.length === 0
            ? <p className="muted">{t('accounts.noInvoices', 'No invoices on this account yet.')}</p>
            : (
              <div className="grid-wrap"><table className="grid">
                <thead><tr><th scope="col">{t('invoices.number', 'Invoice')}</th><th scope="col">{t('common.status', 'Status')}</th><th scope="col">{t('invoices.total', 'Total')}</th></tr></thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}><td>{inv.number ?? inv.id.slice(0, 8)}</td><td>{statusPill(inv.status)}</td><td>{money(inv.total)}</td></tr>
                  ))}
                </tbody>
              </table></div>
            )}
        </>
      )}
    </div>
  )
}
