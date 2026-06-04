import { useEffect, useState } from 'react'
import { api, type PortalSummary } from '../lib/api'
import { fmt } from '../lib/money'  // DF-7 — canonical AMD formatter

interface StatWidgetProps {
  label: string
  value: string | number
  accent?: boolean
  subLabel?: string
}

function StatWidget({ label, value, accent, subLabel }: StatWidgetProps) {
  return (
    <div className="widget" style={accent ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="widget-label">{label}</div>
      <div className={`kpi${!accent ? ' kpi-neutral' : ''}`} style={accent ? undefined : { color: 'var(--text)' }}>
        {value}
      </div>
      {subLabel && <div className="kpi-sub">{subLabel}</div>}
    </div>
  )
}

export default function DashboardView() {
  const [summary, setSummary] = useState<PortalSummary | null>(null)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    api.summary().then(setSummary).catch(err => setError(err.message))
  }, [])

  if (error) {
    return (
      <div className="error-banner" style={{ marginTop: 0 }}>
        <span className="error-banner-title">Failed to load summary</span>
        <span className="error-banner-msg">{error}</span>
      </div>
    )
  }

  if (!summary) {
    return <div className="loading-state">Loading...</div>
  }

  return (
    <div>
      <div className="view-head">
        <div className="view-title-wrap">
          <h2>Dashboard</h2>
          <span className="view-sub">
            Welcome back, {summary.customer.name ?? summary.customer.email}
          </span>
        </div>
      </div>

      <div className="widgets">
        <StatWidget
          label="Balance due"
          value={fmt(summary.balance_due_luma)}
          accent={summary.balance_due_luma > 0}
          subLabel={summary.balance_due_luma > 0 ? 'Payment required' : 'All clear'}
        />
        <StatWidget
          label="Open invoices"
          value={summary.open_invoices_count}
          subLabel="Awaiting payment"
        />
        <StatWidget
          label="Open tickets"
          value={summary.open_tickets_count}
          subLabel="Support requests"
        />
        <StatWidget
          label="Active services"
          value={summary.active_services_count}
          subLabel="Currently running"
        />
      </div>
    </div>
  )
}
