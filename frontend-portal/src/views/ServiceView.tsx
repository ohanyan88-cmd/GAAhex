import { useEffect, useState } from 'react'
import { api, type PortalService, type PortalSubscription, type PortalUsage } from '../api'

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: 'var(--success)', PENDING: 'var(--warning)', SUSPENDED: 'var(--danger)', TERMINATED: 'var(--text-3)',
    CANCELLED: 'var(--text-3)',
  }
  return (
    <span style={{
      background: `${colors[status] ?? 'var(--text-3)'}22`,
      color: colors[status] ?? 'var(--text-3)',
      border: `1px solid ${colors[status] ?? 'var(--text-3)'}`,
      borderRadius: 'var(--pill)',
      padding: '2px 10px',
      fontSize: 11,
      fontWeight: 600,
    }}>
      {status}
    </span>
  )
}

function fmt(luma: number) {
  return (luma / 100).toLocaleString('hy-AM', { minimumFractionDigits: 2 }) + ' ֏'
}

export default function ServiceView() {
  const [services, setServices] = useState<PortalService[]>([])
  const [subscriptions, setSubscriptions] = useState<PortalSubscription[]>([])
  const [usage, setUsage] = useState<PortalUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestMsg, setRequestMsg] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [requestDone, setRequestDone] = useState(false)

  useEffect(() => {
    Promise.all([api.services(), api.subscriptions(), api.usage()])
      .then(([svcs, subs, usg]) => { setServices(svcs); setSubscriptions(subs); setUsage(usg) })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault()
    setRequesting(true)
    try {
      await api.serviceRequest(requestMsg)
      setRequestMsg('')
      setRequestDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setRequesting(false)
    }
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--text-3)' }}>Loading...</div>
  if (error) return <div style={{ padding: 24, color: 'var(--danger)' }}>{error}</div>

  return (
    <div style={{ padding: 28 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Service</h1>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginBottom: 12 }}>Active services</h2>
        {services.length === 0 ? (
          <p style={{ color: 'var(--text-3)' }}>No services found.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {services.map(s => (
              <div key={s.id} style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '16px',
              }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.name}</div>
                <div style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 8 }}>{s.type}</div>
                <StatusPill status={s.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginBottom: 12 }}>Subscriptions</h2>
        {subscriptions.length === 0 ? (
          <p style={{ color: 'var(--text-3)' }}>No subscriptions found.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {subscriptions.map(s => (
              <div key={s.id} style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '14px 16px',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}>
                <span style={{ fontWeight: 600, flex: 1 }}>{s.plan_name}</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{fmt(s.amount)} / {s.cycle}</span>
                <StatusPill status={s.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginBottom: 12 }}>Recent usage</h2>
        {usage.length === 0 ? (
          <p style={{ color: 'var(--text-3)' }}>No usage records.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {usage.slice(0, 10).map(u => (
              <div key={u.id} style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '10px 14px',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
              }}>
                <span style={{ fontWeight: 600, minWidth: 80 }}>{u.metric}</span>
                <span style={{ color: 'var(--text-2)' }}>{Number(u.quantity).toLocaleString()} units</span>
                <span style={{ color: 'var(--accent)' }}>{fmt(u.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginBottom: 12 }}>Request a change</h2>
        {requestDone ? (
          <div style={{
            background: 'var(--success-soft)',
            border: '1px solid var(--success)',
            color: 'var(--success)',
            borderRadius: 'var(--radius)',
            padding: '12px 16px',
          }}>
            Your request was submitted. Our team will be in touch.
          </div>
        ) : (
          <form onSubmit={handleRequest} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 500 }}>
            <textarea
              value={requestMsg}
              onChange={e => setRequestMsg(e.target.value)}
              placeholder="Describe the change you need..."
              rows={3}
              style={{ width: '100%', resize: 'vertical' }}
              required
            />
            <button type="submit" disabled={requesting} style={{
              background: 'var(--primary)', color: 'var(--text)', borderRadius: 'var(--radius)',
              padding: '8px 18px', fontWeight: 600, alignSelf: 'flex-start',
            }}>
              {requesting ? 'Sending...' : 'Send request'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
