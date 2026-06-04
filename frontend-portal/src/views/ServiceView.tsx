import { useEffect, useState } from 'react'
import { api, type PortalService, type PortalSubscription, type PortalUsage } from '../lib/api'
import { fmt } from '../lib/money'  // DF-7 — canonical AMD formatter
import { useI18n } from '../lib/i18n'  // T-P4-2

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

export default function ServiceView() {
  const [services, setServices]           = useState<PortalService[]>([])
  const [subscriptions, setSubscriptions] = useState<PortalSubscription[]>([])
  const [usage, setUsage]                 = useState<PortalUsage[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [requestMsg, setRequestMsg]       = useState('')
  const [requesting, setRequesting]       = useState(false)
  const [requestDone, setRequestDone]     = useState(false)
  const { t } = useI18n()

  // T-P4-2 — value stays UPPER_SNAKE_CASE (B1), only the label localizes.
  const svcStatusLabel = (s: string): string => {
    const map: Record<string, string> = {
      ACTIVE:     t('svc.statusActive', 'ACTIVE'),
      PENDING:    t('svc.statusPending', 'PENDING'),
      SUSPENDED:  t('svc.statusSuspended', 'SUSPENDED'),
      TERMINATED: t('svc.statusTerminated', 'TERMINATED'),
      CANCELLED:  t('svc.statusCancelled', 'CANCELLED'),
    }
    return map[s] ?? s
  }

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

  if (loading) return <div className="loading-state">{t('common.loading', 'Loading...')}</div>
  if (error)   return (
    <div className="error-banner">
      <span className="error-banner-title">{t('common.error', 'Error')}</span>
      <span className="error-banner-msg">{error}</span>
    </div>
  )

  return (
    <div>
      <div className="view-head">
        <div className="view-title-wrap">
          <h2>{t('svc.title', 'Service')}</h2>
          <span className="view-sub">{t('svc.subtitle', 'Your active services and subscriptions')}</span>
        </div>
      </div>

      {/* Active services */}
      <div className="section-head">{t('svc.services', 'Active services')}</div>
      {services.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <h3>{t('svc.empty', 'No services found')}</h3>
          <p>{t('svc.emptyHint', 'Contact support to provision new services on your account.')}</p>
        </div>
      ) : (
        <div className="widgets" style={{ marginBottom: 28 }}>
          {services.map(s => (
            <div className="widget" key={s.id}>
              <div className="widget-label">{s.type}</div>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 10 }}>{s.name}</div>
              <span className={servicePillClass(s.status)}>{svcStatusLabel(s.status)}</span>
              {s.activated_at && (
                <div className="widget-foot">
                  <span>{t('svc.activatedAt', 'Since')} {new Date(s.activated_at).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Subscriptions */}
      <div className="section-head">{t('svc.subscriptions', 'Subscriptions')}</div>
      {subscriptions.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <h3>{t('svc.subsEmpty', 'No subscriptions')}</h3>
          <p>{t('svc.subsEmptyHint', 'Active plan subscriptions will appear here.')}</p>
        </div>
      ) : (
        <table className="grid" style={{ marginBottom: 28 }}>
          <thead>
            <tr>
              <th>{t('svc.plan', 'Plan')}</th>
              <th className="num">{t('bills.amount', 'Amount')} / {t('svc.cycle', 'cycle')}</th>
              <th>{t('bills.status', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.plan_name}</td>
                <td className="num" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  {fmt(s.amount)} / {s.cycle}
                </td>
                <td><span className={servicePillClass(s.status)}>{svcStatusLabel(s.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Recent usage */}
      <div className="section-head">{t('svc.usage', 'Recent usage')}</div>
      {usage.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <h3>{t('svc.usageEmpty', 'No usage records')}</h3>
          <p>{t('svc.usageEmptyHint', 'Usage data will appear here as your services are used.')}</p>
        </div>
      ) : (
        <table className="grid" style={{ marginBottom: 28 }}>
          <thead>
            <tr>
              <th>{t('svc.metric', 'Metric')}</th>
              <th className="num">{t('svc.quantity', 'Quantity')}</th>
              <th className="num">{t('bills.amount', 'Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {usage.slice(0, 10).map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.metric}</td>
                <td className="num tabular">{Number(u.quantity).toLocaleString()} {t('svc.units', 'units')}</td>
                <td className="num" style={{ color: 'var(--accent)' }}>{fmt(u.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Service change request */}
      <div className="section-head">{t('svc.request', 'Request a change')}</div>
      {requestDone ? (
        <div className="toast toast-success" style={{ position: 'static', width: 'auto', maxWidth: 500 }}>
          <div className="toast-msg">
            <b>{t('svc.requestDone', 'Request submitted')}</b>
            <span>{t('svc.requestDoneMsg', 'Our team will be in touch shortly.')}</span>
          </div>
        </div>
      ) : (
        <form onSubmit={handleRequest} className="composer" style={{ maxWidth: 500 }}>
          <textarea
            className="inp inp-area"
            value={requestMsg}
            onChange={e => setRequestMsg(e.target.value)}
            placeholder={t('svc.requestPlaceholder', 'Describe the change you need...')}
            rows={3}
            required
          />
          <div className="composer-actions">
            <button
              type="submit"
              className="btn btn-primary btn-md"
              disabled={requesting}
            >
              {requesting ? t('svc.sending', 'Sending...') : t('svc.sendRequest', 'Send request')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
