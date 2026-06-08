import { Banknote, AlertTriangle, TrendingUp, BarChart3 } from 'lucide-react'
import { KPITile, StatusPill } from '../../primitives'
import { LineChart } from '../../components/charts/LineChart'
import { ReceiptIcon } from '../../components/icons'
import { money } from '../../lib/money'
import { fmtDate } from '../../lib/time'
import type { Invoice } from '../../lib/billing'
import type { Overview, TrendPoint, AgingBuckets, Fetched } from './types'

function AgingBars({ buckets }: { buckets: AgingBuckets }) {
  const rows: { label: string; amount: number; danger?: boolean }[] = [
    { label: 'Current', amount: buckets.current },
    { label: '1–30 days', amount: buckets.d1_30 },
    { label: '31–60 days', amount: buckets.d31_60 },
    { label: '61–90 days', amount: buckets.d61_90 },
    { label: '90+ days', amount: buckets.d90_plus, danger: true },
  ]
  const max = rows.reduce((m, r) => Math.max(m, r.amount), 0)
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div key={i} className="bar-row">
          <span className="bar-label">{r.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: (max > 0 ? (r.amount / max) * 100 : 0) + '%',
                ...(r.danger ? { background: 'var(--gx-danger)' } : null),
              }}
            />
          </div>
          <span className="bar-val">{money(r.amount)}</span>
        </div>
      ))}
    </div>
  )
}

export function OverviewTab({ ovOk, trend, aging, overdue, customerNames }: {
  ovOk: Overview | null
  trend: Fetched<TrendPoint[]>
  aging: Fetched<AgingBuckets>
  overdue: Fetched<Invoice[]>
  customerNames: Record<string, string>
}) {
  const showAr = ovOk && typeof ovOk.ar_outstanding === 'number'
  const showOverdue = ovOk && typeof ovOk.overdue_total === 'number'
  const showOverdueCount = ovOk && typeof ovOk.overdue_count === 'number'
  const showCollected = ovOk && typeof ovOk.collected_this_month === 'number'
  const collectedDelta = (ovOk && typeof ovOk.collected_this_month === 'number' && typeof ovOk.collected_prev_month === 'number')
    ? (ovOk.collected_this_month - ovOk.collected_prev_month)
    : null
  const collectedPct = (collectedDelta != null && ovOk?.collected_prev_month)
    ? (collectedDelta / ovOk.collected_prev_month) * 100
    : null
  const hasKpis = !!(showCollected || showAr || showOverdue || showOverdueCount)

  return (
    <>
      {hasKpis && (
        <div className="kpi-strip">
          {showCollected && (
            <KPITile
              label="Collected this month"
              icon={Banknote}
              value={money(ovOk!.collected_this_month!)}
              size="sm"
              delta={collectedDelta != null
                ? (collectedPct != null
                    ? `${Math.abs(collectedPct).toFixed(0)}% vs prev`
                    : `${money(Math.abs(collectedDelta))} vs prev`)
                : undefined}
              deltaPositive={collectedDelta != null ? collectedDelta >= 0 : undefined}
            />
          )}
          {showAr && (
            <KPITile
              label="AR outstanding"
              icon={TrendingUp}
              value={money(ovOk!.ar_outstanding!)}
              size="sm"
            />
          )}
          {showOverdue && (
            <KPITile
              label="Overdue value"
              icon={AlertTriangle}
              value={money(ovOk!.overdue_total!)}
              size="sm"
              danger
            />
          )}
          {showOverdueCount && (
            <KPITile
              label="Overdue invoices"
              icon={ReceiptIcon}
              value={(ovOk!.overdue_count!).toLocaleString()}
              size="sm"
            />
          )}
        </div>
      )}

      {(trend.state !== 'hide' || aging.state !== 'hide') && (
        <div className="cols">
          {trend.state !== 'hide' && (
            <div className="card">
              <div className="card-head">
                <BarChart3 size={16} style={{ color: 'var(--gx-text-3)' }} />
                <h3>Revenue trend</h3>
                <span className="spacer" />
                <span className="pill pill-neutral">6 mo</span>
              </div>
              <div className="card-pad">
                {trend.state === 'loading' && <p className="muted">Loading…</p>}
                {trend.state === 'ok' && (
                  <LineChart
                    series={[
                      { label: 'Collected', values: trend.value.map(b => b.collected), color: 'var(--viz-1)', fillUnder: true },
                      { label: 'Invoiced',  values: trend.value.map(b => b.invoiced),  color: 'var(--viz-2)' },
                    ]}
                  />
                )}
              </div>
            </div>
          )}

          {aging.state !== 'hide' && (
            <div className="card">
              <div className="card-head">
                <AlertTriangle size={16} style={{ color: 'var(--gx-text-3)' }} />
                <h3>AR aging</h3>
              </div>
              <div className="card-pad">
                {aging.state === 'loading' && <p className="muted">Loading…</p>}
                {aging.state === 'ok' && <AgingBars buckets={aging.value} />}
              </div>
            </div>
          )}
        </div>
      )}

      {overdue.state !== 'hide' && (
        <div className="card" style={{ marginTop: 'var(--gx-space-18)' }}>
          <div className="card-head">
            <AlertTriangle size={16} style={{ color: 'var(--gx-text-3)' }} />
            <h3>Overdue invoices — needs attention</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {overdue.state === 'loading' && <p className="muted" style={{ padding: 'var(--gx-space-18)' }}>Loading…</p>}
            {overdue.state === 'ok' && (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.value.map((inv) => {
                    const cust = inv.customer_id
                      ? (customerNames[inv.customer_id] ?? inv.customer_id.slice(0, 8))
                      : '—'
                    const bal = inv.balance ?? inv.total ?? 0
                    return (
                      <tr key={inv.id}>
                        <td><span className="mono">{inv.number ?? inv.id.slice(0, 8)}</span></td>
                        <td>{cust}</td>
                        <td>{fmtDate(inv.due_at)}</td>
                        <td><StatusPill variant="critical" label={inv.status ?? 'OVERDUE'} size="sm" /></td>
                        <td className="num"><span className="mono tnum">{money(bal)}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  )
}
