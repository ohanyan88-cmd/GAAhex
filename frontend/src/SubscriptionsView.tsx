import { useEffect, useState } from 'react'
import { bget, bpost, type Subscription } from './billing'
import { money } from './money'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import { CreditCardIcon } from './icons'

const custName = (x: Subscription) => x.customer_name ?? x.customer ?? '—'

export default function SubscriptionsView({ token }: { token: string }) {
  const [list, setList] = useState<Subscription[] | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  async function load() {
    setError(''); setUnavailable(false); setList(null)
    const res = await bget<Subscription[]>(token, '/api/subscriptions')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (!res.ok) { setError('Failed to load subscriptions'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])

  async function action(id: string, verb: 'cancel' | 'suspend' | 'resume') {
    try {
      await bpost(token, `/api/subscriptions/${id}/${verb}`)
      toast.success(`Subscription ${verb === 'resume' ? 'resumed' : verb + 'ed'}`)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <div className="view-head"><h2>Subscriptions</h2></div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState icon={<CreditCardIcon size={40} />} title="Billing isn't available yet" message="Subscriptions will appear here once the billing service is enabled." />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<CreditCardIcon size={40} />} title="No subscriptions" message="Subscriptions you create will show up here." />
      )}

      {list && list.length > 0 && (
        <table className="grid">
          <thead>
            <tr><th>Customer</th><th>Plan</th><th>Amount</th><th>Cycle</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const st = (s.status ?? '').toLowerCase()
              const canceled = st === 'canceled' || st === 'cancelled'
              return (
                <tr key={s.id}>
                  <td>{custName(s)}</td>
                  <td>{s.plan ?? '—'}</td>
                  <td>{money(s.amount)}</td>
                  <td>{s.cycle ?? '—'}</td>
                  <td>{s.status ? <span className="pill">{s.status}</span> : '—'}</td>
                  <td className="row-actions">
                    {st === 'active' && <button className="btn btn-ghost btn-sm" onClick={() => action(s.id, 'suspend')}>Suspend</button>}
                    {st === 'suspended' && <button className="btn btn-ghost btn-sm" onClick={() => action(s.id, 'resume')}>Resume</button>}
                    {!canceled && <button className="btn btn-danger btn-sm" onClick={() => action(s.id, 'cancel')}>Cancel</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
