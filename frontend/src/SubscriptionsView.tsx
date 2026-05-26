import { useEffect, useState } from 'react'
import { bget, bpost, loadCustomers, loadCustomerOptions, loadProducts, type Subscription, type Product } from './billing'
import { money, toMinor } from './money'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import { CreditCardIcon } from './icons'

type Draft = { customer_id: string; product_id: string; plan_name: string; amount: string; cycle: string }
const EMPTY: Draft = { customer_id: '', product_id: '', plan_name: '', amount: '', cycle: 'monthly' }

export default function SubscriptionsView({ token }: { token: string }) {
  const [list, setList] = useState<Subscription[] | null>(null)
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
    // load pickers lazily for the create form
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

  // roll a subscription's UNRATED usage into a draft invoice
  async function rateUsage(id: string) {
    try {
      const res: any = await bpost(token, '/api/usage/rate', { subscription_id: id })
      const inv = res?.invoice_number ?? res?.number ?? (res?.invoice_id ? `#${String(res.invoice_id).slice(0, 8)}` : '')
      const total = res?.total
      toast.success(`Usage rated${inv ? ` → ${inv}` : ''}${typeof total === 'number' ? ` (${money(total)})` : ''}`)
    } catch (e) {
      const err = e as Error & { status?: number }
      toast.error(err.status === 404 ? 'Usage rating isn’t available yet' : err.message)
    }
  }

  return (
    <div>
      <div className="view-head">
        <h2>Subscriptions</h2>
        {!unavailable && <button className="btn btn-primary btn-md" onClick={() => setDraft(draft ? null : { ...EMPTY })}>{draft ? 'Close' : '+ New subscription'}</button>}
      </div>

      {draft && (
        <div className="rec-form">
          <label className="field"><span>Customer</span>
            <select className="inp inp-md" value={draft.customer_id} onChange={(e) => setDraft({ ...draft, customer_id: e.target.value })}>
              <option value="">— none —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Product</span>
            <select className="inp inp-md" value={draft.product_id} onChange={(e) => pickProduct(e.target.value)}>
              <option value="">— custom —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Plan name *</span><input className="inp inp-md" value={draft.plan_name} onChange={(e) => setDraft({ ...draft, plan_name: e.target.value })} placeholder="Fiber 100" /></label>
          <label className="field"><span>Amount (֏)</span><input className="inp inp-md inp-numeric" type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></label>
          <label className="field"><span>Cycle</span>
            <select className="inp inp-md" value={draft.cycle} onChange={(e) => setDraft({ ...draft, cycle: e.target.value })}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <div className="rec-form-actions"><button className="btn btn-accent btn-md" onClick={createSub} disabled={!draft.plan_name.trim()}>Create</button></div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState icon={<CreditCardIcon size={40} />} title="Billing isn't available yet" message="Subscriptions will appear here once the billing service is enabled." />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<CreditCardIcon size={40} />} title="No subscriptions" message="Subscriptions you create will show up here." />
      )}

      {list && list.length > 0 && (
        <div className="grid-wrap"><table className="grid">
          <thead>
            <tr><th scope="col">Customer</th><th scope="col">Plan</th><th scope="col">Amount</th><th scope="col">Cycle</th><th scope="col">Status</th><th scope="col"></th></tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const st = (s.status ?? '').toUpperCase()
              const canceled = st === 'CANCELLED'
              return (
                <tr key={s.id}>
                  <td>{cust(s)}</td>
                  <td>{s.plan_name ?? '—'}</td>
                  <td>{money(s.amount)}</td>
                  <td>{s.cycle ?? '—'}</td>
                  <td>{s.status ? <span className={'pill' + (canceled ? ' pill-muted' : st === 'SUSPENDED' ? ' pill-danger' : ' pill-success')}>{s.status}</span> : '—'}</td>
                  <td className="row-actions">
                    {!canceled && <button className="btn btn-ghost btn-sm" onClick={() => generate(s.id)}>Generate invoice</button>}
                    {!canceled && <button className="btn btn-ghost btn-sm" onClick={() => rateUsage(s.id)}>Rate usage</button>}
                    {st === 'ACTIVE' && <button className="btn btn-ghost btn-sm" onClick={() => action(s.id, 'suspend')}>Suspend</button>}
                    {st === 'SUSPENDED' && <button className="btn btn-ghost btn-sm" onClick={() => action(s.id, 'resume')}>Resume</button>}
                    {!canceled && <button className="btn btn-danger btn-sm" onClick={() => action(s.id, 'cancel')}>Cancel</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      )}
    </div>
  )
}
