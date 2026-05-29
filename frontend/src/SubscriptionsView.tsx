import { useEffect, useState } from 'react'
import { bget, bpost, loadCustomers, loadCustomerOptions, loadProducts, type Subscription, type Product } from './billing'
import { money, toMinor } from './money'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import { ReceiptIcon, PlusIcon, DownloadIcon, PauseIcon, PlayIcon } from './icons'
import ViewHead from './ViewHead'
import { usePageConfig } from './pageConfig'
import { useCustomFields } from './CustomCells'

type Draft = { customer_id: string; product_id: string; plan_name: string; amount: string; cycle: string }
const EMPTY: Draft = { customer_id: '', product_id: '', plan_name: '', amount: '', cycle: 'monthly' }

function subStatusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase()
  const cls = s === 'ACTIVE' ? 'pill pill-success'
    : s === 'SUSPENDED' ? 'pill pill-danger'
    : s === 'CANCELLED' ? 'pill pill-muted'
    : 'pill'
  return status
    ? <span className={cls}><span className="pill-dot" />{status}</span>
    : <span>—</span>
}

export default function SubscriptionsView({ token, configVersion = 0 }: { token: string; configVersion?: number }) {
  const cfg = usePageConfig(token, 'subscriptions', configVersion)
  const [list, setList] = useState<Subscription[] | null>(null)
  const cf = useCustomFields(token, 'subscriptions', cfg.customFields, (list ?? []).map((s) => s.id))
  const [names, setNames] = useState<Record<string, string>>({})
  const [customers, setCustomers] = useState<{ id: string; label: string }[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)

  async function load() {
    setError(''); setUnavailable(false); setList(null)
    const res = await bget<Subscription[]>(token, '/api/subscriptions')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (!res.ok) { setError('Failed to load subscriptions'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
    setNames(await loadCustomers(token))
  }

  useEffect(() => { load() }, [token])
  useEffect(() => {
    loadCustomerOptions(token).then(setCustomers)
    loadProducts(token, true).then(setProducts)
  }, [token])

  const cust = (s: Subscription) => (s.customer_id ? (names[s.customer_id] ?? s.customer_id.slice(0, 8)) : '—')

  function pickProduct(id: string) {
    const p = products.find((x) => x.id === id)
    setDraft((d) => d && ({
      ...d,
      product_id: id,
      plan_name: p?.name ?? d.plan_name,
      amount: p?.default_amount != null ? String(p.default_amount / 100) : d.amount,
      cycle: p?.cycle ?? d.cycle,
    }))
  }

  async function createSub() {
    if (!draft || !draft.plan_name.trim()) return
    try {
      await bpost(token, '/api/subscriptions', {
        customer_id: draft.customer_id || undefined,
        product_id: draft.product_id || undefined,
        plan_name: draft.plan_name.trim(),
        amount: toMinor(draft.amount),
        cycle: draft.cycle,
      })
      toast.success('Subscription created')
      setDraft(null)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function action(id: string, verb: 'cancel' | 'suspend' | 'resume') {
    try {
      await bpost(token, `/api/subscriptions/${id}/${verb}`)
      toast.success(`Subscription ${verb === 'resume' ? 'resumed' : verb + 'ed'}`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function generate(id: string) {
    try {
      await bpost(token, `/api/subscriptions/${id}/generate-invoice`)
      toast.success('Invoice generated')
    } catch (e) { toast.error((e as Error).message) }
  }

  async function rateUsage(id: string) {
    try {
      const res: any = await bpost(token, '/api/usage/rate', { subscription_id: id })
      const inv = res?.invoice_number ?? res?.number ?? (res?.invoice_id ? `#${String(res.invoice_id).slice(0, 8)}` : '')
      const total = res?.total
      toast.success(`Usage rated${inv ? ` → ${inv}` : ''}${typeof total === 'number' ? ` (${money(total)})` : ''}`)
    } catch (e) {
      const err = e as Error & { status?: number }
      toast.error(err.status === 404 ? "Usage rating isn't available yet" : err.message)
    }
  }

  const all = list ?? []
  const activeCount = all.filter(s => (s.status ?? '').toUpperCase() === 'ACTIVE').length
  const suspendedCount = all.filter(s => (s.status ?? '').toUpperCase() === 'SUSPENDED').length

  return (
    <div>
      <ViewHead
        icon={<ReceiptIcon size={18} />}
        title={cfg.title}
        sub="Customer × service bindings · billed via the WorkItem engine"
        actions={
          !unavailable ? (
            <>
              <button className="btn btn-ghost btn-sm">
                <DownloadIcon size={13} /> Export
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setDraft(draft ? null : { ...EMPTY })}
              >
                <PlusIcon size={13} /> {draft ? 'Close' : 'New subscription'}
              </button>
            </>
          ) : undefined
        }
      />

      {draft && (
        <div className="rec-form">
          <label className="field">
            <span>Customer</span>
            <select className="inp inp-md" value={draft.customer_id} onChange={(e) => setDraft({ ...draft, customer_id: e.target.value })}>
              <option value="">— none —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Product</span>
            <select className="inp inp-md" value={draft.product_id} onChange={(e) => pickProduct(e.target.value)}>
              <option value="">— custom —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Plan name *</span>
            <input className="inp inp-md" value={draft.plan_name} onChange={(e) => setDraft({ ...draft, plan_name: e.target.value })} placeholder="Fiber 100" />
          </label>
          <label className="field">
            <span>Amount (֏)</span>
            <input className="inp inp-md inp-numeric" type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          </label>
          <label className="field">
            <span>Cycle</span>
            <select className="inp inp-md" value={draft.cycle} onChange={(e) => setDraft({ ...draft, cycle: e.target.value })}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <div className="rec-form-actions">
            <button className="btn btn-accent btn-md" onClick={createSub} disabled={!draft.plan_name.trim()}>Create</button>
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && (
        <EmptyState icon={<ReceiptIcon size={40} />} title="Billing isn't available yet" message="Subscriptions will appear here once the billing service is enabled." />
      )}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<ReceiptIcon size={40} />} title="No subscriptions" message="Subscriptions you create will show up here." />
      )}

      {list && list.length > 0 && (
        <>
          <div className="tabs" style={{ marginBottom: 16 }}>
            <span className="pill pill-success">Active {activeCount}</span>
            {suspendedCount > 0 && <span className="pill pill-danger">Suspended {suspendedCount}</span>}
            {all.length - activeCount - suspendedCount > 0 && (
              <span className="pill pill-muted">Other {all.length - activeCount - suspendedCount}</span>
            )}
          </div>

          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {cfg.columns.map((c) => (
                    <th key={c.key} scope="col" className={c.key === 'mrr' ? 'num' : ''}>{c.label}</th>
                  ))}
                  {cf.headers()}
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const st = (s.status ?? '').toUpperCase()
                  const canceled = st === 'CANCELLED'
                  return (
                    <tr key={s.id}>
                      {cfg.columns.map((c) => {
                        if (c.key === 'customer') return <td key={c.key}>{cust(s)}</td>
                        if (c.key === 'plan') return (
                          <td key={c.key}><span className="pill pill-accent">{s.plan_name ?? '—'}</span></td>
                        )
                        if (c.key === 'cycle') return (
                          <td key={c.key} className="muted" style={{ textTransform: 'capitalize' }}>{s.cycle ?? '—'}</td>
                        )
                        if (c.key === 'status') return <td key={c.key}>{subStatusPill(s.status)}</td>
                        if (c.key === 'mrr') return <td key={c.key} className="num">֏{(s.amount ?? 0).toLocaleString()}</td>
                        return <td key={c.key}>—</td>
                      })}
                      {cf.cells(s.id)}
                      <td>
                        <div className="row-actions">
                          {!canceled && (
                            <button className="btn btn-ghost btn-sm" title="Generate invoice" onClick={() => generate(s.id)}>
                              Generate invoice
                            </button>
                          )}
                          {!canceled && (
                            <button className="btn btn-ghost btn-sm" title="Rate usage" onClick={() => rateUsage(s.id)}>
                              Rate usage
                            </button>
                          )}
                          {st === 'ACTIVE' && (
                            <button className="iconbtn" title="Suspend" onClick={() => action(s.id, 'suspend')}>
                              <PauseIcon size={13} />
                            </button>
                          )}
                          {st === 'SUSPENDED' && (
                            <button className="iconbtn" title="Resume" onClick={() => action(s.id, 'resume')}>
                              <PlayIcon size={13} />
                            </button>
                          )}
                          {!canceled && (
                            <button className="btn btn-danger btn-sm" onClick={() => action(s.id, 'cancel')}>Cancel</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
