import { useEffect, useState } from 'react'
import { api, type PortalService, type PortalSubscription, type PortalUsage } from '../api'

function servicePillClass(status: string): string {
  const map: Record<string, string> = {
    ACTIVE:     'pill pill-success',
    PENDING:    'pill pill-warning',
    SUSPENDED:  'pill pill-danger',
    TERMINATED: 'pill pill-muted',
    CANCELLED:  'pill pill-muted',
  }
  return map[status] ?? 'pill pill-muted'
}

function fmt(luma: number) {
  return (luma / 100).toLocaleString('hy-AM', { minimumFractionDigits: 2 }) + ' ֏'
}

export default function ServiceView() {
  const [services, setServices]           = useState<PortalService[]>([])
  const [subscriptions, setSubscriptions] = useState<PortalSubscription[]>([])
  const [usage, setUsage]                 = useState<PortalUsage[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [requestMsg, setRequestMsg]       = useState('')
  const [requesting, setRequesting]       = useState(false)
  const [requestDone, setRequestDone]     = useState(false)

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

  if (loading) return <div className="loading-state">Loading...</div>
  if (error)   return (
    <div className="error-banner">
      <span className="error-banner-title">Error</span>
      <span className="error-banner-msg">{error}</span>
    </div>
  )

  return (
    <div>
      <div className="view-head">
        <div className="view-title-wrap">
          <h2>Service</h2>
          <span className="view-sub">Your active services and subscriptions</span>
        </div>
      </div>

      {/* Active services */}
      <div className="section-head">Active services</div>
      {services.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <h3>No services found</h3>
          <p>Contact support to provision new services on your account.</p>
        </div>
      ) : (
        <div className="widgets" style={{ marginBottom: 28 }}>
          {services.map(s => (
            <div className="widget" key={s.id}>
              <div className="widget-label">{s.type}</div>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 10 }}>{s.name}</div>
              <span className={servicePillClass(s.status)}>{s.status}</span>
              {s.activated_at && (
                <div className="widget-foot">
                  <span>Since {new Date(s.activated_at).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Subscriptions */}
      <div className="section-head">Subscriptions</div>
      {subscriptions.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <h3>No subscriptions</h3>
          <p>Active plan subscriptions will appear here.</p>
        </div>
      ) : (
        <table className="grid" style={{ marginBottom: 28 }}>
          <thead>
            <tr>
              <th>Plan</th>
              <th className="num">Amount / cycle</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.plan_name}</td>
                <td className="num" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  {fmt(s.amount)} / {s.cycle}
                </td>
                <td><span className={servicePillClass(s.status)}>{s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Recent usage */}
      <div className="section-head">Recent usage</div>
      {usage.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <h3>No usage records</h3>
          <p>Usage data will appear here as your services are used.</p>
        </div>
      ) : (
        <table className="grid" style={{ marginBottom: 28 }}>
          <thead>
            <tr>
              <th>Metric</th>
              <th className="num">Quantity</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {usage.slice(0, 10).map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.metric}</td>
                <td className="num tabular">{Number(u.quantity).toLocaleString()} units</td>
                <td className="num" style={{ color: 'var(--accent)' }}>{fmt(u.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Service change request */}
      <div className="section-head">Request a change</div>
      {requestDone ? (
        <div className="toast toast-success" style={{ position: 'static', width: 'auto', maxWidth: 500 }}>
          <div className="toast-msg">
            <b>Request submitted</b>
            <span>Our team will be in touch shortly.</span>
          </div>
        </div>
      ) : (
        <form onSubmit={handleRequest} className="composer" style={{ maxWidth: 500 }}>
          <textarea
            className="inp inp-area"
            value={requestMsg}
            onChange={e => setRequestMsg(e.target.value)}
            placeholder="Describe the change you need..."
            rows={3}
            required
          />
          <div className="composer-actions">
            <button
              type="submit"
              className="btn btn-primary btn-md"
              disabled={requesting}
            >
              {requesting ? 'Sending...' : 'Send request'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
